// Shared status checks — run server-side (no CORS), used by /api/history and /api/check (cron).
const EXPLORER = 'https://explorer.mctoken.xyz';
const API = 'https://api.mctoken.xyz/v1';
const SITE = 'https://mctoken.xyz/';
const TIMEOUT_MS = 8000;

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function reachable(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    return { ok: r.ok, ms: Date.now() - started, status: r.status };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

/** Returns { generated, overall, segments:[{key,name,state,detail}] } — state ∈ ok|warn|down. */
export async function runChecks() {
  // shared upstream fetches (once)
  let reliability = null, oracle = null, oracleMs = null;
  const relP = getJson(EXPLORER + '/api/v1/reliability.json').then(j => (reliability = j)).catch(() => null);
  const oraStart = Date.now();
  const oraP = getJson(API + '/oracle').then(j => { oracle = j; oracleMs = Date.now() - oraStart; }).catch(() => null);
  const siteP = reachable(SITE);
  const expP = reachable(EXPLORER + '/api/v1/reliability.json');
  const [, , site, exp] = await Promise.all([relP, oraP, siteP, expP]);

  const od = (oracle && (oracle.data || oracle)) || {};
  const liq = od.total_pool_liquidity_usd ?? od.liquidity_usd ?? null;
  const pools = (od.pools && od.pools.length) || null;
  const gA = (reliability && (reliability.gate_a || '').toUpperCase()) || '';
  const lag = reliability ? reliability.lag_hours : null;
  const gating = (reliability && reliability.gating) || [];
  const pass = gating.filter(c => c.status === 'pass').length;

  const usd = n => n == null ? '—' : (n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n));
  const lagTxt = lag == null ? '' : (lag < 1 ? `fresh · ~${Math.round(lag * 60)}m ago` : `fresh · ~${lag.toFixed(1)}h ago`);

  const segments = [
    { key: 'site', name: 'Website', detail: site.ok ? `reachable · ~${site.ms}ms` : 'unreachable', state: site.ok ? 'ok' : 'down' },
    { key: 'explorer', name: 'Explorer', detail: exp.ok ? `reachable · ~${exp.ms}ms` : 'unreachable', state: exp.ok ? 'ok' : 'down' },
    { key: 'pipeline', name: 'Data pipeline', detail: reliability ? `Gate-A ${gA} · ${lagTxt}` : 'unreachable', state: !reliability ? 'down' : gA === 'GREEN' ? 'ok' : gA === 'RED' ? 'down' : 'warn' },
    { key: 'onchain', name: 'On-chain integrity', detail: reliability ? `${pass}/${gating.length} checks passing${reliability.flow_reconciled ? ' · flow reconciled' : ''}` : 'unreachable', state: !reliability ? 'down' : (pass === gating.length && gating.length > 0) ? 'ok' : 'warn' },
    { key: 'api', name: 'TOKE API', detail: oracle ? `responding · ~${oracleMs}ms` : 'oracle unreachable', state: oracle ? 'ok' : 'warn' },
    { key: 'liquidity', name: 'Liquidity', detail: liq != null ? `${usd(liq)} pooled${pools ? ` · ${pools} pools` : ''}` : 'unknown', state: liq > 0 ? 'ok' : oracle ? 'warn' : 'down' },
  ];

  const states = segments.map(s => s.state);
  const overall = states.includes('down') ? 'down' : states.includes('warn') ? 'warn' : 'ok';
  return { generated: new Date().toISOString(), overall, segments };
}
