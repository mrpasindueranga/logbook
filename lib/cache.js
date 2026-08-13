const Redis = require("ioredis");

// Best-effort read cache — a slow/missing Redis must never break the app.
// enableOfflineQueue:false makes commands reject immediately while
// disconnected instead of hanging, so every call below fails fast into its
// catch block and falls through to a normal DB read.
const client = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || "0", 10),
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

let warned = false;
client.on("error", (err) => {
  if (warned) return;
  warned = true;
  console.warn(`[cache] Redis unavailable, running without caching: ${err.message}`);
});
client.on("ready", () => {
  warned = false;
});

async function get(key) {
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

async function set(key, value, ttlSeconds) {
  try {
    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // best-effort — a failed write just means the next read misses
  }
}

async function del(...keys) {
  const flat = keys.flat().filter(Boolean);
  if (!flat.length) return;
  try {
    await client.del(flat);
  } catch {
    // ignore
  }
}

/** Delete every key matching a glob pattern (e.g. "notes:project:12:*"). */
async function delPattern(pattern) {
  try {
    const keys = await client.keys(pattern);
    if (keys.length) await client.del(keys);
  } catch {
    // ignore
  }
}

/** Cache-aside helper: return the cached value, or call fn(), cache it, and return it. */
async function cached(key, ttlSeconds, fn) {
  const hit = await get(key);
  if (hit !== null) return hit;
  const value = await fn();
  set(key, value, ttlSeconds); // fire-and-forget
  return value;
}

module.exports = { cached, get, set, del, delPattern };
