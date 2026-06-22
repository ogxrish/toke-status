// GET /api/history — current status (live, server-side checks) + rolling daily uptime history.
import { runChecks } from './_checks.js';

const KEY = 'toke:status:daily';

function redis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}
async function redisGet(r, key) {
  try {
    const res = await fetch(`${r.url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${r.token}` } });
    const j = await res.json();
    return j && j.result ? JSON.parse(j.result) : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  try {
    const current = await runChecks();
    const r = redis();
    const history = r ? (await redisGet(r, KEY)) || [] : [];
    res.status(200).json({ current, history, days: 90, generated: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ current: { overall: 'warn', segments: [] }, history: [], error: String(e && e.message || e) });
  }
}
