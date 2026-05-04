#!/usr/bin/env node
// Backfill historical word submissions.
//
// Usage:
//   SUPABASE_URL=https://...supabase.co \
//   SUPABASE_SERVICE_KEY=eyJ... \
//   node scripts/backfill.mjs
//
// Optional flags:
//   --days=14         number of days back (excluding today) to seed
//   --dry-run         print plan, don't write
//   --seed=42         deterministic seed
//
// The script writes to `words` using the service key, bypassing RLS.
// utc_date is generated from submitted_at by the table.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const DAYS = Number(args.days ?? 14);
const DRY = !!args["dry-run"];
let SEED = Number(args.seed ?? 1337);

function rng() {
  SEED |= 0; SEED = SEED + 0x6D2B79F5 | 0;
  let t = Math.imul(SEED ^ SEED >>> 15, 1 | SEED);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function pickWeighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [it, w] of pairs) { r -= w; if (r <= 0) return it; }
  return pairs[pairs.length - 1][0];
}

const POOL = [
  ["tired", 14], ["happy", 10], ["anxious", 9], ["hopeful", 7], ["calm", 8],
  ["stressed", 9], ["sad", 7], ["okay", 12], ["fine", 10], ["bored", 6],
  ["excited", 6], ["lonely", 5], ["grateful", 5], ["angry", 4], ["nervous", 5],
  ["content", 4], ["overwhelmed", 5], ["restless", 4], ["peaceful", 4], ["empty", 3],
  ["rainy", 6], ["sunny", 6], ["cold", 7], ["hot", 5], ["cloudy", 4],
  ["foggy", 3], ["snow", 3], ["windy", 3], ["storm", 2], ["warm", 4],
  ["monday", 4], ["friday", 4], ["weekend", 5], ["morning", 5], ["late", 6],
  ["spring", 3], ["winter", 3], ["sunday", 3], ["midweek", 2],
  ["busy", 8], ["focused", 5], ["lost", 5], ["ready", 4], ["stuck", 5],
  ["alive", 3], ["slow", 4], ["fast", 3], ["quiet", 5], ["loud", 3],
  ["coffee", 9], ["tea", 4], ["dog", 3], ["cat", 3], ["work", 10],
  ["home", 7], ["music", 5], ["family", 5], ["love", 6], ["money", 5],
  ["sleep", 8], ["food", 4], ["run", 3], ["walk", 3], ["rain", 4],
  ["sun", 4], ["book", 3], ["movie", 2], ["news", 4], ["phone", 3],
  ["hope", 6], ["fear", 4], ["dream", 4], ["change", 4], ["time", 6],
  ["coffee", 4], ["meeting", 4], ["deadline", 4], ["holiday", 3], ["sick", 3],
  ["healthy", 3], ["broken", 3], ["new", 4], ["old", 3], ["alone", 4],
  ["together", 3], ["maybe", 4], ["soon", 3], ["wait", 3], ["done", 4],
  ["beginning", 2], ["ending", 2], ["lucky", 2], ["unlucky", 2], ["fog", 2],
];
const baseWeights = new Map();
for (const [w, wt] of POOL) baseWeights.set(w, (baseWeights.get(w) || 0) + wt);

function isoDate(d) { return d.toISOString().slice(0, 10); }
function utcDayBack(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function dayOfWeek(d) { return d.getUTCDay(); }

function planDay(date, dayIndex, weatherCluster) {
  let voices = Math.round(70 + rng() * 80);
  if (dayIndex === 4 || dayIndex === 10) voices = Math.round(25 + rng() * 12);
  const dow = dayOfWeek(date);
  const w = new Map(baseWeights);
  const bump = (word, mult) => { if (w.has(word)) w.set(word, w.get(word) * mult); };

  if (dow === 1) { bump("monday", 8); bump("tired", 1.6); }
  if (dow === 2) bump("tired", 1.4);
  if (dow === 3) bump("tired", 1.2);
  if (dow === 5) { bump("friday", 7); bump("weekend", 4); }
  if (dow === 6 || dow === 0) bump("weekend", 3);

  if (weatherCluster === "rainy") { bump("rainy", 5); bump("rain", 3); bump("cold", 1.5); bump("foggy", 2); }
  else if (weatherCluster === "sunny") { bump("sunny", 5); bump("sun", 3); bump("warm", 2); bump("hot", 1.5); }
  else if (weatherCluster === "cold") { bump("cold", 4); bump("snow", 3); bump("windy", 2); }

  const winnerCandidates = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const winner = pick(winnerCandidates)[0];
  const winnerCount = Math.round(15 + rng() * 11);

  const midN = 3 + Math.floor(rng() * 3);
  const middle = [];
  const used = new Set([winner]);
  const pool = [...w.entries()].filter(([k]) => !used.has(k));
  for (let i = 0; i < midN; i++) {
    const word = pickWeighted(pool.filter(([k]) => !used.has(k)));
    used.add(word);
    middle.push([word, Math.round(5 + rng() * 6)]);
  }

  const distribution = [[winner, winnerCount], ...middle];
  let totalAssigned = distribution.reduce((s, [, c]) => s + c, 0);
  if (voices < totalAssigned + 4) voices = totalAssigned + Math.round(8 + rng() * 12);
  const tailCount = voices - totalAssigned;
  const tailWords = [];
  const tailPool = [...w.entries()].filter(([k]) => !used.has(k));
  for (let i = 0; i < tailCount; i++) tailWords.push(pickWeighted(tailPool));

  const submissions = [];
  for (const [word, count] of distribution) {
    for (let i = 0; i < count; i++) submissions.push(word);
  }
  for (const word of tailWords) submissions.push(word);
  return { date, voices: submissions.length, submissions };
}

function buildWeatherClusters(n) {
  const states = ["normal", "rainy", "sunny", "cold"];
  const out = [];
  let cur = "normal";
  let runLeft = 0;
  for (let i = 0; i < n; i++) {
    if (runLeft <= 0) {
      cur = pick(states);
      runLeft = 2 + Math.floor(rng() * 3);
    }
    out.push(cur);
    runLeft--;
  }
  return out;
}

function timestampsForDay(date, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    let hour = rng() < 0.7
      ? 12 + Math.floor(rng() * 10)
      : Math.floor(rng() * 24);
    const minute = Math.floor(rng() * 60);
    const second = Math.floor(rng() * 60);
    const ms = Math.floor(rng() * 1000);
    const d = new Date(date);
    d.setUTCHours(hour, minute, second, ms);
    out.push(d);
  }
  out.sort((a, b) => a - b);
  return out;
}

const weather = buildWeatherClusters(DAYS);
const allRows = [];
let deviceCounter = 0;
function nextDevice(date) {
  deviceCounter++;
  return `seed-${date}-${deviceCounter.toString(36).padStart(6, "0")}`;
}

for (let i = 1; i <= DAYS; i++) {
  const dateObj = utcDayBack(i);
  const dateStr = isoDate(dateObj);
  const plan = planDay(dateObj, i - 1, weather[i - 1]);
  const ts = timestampsForDay(dateObj, plan.submissions.length);
  for (let j = 0; j < plan.submissions.length; j++) {
    allRows.push({
      word: plan.submissions[j],
      device_id: nextDevice(dateStr),
      submitted_at: ts[j].toISOString(),
    });
  }
  console.log(
    `${dateStr}  ${String(plan.voices).padStart(3)} voices  weather=${weather[i - 1]}` +
    `  top=${plan.submissions[0]}`
  );
}

console.log(`\nTotal rows: ${allRows.length}`);

if (DRY) {
  const tally = new Map();
  for (const r of allRows) tally.set(r.word, (tally.get(r.word) || 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log("Top 15 words across all days:");
  for (const [w, c] of top) console.log(`  ${w.padEnd(14)} ${c}`);
  process.exit(0);
}

const BATCH = 500;
for (let i = 0; i < allRows.length; i += BATCH) {
  const chunk = allRows.slice(i, i + BATCH);
  const res = await fetch(`${URL}/rest/v1/words`, {
    method: "POST",
    headers: {
      "apikey": KEY,
      "Authorization": `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(chunk),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`batch ${i}/${allRows.length} failed: ${res.status} ${t}`);
    process.exit(1);
  }
  console.log(`inserted ${i + chunk.length}/${allRows.length}`);
}
console.log("done.");
