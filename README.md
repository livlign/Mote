# Mote

One word a day. A shared cloud of what the world is thinking. Resets at 00:00 UTC.

## Setup

1. **Create a Supabase project** at https://supabase.com (free tier is fine).
2. **Run the schema.** In the Supabase SQL editor, paste and run `schema.sql`.
3. **Get your keys.** In Supabase → Project Settings → API, copy the Project URL and the `anon` public key.
4. **Wire them in.** Open `index.html` and replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY` near the top of the `<script>` block.
5. **Run locally.** Any static server works:
   ```
   python3 -m http.server 8000
   ```
   Open http://localhost:8000.

## Deploy

1. Push to a Git repo.
2. In Cloudflare Pages, create a new project from the repo. No build command, output directory is `/`.
3. In Pages → Custom domains, add `mote.day` and follow the DNS instructions.

## Notes

- One-word-per-device-per-day is enforced by a unique index on `(device_id, utc_date)`. The client just catches the duplicate response.
- The user's own word is kept in `localStorage` for 24 hours from submission, so it stays visible across the UTC reset.
- Profanity filter is a small wordlist in `index.html` — replace with a real filter when you outgrow it.
- `device_id` is a `localStorage` UUID. Clearing it lets a user submit again. That's a known v1 limitation.
