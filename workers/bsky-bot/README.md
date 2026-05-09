# mote-bsky-bot

Daily Bluesky bot for [mote.day](https://mote.day). Cron Worker that posts
yesterday's biggest word + total voices at 00:05 UTC.

## Setup

```sh
cd workers/bsky-bot

# Authenticate wrangler if you haven't (uses the same Cloudflare account
# as the Pages project).
npx wrangler whoami

# Bluesky credentials. Create a dedicated handle (e.g. mote.day on
# bsky.social) and an app password from Settings → App Passwords.
npx wrangler secret put BSKY_HANDLE         # e.g. mote.day
npx wrangler secret put BSKY_APP_PASSWORD   # the app password

# Optional: a token to allow manual triggering via HTTP.
npx wrangler secret put RUN_TOKEN           # any random string

# Deploy.
npx wrangler deploy
```

After deploy, the worker runs daily at 00:05 UTC. To trigger manually:

```sh
curl "https://mote-bsky-bot.<your-subdomain>.workers.dev/run?token=<RUN_TOKEN>"
```

Or locally:

```sh
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=5+0+*+*+*"
```

## What it posts

```
Yesterday — Friday, May 8

The world said "the boys".
53 voices of 1,204 chose it.

Today's word: https://mote.day
```

The trailing URL is rendered as a Bluesky link card pulling the dynamic
[/og.svg](https://mote.day/og.svg) image, so today's biggest word teases
in the post preview.
