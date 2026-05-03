# Mote

> **One word per person, per day. The world's words, set big.**

A daily word ritual. Each visitor types one word about their day, and the world's words gather into a live cloud — bigger when more people say the same thing. The canvas resets at 00:00 UTC, and yesterday slips into the history view.

🌐 **Live:** [mote.day](https://mote.day)
📜 **License:** [MIT](LICENSE)

![Mote — Today, in a Word](og.png)

---

## Why

Twitter feeds are loud, polls are leading, and "how are you?" expects "fine." Mote asks for one word and shows you the planet's mood at a glance. No accounts, no comments, no algorithm — just a word and a shared canvas.

## How it works

- One submission per device per day, enforced both by a unique DB index and an RLS policy.
- Word size on the canvas scales with how many people said it.
- The cloud refreshes every ~25 seconds and on tab focus.
- Your own word is pinned in `localStorage` for 24 hours so it stays visible across the UTC reset.
- A history view (last 7 days, single-day breakdown) lives behind the **History** button.

## Stack

| Layer | What |
|-------|------|
| Frontend | One static `index.html` — vanilla JS, no build step, Geist + Geist Mono via Google Fonts |
| Storage | Supabase (Postgres + RLS, anon-key writes constrained by policy) |
| Hosting | Cloudflare Pages |
| Domain | Cloudflare Registrar |

There is intentionally no framework, bundler, or backend service to run. The whole client is ~2k lines of HTML + JS.

## Run it locally

You need a Supabase project (free tier is fine).

1. Create a project at https://supabase.com.
2. SQL Editor → paste and run [`schema.sql`](schema.sql).
3. Project Settings → API → copy the URL and the publishable key (`sb_publishable_…`).
4. In `index.html`, replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` near the top of the `<script>` block.
5. Serve the directory:
   ```
   python3 -m http.server 8000
   ```
   Open <http://localhost:8000>.

## Self-host

**Cloudflare Pages, Git-connected:** point a Pages project at your fork, production branch `main`, no build command, output directory `/`. Auto-deploys on push.

**Direct upload:**
```
npx wrangler pages deploy . --project-name=mote --branch=main
```

Custom domain: Pages project → Custom domains → add yours.

## Project layout

```
.
├── index.html         # the entire app
├── schema.sql         # Supabase tables, RLS, aggregation views
├── og.png             # 1200×630 link-preview image
├── scripts/og.html    # source for og.png — re-render with headless Chrome
└── LICENSE
```

### Regenerate the OG image

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
  --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot=og.png "file://$PWD/scripts/og.html"
```

### Wipe seeded rows

Any seeded data uses a `seed-` prefix on `device_id`:

```sql
delete from words where device_id like 'seed-%';
```

## Design notes

- One-word-per-device-per-day is enforced **at the database** (unique index + RLS `not exists` check), not just in the client. Clearing `localStorage` lets a user submit again — known v1 limitation.
- Aggregation goes through the `word_counts` view to avoid PostgREST's 1000-row cap on the raw `words` table.
- The Supabase publishable key is hard-coded in `index.html`. That is fine — it is the anon key, and RLS does the work.
- The profanity filter is a small inline wordlist. Replace with a real moderation layer when traffic outgrows it.
- Words are stored lowercase, `^[a-z]{1,20}$`, no spaces — enforced at the DB and the input.

## Contributing

Issues and PRs welcome. A few notes:

- Please open an issue before a large change, so we can talk through scope before you spend time.
- Keep the no-build-step, single-`index.html` constraint — adding a bundler is a non-goal.
- Match the existing visual language (Swiss / typographic, cobalt accent `#0033CC`, Geist).
- Don't add tracking, analytics, or third-party scripts.
- New copy should be terse and human — read aloud before shipping.

**Good first issues**

- Better empty / error states.
- Internationalization (the `^[a-z]` regex blocks non-Latin scripts).
- Mobile keyboard polish.
- A real moderation layer behind the inline profanity list.

To run a PR:

```
git clone https://github.com/livlign/Mote.git
cd Mote
# edit index.html with your Supabase keys
python3 -m http.server 8000
```

## Acknowledgements

- Typography: [Geist](https://vercel.com/font) by Vercel.
- Hosting: [Cloudflare Pages](https://pages.cloudflare.com/).
- Backend: [Supabase](https://supabase.com).

## License

[MIT](LICENSE) © 2026 linhtt
