// Mote seeder.
//   node seed.mjs --count 1000      -> insert N words for today
//   node seed.mjs --drip --every 4  -> insert one word every N seconds, forever
//   node seed.mjs --wipe             -> delete today's seeded words (device_id starts with seed-)
//
// Uses the publishable key + RLS insert policy. Each row gets a unique fake device_id.

import { randomUUID } from "node:crypto";

const SUPABASE_URL = "https://mhtutulyduovxubzpnvd.supabase.co";
const SUPABASE_KEY = "sb_publishable_uP6fxaX0sr5Msc3a507uwA_2rtT_E1J";

// Hand-ranked: earlier words get more weight (zipf-ish). Curated daily-mood words.
const WORDS = [
  "tired","hope","busy","fine","ok","content","calm","hungry","alive","focused",
  "anxious","grateful","lucky","lost","bright","cold","warm","cozy","blah","good",
  "rested","drained","grumpy","peaceful","restless","curious","bored","excited","scared","still",
  "sun","rain","monday","friday","weekend","work","home","coffee","quiet","loud",
  "soft","sharp","heavy","light","slow","fast","empty","full","clear","fuzzy",
  "writing","reading","running","dreaming","waiting","thinking","missing","wanting","trying","resting",
  "ready","unready","late","early","early","forgotten","remembered","seen","unseen","held",
  "small","big","tender","brittle","raw","cooked","hungry","thirsty","sleepy","awake",
  "alone","together","lonely","loved","missed","heard","quiet","spring","green","blue",
  "grey","gold","new","old","starting","ending","return","arrive","leave","stay",
  "wonder","wander","seek","find","lose","keep","let","go","press","pause",
  "rush","drift","float","sink","rise","fall","climb","glide","spin","still",
  "ink","paper","pen","page","book","line","word","silence","music","song",
  "morning","noon","afternoon","evening","night","midnight","dawn","dusk","sky","cloud",
  "stone","river","tree","leaf","grass","wind","fire","earth","water","air"
];

function pickWord() {
  // Zipf-style: rank r picked with weight 1/(r+1)^0.85
  const weights = WORDS.map((_, r) => 1 / Math.pow(r + 1, 0.85));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  for (let i = 0; i < WORDS.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return WORDS[i];
  }
  return WORDS[0];
}

async function insertOne(word) {
  const deviceId = "seed-" + randomUUID();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/words`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({ word, device_id: deviceId })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t}`);
  }
}

async function wipe() {
  // Can't delete via anon; user needs to run SQL: delete from words where device_id like 'seed-%';
  console.log("To wipe seeds, run this SQL in Supabase:");
  console.log("  delete from words where device_id like 'seed-%';");
}

async function bulk(count) {
  console.log(`Seeding ${count} words…`);
  let done = 0, fails = 0;
  const batchSize = 25;
  for (let i = 0; i < count; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < count; j++) {
      batch.push(insertOne(pickWord()).then(() => done++).catch(() => fails++));
    }
    await Promise.all(batch);
    process.stdout.write(`\r  ${done}/${count} (${fails} failed)`);
  }
  process.stdout.write("\n");
  console.log("Done.");
}

async function drip(everySec) {
  console.log(`Dripping one word every ${everySec}s. Ctrl+C to stop.`);
  while (true) {
    const word = pickWord();
    try {
      await insertOne(word);
      console.log(`  + ${word}`);
    } catch (e) {
      console.log(`  ! failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, everySec * 1000));
  }
}

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

if (args.includes("--wipe")) {
  await wipe();
} else if (args.includes("--drip")) {
  const every = parseFloat(arg("every", "4"));
  await drip(every);
} else {
  const count = parseInt(arg("count", "1000"), 10);
  await bulk(count);
}
