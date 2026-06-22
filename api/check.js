// Cron target (/api/check) — runs the checks and appends one daily snapshot to the rolling history.
// Scheduled daily in vercel.json. Safe to hit manually too.
import { runChecks } from './_checks.js';

const KEY = 'toke:status:daily';
const CURRENT = 'toke:status:current';
const MAX_DAYS = 90;

function redis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}
async function rGet(r, key) {
  try { const res = await fetch(`${r.url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${r.token}` } }); const j = await res.json(); return j && j.result ? JSON.parse(j.result) : null; } catch { return null; }
}
async function rSet(r, key, val) {
  try { await fetch(`${r.url}/set/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${r.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(val) }); } catch { /* ignore */ }
}

export default async function handler(req, res) {
  const result = await runChecks();
  const r = redis();
  if (r) {
    const today = result.generated.slice(0, 10);
    const seg = {}; result.segments.forEach(s => { seg[s.key] = s.state; });
    let hist = (await rGet(r, KEY)) || [];
    hist = hist.filter(d => d.d !== today);          // replace today's entry if re-run
    hist.push({ d: today, overall: result.overall, s: seg });
    if (hist.length > MAX_DAYS) hist = hist.slice(-MAX_DAYS);
    await rSet(r, KEY, hist);
    await rSet(r, CURRENT, result);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, stored: !!r, overall: result.overall, generated: result.generated });
}
