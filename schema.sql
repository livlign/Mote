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
