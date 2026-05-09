// Daily Bluesky bot for mote.day.
//
// Cron: 00:05 UTC. Reads yesterday's top word + total voices from Supabase,
// renders a PNG link-card thumb showing that word, posts to Bluesky.
//
// PNG is rendered IN the worker (resvg-wasm) rather than via a Pages
// Function so the static site stays build-free. Static /og.png remains in
// the Pages site as a generic fallback for twitter:image scrapers.
//
// Bluesky's posting flow:
//   1. POST /xrpc/com.atproto.server.createSession with handle+app password
//   2. POST /xrpc/com.atproto.repo.uploadBlob with the PNG bytes
//   3. POST /xrpc/com.atproto.repo.createRecord with embed.external.thumb
//
// Setting up:
//   cd workers/bsky-bot
//   npm install
//   npx wrangler secret put BSKY_HANDLE         # e.g. mote.day
//   npx wrangler secret put BSKY_APP_PASSWORD   # bsky.app → Settings → App Passwords
//   npx wrangler secret put RUN_TOKEN           # any random string
//   npx wrangler deploy
//
// Manual trigger for testing:
//   curl "https://mote-bsky-bot.<sub>.workers.dev/run?token=<RUN_TOKEN>"

import initWasm, { Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";

const SUPABASE_URL = "https://mhtutulyduovxubzpnvd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uP6fxaX0sr5Msc3a507uwA_2rtT_E1J";
const BSKY_PDS = "https://bsky.social";
const SITE_URL = "https://mote.day";

let wasmReady;
async function ensureWasm() {
  if (!wasmReady) wasmReady = initWasm(resvgWasm);
  return wasmReady;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  // Allow manual trigger via HTTP for testing: GET /run?token=...
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/run") return new Response("not found", { status: 404 });
    if (!env.RUN_TOKEN || url.searchParams.get("token") !== env.RUN_TOKEN) {
      return new Response("unauthorized", { status: 401 });
    }
    const result = await run(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "content-type": "application/json" },
    });
  },
};

async function run(env) {
  const yesterday = utcDateOffset(-1);
  const { topWord, topCount, voices } = await fetchYesterday(yesterday);

  if (!topWord || voices === 0) {
    return { skipped: "no data for " + yesterday };
  }

  const text = composePost({ topWord, topCount, voices, date: yesterday });
  const session = await createSession(env);

  // Render a PNG with yesterday's top word and upload as a Bluesky blob.
  // Bluesky requires raster (rejects SVG); rendering here keeps Pages
  // build-free.
  let thumb = null;
  try {
    const png = await renderPNG({ topWord, topCount, voices });
    thumb = await uploadBlob(session, png, "image/png");
  } catch (e) {
    // Non-fatal — post without thumbnail rather than skipping.
  }

  const embed = {
    $type: "app.bsky.embed.external",
    external: {
      uri: SITE_URL,
      title: `Mote — ${topWord}`,
      description: `${voices.toLocaleString()} voices yesterday · today's word resets at 00:00 UTC`,
      ...(thumb ? { thumb } : {}),
    },
  };

  const postRes = await createPost(session, text, embed);
  return { posted: true, date: yesterday, topWord, voices, uri: postRes.uri };
}

async function uploadBlob(session, bytes, mimeType) {
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: {
      "content-type": mimeType,
      authorization: `Bearer ${session.accessJwt}`,
    },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`uploadBlob failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json(); // { blob: { $type, ref, mimeType, size } }
  return json.blob;
}

function utcDateOffset(deltaDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

async function fetchYesterday(date) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };

  const topRes = await fetch(
    `${SUPABASE_URL}/rest/v1/word_counts?utc_date=eq.${date}&order=count.desc&limit=1`,
    { headers }
  );
  const topRows = topRes.ok ? await topRes.json() : [];
  const topWord = topRows[0]?.word ?? null;
  const topCount = topRows[0]?.count ?? 0;

  const allRes = await fetch(
    `${SUPABASE_URL}/rest/v1/word_counts?utc_date=eq.${date}&select=count`,
    { headers }
  );
  const allRows = allRes.ok ? await allRes.json() : [];
  const voices = allRows.reduce((sum, r) => sum + (r.count || 0), 0);

  return { topWord, topCount, voices };
}

function composePost({ topWord, topCount, voices, date }) {
  const dateLabel = new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  // Keep under 300 chars (Bluesky cap).
  return [
    `Yesterday — ${dateLabel}`,
    "",
    `The world said “${topWord}”.`,
    `${topCount} voice${topCount === 1 ? "" : "s"} of ${voices.toLocaleString()} chose it.`,
    "",
    `Today's word: ${SITE_URL}`,
  ].join("\n");
}

async function createSession(env) {
  if (!env.BSKY_HANDLE || !env.BSKY_APP_PASSWORD) {
    throw new Error("Missing BSKY_HANDLE / BSKY_APP_PASSWORD secrets");
  }
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: env.BSKY_HANDLE,
      password: env.BSKY_APP_PASSWORD,
    }),
  });
  if (!res.ok) {
    throw new Error(`createSession failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { accessJwt, did, ... }
}

async function createPost(session, text, embed) {
  const facets = buildFacets(text);
  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    langs: ["en"],
    ...(facets.length ? { facets } : {}),
    ...(embed ? { embed } : {}),
  };
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record,
    }),
  });
  if (!res.ok) {
    throw new Error(`createPost failed: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { uri, cid }
}

// Mark the URL in the post text as a real link facet so Bluesky renders the
// link card (with the dynamic og:image from /og.svg).
function buildFacets(text) {
  const out = [];
  const urlRe = /https?:\/\/\S+/g;
  // ATProto byte offsets are over UTF-8.
  const enc = new TextEncoder();
  let match;
  while ((match = urlRe.exec(text)) !== null) {
    const before = text.slice(0, match.index);
    const start = enc.encode(before).length;
    const end = start + enc.encode(match[0]).length;
    out.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }],
    });
  }
  return out;
}

// — OG render —

async function renderPNG({ topWord, topCount, voices }) {
  await ensureWasm();
  const svg = renderSVG({ topWord, topCount, voices });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

function renderSVG({ topWord, topCount, voices }) {
  const headline = (topWord || "TODAY, IN A WORD.").toUpperCase();
  const sub = topWord
    ? `${voices.toLocaleString()} ${voices === 1 ? "voice" : "voices"} yesterday · ${topCount} said "${topWord}"`
    : "What's the world thinking today?";

  const wordSize = sizeForWord(topWord || "TODAY");
  const lines = headline.split("\n");
  const lineHeight = wordSize * 0.95;
  const totalH = lines.length * lineHeight;
  const startY = 315 - totalH / 2 + lineHeight * 0.78;

  const headlineSvg = lines
    .map(
      (line, i) =>
        `<text x="80" y="${startY + i * lineHeight}" font-family="sans-serif" font-weight="800" font-size="${wordSize}" letter-spacing="-0.04em" fill="#000">${escapeXML(line)}</text>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#FFFFFF"/>
  <g transform="translate(80,80)">
    <circle cx="19" cy="6" r="4" fill="#0033CC"/>
    <circle cx="11" cy="20" r="4" fill="#0033CC"/>
    <circle cx="27" cy="20" r="4" fill="#0033CC"/>
    <text x="54" y="26" font-family="serif" font-weight="500" font-size="44" letter-spacing="-0.04em" fill="#000">mote</text>
  </g>
  ${headlineSvg}
  <text x="80" y="${startY + (lines.length - 1) * lineHeight + 90}" font-family="sans-serif" font-weight="500" font-size="30" fill="rgba(0,0,0,0.55)">${escapeXML(sub)}</text>
  <text x="80" y="542" font-family="serif" font-weight="500" font-size="30" letter-spacing="-0.025em" fill="rgba(0,0,0,0.55)">mote.day</text>
  <g transform="translate(820,510)">
    <rect width="300" height="48" fill="#0033CC"/>
    <text x="20" y="32" font-family="sans-serif" font-weight="700" font-size="20" letter-spacing="0.14em" fill="#FFFFFF">SAY YOURS  →</text>
  </g>
  <rect x="0" y="628" width="1200" height="2" fill="#000"/>
</svg>`;
}

function escapeXML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

function sizeForWord(word) {
  const len = word.length;
  if (len <= 6) return 220;
  if (len <= 10) return 170;
  if (len <= 14) return 140;
  if (len <= 20) return 110;
  return 88;
}
