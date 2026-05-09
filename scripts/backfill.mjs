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
//   --future          seed today + N future days instead of past days
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
const FUTURE = !!args.future;
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
  // feelings (kept lighter — these dominated before)
  ["tired", 9], ["happy", 7], ["anxious", 6], ["hopeful", 5], ["calm", 5],
  ["stressed", 6], ["sad", 5], ["okay", 7], ["fine", 6], ["bored", 4],
  ["excited", 4], ["lonely", 3], ["grateful", 4], ["nervous", 3], ["content", 3],
  ["overwhelmed", 3], ["restless", 3], ["peaceful", 3], ["curious", 3],
  // weather / season (referenced by planDay bumps — keep)
  ["rainy", 5], ["sunny", 5], ["cold", 5], ["hot", 4], ["cloudy", 3],
  ["foggy", 2], ["snow", 2], ["windy", 2], ["storm", 2], ["warm", 3],
  ["spring", 2], ["winter", 2], ["autumn", 2], ["summer", 3],
  // weekdays (referenced by planDay bumps — keep)
  ["monday", 3], ["friday", 3], ["weekend", 4], ["sunday", 2],
  // music
  ["music", 5], ["song", 5], ["album", 3], ["concert", 3], ["vinyl", 2],
  ["jazz", 3], ["pop", 2], ["rock", 3], ["indie", 2], ["techno", 2],
  ["lyrics", 2], ["melody", 2], ["beats", 2], ["playlist", 4], ["spotify", 3],
  ["radio", 2], ["chorus", 2], ["bass", 2], ["piano", 3], ["guitar", 3],
  ["singing", 2], ["dancing", 3], ["rhythm", 2], ["headphones", 2],
  // film / books / stories
  ["movie", 4], ["cinema", 2], ["film", 3], ["popcorn", 2], ["oscar", 1],
  ["actor", 2], ["scene", 2], ["plot", 2], ["sequel", 2], ["trailer", 2],
  ["book", 5], ["novel", 3], ["chapter", 2], ["poetry", 2], ["library", 2],
  ["story", 4], ["author", 2], ["fiction", 2], ["memoir", 2],
  // food / drink
  ["coffee", 7], ["tea", 4], ["matcha", 2], ["wine", 3], ["beer", 3],
  ["pasta", 3], ["pizza", 4], ["ramen", 3], ["sushi", 2], ["bread", 3],
  ["cheese", 2], ["chocolate", 4], ["cake", 3], ["brunch", 3], ["dinner", 4],
  ["lunch", 3], ["breakfast", 3], ["cooking", 3], ["recipe", 2], ["spicy", 2],
  ["sweet", 2], ["hungry", 4], ["snack", 2],
  // life / milestones / people
  ["family", 5], ["love", 6], ["friends", 4], ["mom", 3], ["dad", 3],
  ["partner", 2], ["kids", 3], ["birthday", 3], ["wedding", 2], ["funeral", 1],
  ["reunion", 1], ["date", 3], ["crush", 2], ["breakup", 2], ["therapy", 3],
  // work / study
  ["work", 8], ["meeting", 4], ["deadline", 4], ["project", 3], ["email", 4],
  ["slack", 3], ["zoom", 3], ["interview", 2], ["promotion", 1], ["raise", 1],
  ["resume", 1], ["startup", 2], ["code", 4], ["debug", 2], ["bug", 3],
  ["launch", 2], ["demo", 2], ["school", 3], ["exam", 3], ["essay", 2],
  ["thesis", 1], ["studying", 3], ["lecture", 2], ["homework", 2],
  // body / health / sport
  ["sleep", 6], ["nap", 3], ["yoga", 3], ["gym", 3], ["running", 3],
  ["walking", 3], ["hiking", 2], ["swimming", 2], ["cycling", 2], ["climbing", 1],
  ["soccer", 2], ["tennis", 1], ["chess", 2], ["meditation", 2], ["sick", 3],
  ["headache", 2], ["fever", 1], ["healthy", 2], ["broken", 2], ["sober", 2],
  // travel / places
  ["travel", 3], ["flight", 3], ["airport", 2], ["train", 3], ["beach", 3],
  ["mountains", 2], ["paris", 2], ["tokyo", 2], ["lisbon", 1], ["berlin", 1],
  ["roadtrip", 1], ["camping", 2], ["hotel", 2], ["holiday", 3], ["vacation", 3],
  ["jetlag", 2], ["packing", 2],
  // home / things / nature
  ["home", 6], ["garden", 3], ["plants", 3], ["dog", 3], ["cat", 3],
  ["bike", 3], ["car", 3], ["keys", 2], ["laundry", 3], ["dishes", 2],
  ["cleaning", 2], ["moving", 2], ["rent", 3], ["mortgage", 1],
  // creative / digital
  ["art", 3], ["painting", 2], ["drawing", 2], ["photo", 3], ["camera", 2],
  ["writing", 3], ["journal", 2], ["podcast", 3], ["youtube", 3], ["tiktok", 3],
  ["instagram", 3], ["news", 4], ["election", 2], ["protest", 1], ["market", 2],
  ["crypto", 2], ["taxes", 2],
  // money
  ["money", 5], ["bills", 2], ["broke", 2], ["payday", 2], ["bonus", 1],
  // qualities / states
  ["busy", 6], ["focused", 4], ["lost", 4], ["ready", 3], ["stuck", 4],
  ["slow", 3], ["fast", 3], ["quiet", 4], ["loud", 3], ["alive", 3],
  ["new", 3], ["old", 3], ["alone", 3], ["together", 3], ["lucky", 2],
  // time / abstractions
  ["morning", 4], ["late", 5], ["midnight", 2], ["dawn", 1], ["weekend", 0],
  ["hope", 5], ["fear", 3], ["dream", 4], ["change", 3], ["time", 5],
  ["maybe", 3], ["soon", 3], ["wait", 3], ["done", 3], ["beginning", 2],
  ["ending", 2], ["future", 2], ["past", 2],
  // arbitrary / diverse — exercises the relaxed validation:
  // digits, hyphens, underscores, apostrophes, multi-word
  ["404", 2], ["42", 1], ["2026", 2], ["3am", 3], ["5pm", 2],
  ["wfh", 4], ["ooo", 2], ["irl", 2], ["tbh", 3], ["imo", 1], ["fomo", 2],
  ["side-project", 3], ["stand-up", 3], ["deep-work", 3], ["burn-out", 3],
  ["check-in", 2], ["one-on-one", 2], ["game-night", 2], ["self-care", 3],
  ["jet-lagged", 2], ["over-it", 3], ["half-asleep", 3], ["all-nighter", 2],
  ["good day", 4], ["bad day", 4], ["long day", 5], ["slow day", 3],
  ["rough morning", 3], ["quiet sunday", 2], ["lazy afternoon", 2],
  ["new chapter", 2], ["mixed feelings", 3], ["small wins", 3],
  ["low key", 3], ["high key", 2], ["full circle", 2], ["barely there", 2],
  ["meh", 5], ["ugh", 4], ["yay", 3], ["oof", 4], ["welp", 3],
  ["c'est la vie", 1], ["here we go", 2], ["who knows", 2],
  ["deep_focus", 2], ["zero_inbox", 1], ["pr_review", 2],
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
function utcDayForward(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
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

const weather = buildWeatherClusters(FUTURE ? DAYS + 1 : DAYS);
const allRows = [];
let deviceCounter = 0;
function nextDevice(date) {
  deviceCounter++;
  return `seed-${date}-${deviceCounter.toString(36).padStart(6, "0")}`;
}

const startI = FUTURE ? 0 : 1;
const endI = FUTURE ? DAYS : DAYS;
for (let i = startI; i <= endI; i++) {
  const dateObj = FUTURE ? utcDayForward(i) : utcDayBack(i);
  const dateStr = isoDate(dateObj);
  const idx = FUTURE ? i : i - 1;
  const plan = planDay(dateObj, idx, weather[idx] ?? "normal");
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
