// Daily Bluesky bot for mote.day.
//
// Cron: 00:05 UTC. Reads yesterday's top word + total voices from Supabase,
// posts one short message with a link card to mote.day. The link card lets
// Bluesky pull the dynamic OG image, so the post visually surfaces the
// actual word.
//
// Bluesky's posting flow:
//   1. POST /xrpc/com.atproto.server.createSession with handle+app password
//   2. POST /xrpc/com.atproto.repo.createRecord with the post body
//
// Setting up:
//   cd workers/bsky-bot
//   npx wrangler secret put BSKY_HANDLE         # e.g. mote.day
//   npx wrangler secret put BSKY_APP_PASSWORD   # bsky.app → Settings → App Passwords
//   npx wrangler deploy
//
// Manual trigger for testing:
//   npx wrangler dev --test-scheduled
//   curl "http://localhost:8787/__scheduled?cron=5+0+*+*+*"

const SUPABASE_URL = "https://mhtutulyduovxubzpnvd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uP6fxaX0sr5Msc3a507uwA_2rtT_E1J";
const BSKY_PDS = "https://bsky.social";
const SITE_URL = "https://mote.day";

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

  // Upload the OG image as a blob so the link card has a thumbnail.
  // Static og.png because Bluesky's blob handler rejects SVG (security).
  let thumb = null;
  try {
    const imgRes = await fetch(`${SITE_URL}/og.png`);
    if (imgRes.ok) {
      const bytes = await imgRes.arrayBuffer();
      thumb = await uploadBlob(session, bytes, "image/png");
    }
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
