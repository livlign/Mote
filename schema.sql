create extension if not exists "pgcrypto";

create table if not exists words (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  device_id text not null,
  submitted_at timestamptz not null default now(),
  utc_date date generated always as ((submitted_at at time zone 'UTC')::date) stored
);

-- Word format: each token starts with an alphanumeric and may contain
-- lowercase letters, digits, apostrophes, hyphens, underscores. Tokens
-- are separated by single spaces. Each token ≤ 20 chars; total ≤ 30.
-- Loosened progressively from `^[a-z]{1,20}$` → multi-word → here.
-- Drops any pre-existing anonymous CHECK on `word` so this migration is
-- safe to re-run on existing databases.
do $$
declare c_name text;
begin
  for c_name in
    select conname from pg_constraint
    where conrelid = 'words'::regclass and contype = 'c'
      and conname <> 'words_word_format'
      and pg_get_constraintdef(oid) ilike '%word %~%'
  loop
    execute format('alter table words drop constraint %I', c_name);
  end loop;
end$$;
alter table words drop constraint if exists words_word_format;
-- `not valid`: pre-existing rows are grandfathered (some backfilled rows
-- predate this format). New inserts are still enforced; the RLS policy
-- below applies the same regex on the write path.
alter table words add constraint words_word_format
  check (word ~ '^[a-z0-9][a-z0-9''_-]{0,19}( [a-z0-9][a-z0-9''_-]{0,19})*$' and length(word) <= 30) not valid;

create unique index if not exists words_one_per_device_per_day on words (device_id, utc_date);
create index if not exists words_by_date on words (utc_date);
create index if not exists words_by_word_date on words (utc_date, word);

-- Realtime: stream INSERTs to subscribed clients so the cloud updates live
-- without polling. Idempotent — adding an already-published table errors,
-- which is why we guard with a DO block.
do $$
begin
  alter publication supabase_realtime add table words;
exception when duplicate_object then null;
end$$;

alter table words enable row level security;

drop policy if exists "anyone can read" on words;
create policy "anyone can read"
  on words for select
  using (true);

-- Hide device_id from anon REST reads. The row-level policy above still
-- allows SELECT, but column-level grants restrict which columns come back.
-- Without this, /rest/v1/words?select=device_id leaks a per-device
-- fingerprint joined with word+timestamp.
revoke select on words from anon;
grant select (word, submitted_at, utc_date) on words to anon;

-- Server-side profanity backstop. The client list in index.html is the
-- friendly first gate; this regex is the actual enforcement and catches
-- common variants (plurals, -az, -ah, faggot, motherfucker, etc.). On
-- match the insert is rejected with 403 and the client maps that to the
-- same "Try a different word." message used for the client-side reject.
drop policy if exists "anyone can insert their own daily word" on words;
create policy "anyone can insert their own daily word"
  on words for insert
  with check (
    word ~ '^[a-z0-9][a-z0-9''_-]{0,19}( [a-z0-9][a-z0-9''_-]{0,19})*$'
    and length(word) <= 30
    and length(device_id) between 8 and 64
    and word !~ '(^|[^a-z])(fuck(ing|er|ers)?|motherfucker|shit|bitch|cunt|dick|cock|pussy|asshole|bastard|slut|whore|fag|faggots?|nig+(a|as|az|ah|er|ers)|retard(ed)?|kike|chink|spic|gook|coon|tranny|wetback)([^a-z]|$)'
  );
-- One-word-per-device-per-day is enforced by the unique index
-- `words_one_per_device_per_day` above. We deliberately don't repeat that
-- check in the policy because doing so requires SELECT on device_id, which
-- anon no longer has (see column-grants block above). On duplicate the
-- unique index returns 23505 → PostgREST 409, which the client handles.

-- Aggregated views: one row per (word, utc_date) — avoids the PostgREST 1000-row cap.
drop view if exists word_counts;
create view word_counts
with (security_invoker = true)
as
  select word, utc_date, count(*)::int as count
  from words
  group by word, utc_date;
grant select on word_counts to anon, authenticated;

drop view if exists day_totals;
create view day_totals
with (security_invoker = true)
as
  select utc_date,
         count(*)::int as voices,
         count(distinct word)::int as unique_words,
         count(*) filter (where word in (
           select word from words w2 where w2.utc_date = words.utc_date group by word having count(*) = 1
         ))::int as said_once
  from words
  group by utc_date;
grant select on day_totals to anon, authenticated;

-- Telemetry: failed input attempts (e.g., user tried to enter a multi-word phrase).
-- Insert-only from anon. Read via service key in the dashboard.
create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('multi_word','non_letters','too_long','profanity')),
  input_text text not null check (length(input_text) between 1 and 200),
  device_id text not null check (length(device_id) between 8 and 64),
  created_at timestamptz not null default now()
);

create index if not exists attempts_by_kind_at on attempts (kind, created_at desc);

alter table attempts enable row level security;

drop policy if exists "anyone can insert attempt" on attempts;
create policy "anyone can insert attempt"
  on attempts for insert
  with check (
    kind in ('multi_word','non_letters','too_long','profanity')
    and length(input_text) between 1 and 200
    and length(device_id) between 8 and 64
  );

-- Product analytics: discrete user-action events.
-- Insert-only from anon. Read via service key for funnels in SQL.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'page_view','word_submitted','history_opened','share_card_copy',
    'share_card_download','share_card_share'
  )),
  device_id text not null check (length(device_id) between 8 and 64),
  referrer text check (referrer is null or length(referrer) <= 500),
  user_agent text check (user_agent is null or length(user_agent) <= 500),
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_by_kind_at on events (kind, created_at desc);
create index if not exists events_by_device_at on events (device_id, created_at desc);

alter table events enable row level security;

drop policy if exists "anyone can insert event" on events;
create policy "anyone can insert event"
  on events for insert
  with check (
    kind in (
      'page_view','word_submitted','history_opened','share_card_copy',
      'share_card_download','share_card_share'
    )
    and length(device_id) between 8 and 64
    and (referrer is null or length(referrer) <= 500)
    and (user_agent is null or length(user_agent) <= 500)
  );
