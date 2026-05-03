# Mote

One word per person, per day. The world's words, set big. Resets at 00:00 UTC.

## Setup

1. **Create a Supabase project** at https://supabase.com (free tier).
2. **Run the schema.** SQL Editor → paste and run `schema.sql`.
3. **Get your keys.** Project Settings → API → copy the Project URL and the publishable key (`sb_publishable_...`).
4. **Wire them in.** Open `index.html` and replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` near the top of the `<script>` block.
5. **Run locally.** Any static server works:
   ```
   python3 -m http.server 8000
   ```
   Open http://localhost:8000.

## Deploy

1. Push to a Git repo.
2. In Cloudflare Pages, create a new project from the repo. No build command, output directory `/`.
3. Pages → Custom domains → add `mote.day`. DNS configures automatically (domain is on Cloudflare Registrar).

## Notes

- One-word-per-device-per-day is enforced at the database level via a unique index AND an RLS policy with a `not exists` check.
- The user's own word is kept in `localStorage` for 24 hours from submission, so it stays visible across the UTC reset.
- Profanity filter is a small inline wordlist in `index.html` — replace with a real filter when you outgrow it.
- Aggregation goes through the `word_counts` view to avoid the PostgREST 1000-row cap on the raw `words` table.
- `device_id` is a localStorage UUID. Clearing it lets a user submit again. Known v1 limitation.

## Dev mode

Visit `?dev=1` once to enable the dev panel (sticky via localStorage). Visit `?dev=0` to disable.

The panel offers:
- **Reset** — clears your local "you said X" + assigns a new device ID.
- **Drop word** — adds 20–50 voices for a fresh pseudo-word.
- **Toggle drip** — drops a fresh word every 4s.
- **Toggle early state** — forces the early-day (under 30 voices) layout.

The seeder script `seed.mjs` is for local stress testing:
```
node seed.mjs --count 1000          # one-shot seed
node seed.mjs --drip --every 4      # forever drip
```

To wipe seeded rows, run in the Supabase SQL Editor:
```sql
delete from words where device_id like 'seed-%';
```

Both the dev panel and `seed.mjs` should be removed before merging to `main`.
