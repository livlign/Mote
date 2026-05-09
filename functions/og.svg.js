// Dynamic OG image — Pages Function.
// Fetches today's top word + total voices from Supabase and renders an SVG
// matching the share-card aesthetic. Edge-cached for 5 minutes; the file
// is served at /og.svg (referenced from index.html's og:image meta).
//
// Returning SVG (not PNG) because rendering raster on the edge requires a
// wasm pipeline that bloats the function. Bluesky / Mastodon / Discord /
// Slack / Facebook / LinkedIn all render SVG og:image fine. X is the only
// scraper that's flaky; a static fallback in og.png covers it.

const SUPABASE_URL = "https://mhtutulyduovxubzpnvd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uP6fxaX0sr5Msc3a507uwA_2rtT_E1J";

export async function onRequestGet({ request }) {
  const today = new Date().toISOString().slice(0, 10);
  let topWord = null;
  let topCount = 0;
  let voices = 0;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/word_counts?utc_date=eq.${today}&order=count.desc&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        cf: { cacheTtl: 60 },
      }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows[0]) {
        topWord = rows[0].word;
        topCount = rows[0].count;
      }
    }

    const totalRes = await fetch(
      `${SUPABASE_URL}/rest/v1/word_counts?utc_date=eq.${today}&select=count`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        cf: { cacheTtl: 60 },
      }
    );
    if (totalRes.ok) {
      const rows = await totalRes.json();
      voices = rows.reduce((sum, r) => sum + (r.count || 0), 0);
    }
  } catch {}

  const svg = render({ topWord, topCount, voices, date: today });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}

function escapeXML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[c]));
}

function render({ topWord, topCount, voices, date }) {
  const hasWord = !!topWord;
  const headline = hasWord ? topWord.toUpperCase() : "TODAY,\nIN A WORD.";
  const sub = hasWord
    ? `${voices.toLocaleString()} ${voices === 1 ? "voice" : "voices"} today · ${topCount} said "${topWord}"`
    : "What's the world thinking today?";

  const wordSize = hasWord ? sizeForWord(topWord) : 140;
  const lines = headline.split("\n");
  const lineHeight = wordSize * 0.95;
  const totalH = lines.length * lineHeight;
  const startY = 315 - totalH / 2 + lineHeight * 0.78;

  const headlineSvg = lines
    .map(
      (line, i) =>
        `<text x="80" y="${startY + i * lineHeight}" font-family="Geist, system-ui, -apple-system, sans-serif" font-weight="800" font-size="${wordSize}" letter-spacing="-0.04em" fill="#000">${escapeXML(line)}</text>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#FFFFFF"/>

  <!-- brand -->
  <g transform="translate(80,80)">
    <circle cx="19" cy="6"  r="4" fill="#0033CC"/>
    <circle cx="11" cy="20" r="4" fill="#0033CC"/>
    <circle cx="27" cy="20" r="4" fill="#0033CC"/>
    <text x="54" y="26" font-family="Fraunces, Georgia, serif" font-weight="500" font-size="44" letter-spacing="-0.04em" fill="#000">mote</text>
  </g>

  <!-- headline -->
  ${headlineSvg}

  <!-- sub -->
  <text x="80" y="${startY + (lines.length - 1) * lineHeight + 90}" font-family="Geist, system-ui, sans-serif" font-weight="500" font-size="30" fill="rgba(0,0,0,0.55)">${escapeXML(sub)}</text>

  <!-- url -->
  <text x="80" y="542" font-family="Fraunces, Georgia, serif" font-weight="500" font-size="30" letter-spacing="-0.025em" fill="rgba(0,0,0,0.55)">mote.day</text>

  <!-- cta -->
  <g transform="translate(820,510)">
    <rect width="300" height="48" fill="#0033CC"/>
    <text x="20" y="32" font-family="Geist, sans-serif" font-weight="700" font-size="20" letter-spacing="0.14em" fill="#FFFFFF">SAY YOURS  →</text>
  </g>

  <!-- bottom rule -->
  <rect x="0" y="628" width="1200" height="2" fill="#000"/>
</svg>`;
}

function sizeForWord(word) {
  // Shrink for long words/phrases so they fit at 1040px usable width.
  const len = word.length;
  if (len <= 6) return 220;
  if (len <= 10) return 170;
  if (len <= 14) return 140;
  if (len <= 20) return 110;
  return 88;
}
