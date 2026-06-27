// Loaders: turn detector results into a unified stream of session records.
//
// Unified record shape:
//   {
//     tool:        'opencode' | 'codex' | 'mimocode' | string,
//     sessionId:   string,
//     project:     string,          // working directory or '(unknown)'
//     title:       string,
//     week:        'YYYY-Www',      // ISO week, UTC
//     month:       'YYYY-MM',
//     ts:          number,          // session start, ms since epoch
//     tokensInput, tokensOutput, tokensCacheRead, tokensCacheWrite, tokensReasoning,
//     tokensTotal: number,
//     cost:        number,          // USD
//     model:       string,
//   }

import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function isoWeekKey(ts) {
  const d = new Date(ts);
  // ISO week: Thu in current week decides the year
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // Thu
  const firstThu = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseIsoMs(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function compactHome(p) {
  if (!p) return '(unknown)';
  const home = process.env.HOME || '';
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

// ---------------------------------------------------------------------------
// SQLite loader (OpenCode + MimoCode share schema)
// ---------------------------------------------------------------------------

function loadOpencodeStyleSqlite(dbPath, toolKey) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    return { records: [], error: `cannot open ${dbPath}: ${e.message}` };
  }

  // Introspect session table for token columns (MimoCode schema is a subset)
  const cols = db.prepare(`PRAGMA table_info(session)`).all();
  const colSet = new Set(cols.map(c => c.name));
  const hasTokens = colSet.has('tokens_input')
                 && colSet.has('tokens_output')
                 && colSet.has('tokens_cache_read')
                 && colSet.has('tokens_cache_write');

  if (!hasTokens) {
    db.close();
    return { records: [], info: 'session table has no token columns' };
  }

  const rows = db.prepare(`
    SELECT id, directory, title, time_created,
           tokens_input, tokens_output, tokens_reasoning,
           tokens_cache_read, tokens_cache_write, cost, model
    FROM session
    WHERE time_archived IS NULL
  `).all();
  db.close();

  const records = [];
  for (const r of rows) {
    const tot = (r.tokens_input || 0) + (r.tokens_output || 0)
              + (r.tokens_reasoning || 0) + (r.tokens_cache_read || 0)
              + (r.tokens_cache_write || 0);
    if (tot === 0) continue;
    records.push({
      tool: toolKey,
      sessionId: r.id,
      project: compactHome(r.directory),
      title: r.title || '',
      week: isoWeekKey(r.time_created),
      month: monthKey(r.time_created),
      ts: r.time_created,
      tokensInput: r.tokens_input || 0,
      tokensOutput: r.tokens_output || 0,
      tokensCacheRead: r.tokens_cache_read || 0,
      tokensCacheWrite: r.tokens_cache_write || 0,
      tokensReasoning: r.tokens_reasoning || 0,
      tokensTotal: tot,
      cost: r.cost || 0,
      model: r.model || '',
    });
  }
  return { records };
}

// ---------------------------------------------------------------------------
// Codex JSONL rollout loader
// ---------------------------------------------------------------------------

async function loadCodexRollouts(rootDir) {
  const records = [];
  const errors = [];
  const files = walkJsonl(rootDir, 'rollout-');

  for (const f of files) {
    try {
      const rec = await parseCodexRollout(f);
      if (rec) records.push(rec);
    } catch (e) {
      errors.push(`${f}: ${e.message}`);
    }
  }
  return { records, errors };
}

async function parseCodexRollout(path) {
  // Use a streaming reader to avoid loading huge files into memory.
  // The 'token_count' event accumulates usage; we take the LAST one (final snapshot).
  let sessionMeta = null;
  let lastUsage = null;
  let lastModel = '';

  const stream = createReadStream(path, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const t = ev.type;
    const p = ev.payload || {};
    if (t === 'session_meta') {
      sessionMeta = { ts: ev.timestamp, cwd: p.cwd || p.CWD || '' };
    } else if (t === 'event_msg' && p.type === 'token_count') {
      const info = p.info || {};
      const u = info.total_token_usage;
      if (u) lastUsage = u;
      const m = info.model || p.model;
      if (m) lastModel = m;
    }
  }
  if (!sessionMeta || !lastUsage) return null;

  const ts = parseIsoMs(sessionMeta.ts);
  if (!ts) return null;

  const tokensInput = lastUsage.input_tokens || 0;
  const tokensOutput = lastUsage.output_tokens || 0;
  const tokensCacheRead = lastUsage.cached_input_tokens || 0;
  const tokensReasoning = lastUsage.reasoning_output_tokens || 0;
  const tot = tokensInput + tokensOutput + tokensCacheRead + tokensReasoning;
  if (tot === 0) return null;

  return {
    tool: 'codex',
    sessionId: path.split('-').pop().replace('.jsonl', ''),
    project: compactHome(sessionMeta.cwd),
    title: '',  // not available in codex rollouts
    week: isoWeekKey(ts),
    month: monthKey(ts),
    ts,
    tokensInput,
    tokensOutput,
    tokensCacheRead,
    tokensCacheWrite: 0,  // codex doesn't expose cache_write separately
    tokensReasoning,
    tokensTotal: tot,
    cost: 0,
    model: lastModel,
  };
}

function walkJsonl(root, prefix) {
  const out = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.startsWith(prefix) && e.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// Public: load all session records for given detectors
// ---------------------------------------------------------------------------

export async function loadAll(detections) {
  const all = [];
  const errors = [];

  for (const d of detections) {
    if (d.status !== 'present') continue;
    if (d.key === 'opencode' || d.key === 'mimocode') {
      const r = loadOpencodeStyleSqlite(d.path, d.key);
      all.push(...r.records);
      if (r.error) errors.push(`${d.name}: ${r.error}`);
      if (r.info) errors.push(`${d.name}: ${r.info}`);
    } else if (d.key === 'codex') {
      const r = await loadCodexRollouts(d.path);
      all.push(...r.records);
      if (r.errors) errors.push(...r.errors);
    }
    // For other tools (claude, copilot, antigravity, gemini), we only have
    // presence info — no token data to load.
  }
  return { records: all, errors };
}

// ---------------------------------------------------------------------------
// Public: date range helper
// ---------------------------------------------------------------------------

export function dateRange(records) {
  if (records.length === 0) return [null, null];
  let min = Infinity, max = -Infinity;
  for (const r of records) {
    if (r.ts < min) min = r.ts;
    if (r.ts > max) max = r.ts;
  }
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  return [fmt(min), fmt(max)];
}
