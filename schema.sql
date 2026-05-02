create extension if not exists "pgcrypto";

create table if not exists words (
  id uuid primary key default gen_random_uuid(),
  word text not null check (word ~ '^[a-z]{1,20}$'),
  device_id text not null,
  submitted_at timestamptz not null default now(),
  utc_date date generated always as ((submitted_at at time zone 'UTC')::date) stored
);

create index if not exists words_utc_date_idx on words (utc_date);
create unique index if not exists words_device_date_uidx on words (device_id, utc_date);

alter table words enable row level security;

drop policy if exists words_select_all on words;
create policy words_select_all on words
  for select
  using (true);

drop policy if exists words_insert_anon on words;
create policy words_insert_anon on words
  for insert
  with check (
    word ~ '^[a-z]{1,20}$'
    and length(device_id) between 8 and 64
  );

-- Aggregated view: one row per (word, utc_date) with the count of voices.
-- This avoids hitting the PostgREST max-rows cap on the raw words table.
drop view if exists word_counts;
create view word_counts
with (security_invoker = true)
as
  select word, utc_date, count(*)::int as count
  from words
  group by word, utc_date;

grant select on word_counts to anon, authenticated;

-- Daily totals for archive views (last N days, etc).
drop view if exists day_totals;
create view day_totals
with (security_invoker = true)
as
  select utc_date, count(*)::int as total, count(distinct word)::int as unique_words
  from words
  group by utc_date;

grant select on day_totals to anon, authenticated;
