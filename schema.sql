create extension if not exists "pgcrypto";

create table if not exists words (
  id uuid primary key default gen_random_uuid(),
  word text not null check (word ~ '^[a-z]{1,20}$'),
  device_id text not null,
  submitted_at timestamptz not null default now(),
  utc_date date generated always as ((submitted_at at time zone 'UTC')::date) stored
);

create unique index if not exists words_one_per_device_per_day on words (device_id, utc_date);
create index if not exists words_by_date on words (utc_date);
create index if not exists words_by_word_date on words (utc_date, word);

alter table words enable row level security;

drop policy if exists "anyone can read" on words;
create policy "anyone can read"
  on words for select
  using (true);

drop policy if exists "anyone can insert their own daily word" on words;
create policy "anyone can insert their own daily word"
  on words for insert
  with check (
    word ~ '^[a-z]{1,20}$'
    and length(device_id) between 8 and 64
    and not exists (
      select 1 from words w
      where w.device_id = words.device_id
        and w.utc_date = (now() at time zone 'UTC')::date
    )
  );

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
