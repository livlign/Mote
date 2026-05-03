# Mote

One word per person, per day. The world's words, set big. Resets at 00:00 UTC.

Live at **[mote.day](https://mote.day)**.

## Stack

- Static `index.html` — vanilla JS, no build step. Geist + Geist Mono from Google Fonts.
- Supabase (Postgres + RLS) for storage and aggregation.
- Cloudflare Pages for hosting; Cloudflare Registrar for the domain.
- `og.png` (1200×630) for link previews — regenerate from `scripts/og.html` (see below).

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

Two paths.

**Git-connected (recommended).** Cloudflare Pages → Connect to Git → select repo. Production branch `main`, no build command, output directory `/`. Every push to `main` auto-deploys.

**Direct upload via Wrangler.**
```
npx wrangler pages deploy . --project-name=mote --branch=main
```

Attach the domain: Pages project → Custom domains → add `mote.day`. DNS configures automatically when the domain is on Cloudflare Registrar.

## Notes

- One-word-per-device-per-day is enforced at the database level via a unique index AND an RLS policy with a `not exists` check.
- The user's own word is kept in `localStorage` for 24 hours from submission, so it stays visible across the UTC reset.
- Profanity filter is a small inline wordlist in `index.html` — replace with a real filter when you outgrow it.
- Aggregation goes through the `word_counts` view to avoid the PostgREST 1000-row cap on the raw `words` table.
- `device_id` is a localStorage UUID. Clearing it lets a user submit again. Known v1 limitation.
- The Supabase publishable key is hard-coded in `index.html`. That is fine — it is the anon key, and RLS does the work — but treat it accordingly.

## Regenerate the OG image

The link-preview image (`og.png`) is rendered from `scripts/og.html` via headless Chrome:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
  --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot=og.png "file://$PWD/scripts/og.html"
```

Edit `scripts/og.html`, re-run, commit `og.png`.

## Maintenance

**Wipe seeded rows** (any `device_id` prefixed `seed-`):
```sql
delete from words where device_id like 'seed-%';
```

**Wipe all of today's words:**
```sql
delete from words where utc_date = (now() at time zone 'UTC')::date;
```
