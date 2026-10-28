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

import { createReadStream, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { estimateUsage } from "./pricing.js";

// Run fn over every item in items with at most `limit` in-flight at once.
async function mapConcurrent(items, fn, limit) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function isoWeekKey(ts) {
  const d = new Date(ts);
  // ISO week: Thu in current week decides the year
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // Thu
  const firstThu = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseIsoMs(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function tokenCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function compactHome(p) {
  if (!p) return "(unknown)";
  const home = process.env.HOME || "";
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
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
  const colSet = new Set(cols.map((c) => c.name));
  const hasTokens =
    colSet.has("tokens_input") &&
    colSet.has("tokens_output") &&
    colSet.has("tokens_cache_read") &&
    colSet.has("tokens_cache_write");

  if (!hasTokens) {
    db.close();
    return { records: [], info: "session table has no token columns" };
  }

  const hasTimeUpdated = colSet.has("time_updated");
  const rows = db
    .prepare(
      `
    SELECT id, directory, title, time_created,
           ${hasTimeUpdated ? "time_updated," : ""}
           tokens_input, tokens_output, tokens_reasoning,
           tokens_cache_read, tokens_cache_write, cost, model
    FROM session
    WHERE time_archived IS NULL
  `,
    )
    .all();
  db.close();

  const records = [];
  for (const r of rows) {
    const tot =
      (r.tokens_input || 0) +
      (r.tokens_output || 0) +
      (r.tokens_reasoning || 0) +
      (r.tokens_cache_read || 0) +
      (r.tokens_cache_write || 0);
    if (tot === 0) continue;
    records.push({
      tool: toolKey,
      sessionId: r.id,
      project: compactHome(r.directory),
      title: r.title || "",
      week: isoWeekKey(r.time_created),
      month: monthKey(r.time_created),
      ts: r.time_created,
      durationMs: hasTimeUpdated
        ? Math.max(0, (r.time_updated || r.time_created) - r.time_created)
        : 0,
      tokensInput: r.tokens_input || 0,
      tokensOutput: r.tokens_output || 0,
      tokensCacheRead: r.tokens_cache_read || 0,
      tokensCacheWrite: r.tokens_cache_write || 0,
      tokensReasoning: r.tokens_reasoning || 0,
      tokensTotal: tot,
      cost: r.cost || 0,
      costStatus: r.cost == null ? "unavailable" : "recorded",
      model: r.model || "",
    });
  }
  return { records };
}

// ---------------------------------------------------------------------------
// Codex JSONL rollout loader
// ---------------------------------------------------------------------------

async function loadCodexRollouts(rootDir) {
  const errors = [];
  const roots = basename(rootDir) === "sessions" ? [rootDir, join(dirname(rootDir), "archived_sessions")] : [rootDir];
  const files = [...new Set(roots.flatMap((root) => walkJsonl(root, "rollout-")))];
  files.sort((a, b) => Number(a.split(/[\\/]/).includes("archived_sessions")) - Number(b.split(/[\\/]/).includes("archived_sessions")) || a.localeCompare(b));
  const results = await mapConcurrent(
    files,
    async (f) => {
      try {
        return await parseCodexRollout(f);
      } catch (e) {
        errors.push(`${f}: ${e.message}`);
        return null;
      }
    },
    48,
  );
  const sessions = new Map();
  for (const record of results) if (record && !sessions.has(record.sessionId)) sessions.set(record.sessionId, record);
  return { records: [...sessions.values()], errors };
}

async function parseCodexRollout(path) {
  // Use a streaming reader to avoid loading huge files into memory.
  let sessionMeta = null;
  let previous = null;
  let forkWaiting = false;
  let inheritedTotal = null;
  const usageEvents = [];
  let lastModel = "";
  let provider = "openai";
  let lastEvTs = null;

  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const t = ev.type;
    const p = ev.payload || {};
    const evTs = parseIsoMs(ev.timestamp);
    if (evTs) lastEvTs = evTs;
    if (t === "session_meta") {
      sessionMeta = { ts: ev.timestamp, cwd: p.cwd || p.CWD || "", id: typeof p.id === "string" ? p.id : null };
      forkWaiting = Boolean(p.forked_from_id);
      if (typeof p.model_provider === "string" && p.model_provider) provider = p.model_provider;
    } else if (t === "turn_context") {
      forkWaiting = false;
      lastModel = p.model_info?.slug || p.model || p.model_name || lastModel;
    } else if (t === "event_msg" && p.type === "token_count") {
      const info = p.info || {};
      const fields = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'reasoning_output_tokens'];
      const normalize = (u) => u && Object.fromEntries(fields.map((field) => [field, tokenCount(u[field] ?? (field === 'cached_input_tokens' ? u.cache_read_input_tokens : 0))]));
      const total = normalize(info.total_token_usage);
      const last = normalize(info.last_token_usage);
      if (forkWaiting) {
        if (total) {
          previous = total;
          inheritedTotal = info.total_token_usage.total_tokens ?? null;
        }
        continue;
      }
      if (inheritedTotal !== null && info.total_token_usage?.total_tokens === inheritedTotal) {
        if (total) previous = total;
        inheritedTotal = null;
        continue;
      }
      inheritedTotal = null;
      let delta = null;
      if (total && previous) {
        if (fields.every((field) => total[field] === previous[field])) continue;
        const regressed = fields.some((field) => total[field] < previous[field]);
        if (regressed) {
          const sum = (u) => fields.reduce((n, field) => n + u[field], 0);
          if (last && sum(total) > 0 && sum(last) > 0 && (sum(total) * 100 >= sum(previous) * 98 || sum(total) + sum(last) * 2 >= sum(previous))) continue;
          delta = last;
        } else {
          delta = last || Object.fromEntries(fields.map((field) => [field, total[field] - previous[field]]));
        }
      } else {
        delta = last || total;
      }
      if (total) previous = total;
      else if (last && previous) previous = Object.fromEntries(fields.map((field) => [field, previous[field] + last[field]]));
      const m = info.model || info.model_name || p.model;
      if (m) lastModel = m;
      if (delta) usageEvents.push({ model: lastModel, provider, aggregated: !last, usage: delta });
    }
  }
  if (!sessionMeta || !usageEvents.length) return null;

  const ts = parseIsoMs(sessionMeta.ts);
  if (!ts) return null;
  const durationMs = lastEvTs && lastEvTs > ts ? lastEvTs - ts : 0;

  let tokensInput = 0, tokensOutput = 0, tokensCacheRead = 0, tokensReasoning = 0;
  for (const { usage } of usageEvents) {
    const cached = Math.min(usage.input_tokens, usage.cached_input_tokens);
    const reasoning = Math.min(usage.output_tokens, usage.reasoning_output_tokens);
    tokensInput += usage.input_tokens - cached;
    tokensOutput += usage.output_tokens - reasoning;
    tokensCacheRead += cached;
    tokensReasoning += reasoning;
  }
  const tot = tokensInput + tokensOutput + tokensCacheRead + tokensReasoning;
  if (tot === 0) return null;

  return {
    tool: "codex",
    sessionId: sessionMeta.id || basename(path).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.jsonl$)/i)?.[0] || basename(path, ".jsonl"),
    project: compactHome(sessionMeta.cwd),
    title: "",
    week: isoWeekKey(ts),
    month: monthKey(ts),
    ts,
    durationMs,
    tokensInput,
    tokensOutput,
    tokensCacheRead,
    tokensCacheWrite: 0, // codex doesn't expose cache_write separately
    tokensReasoning,
    tokensTotal: tot,
    ...estimateUsage("codex", usageEvents),
    model: lastModel,
    usageEvents,
  };
}

function walkJsonl(root, prefix) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (
        e.isFile() &&
        e.name.startsWith(prefix) &&
        e.name.endsWith(".jsonl")
      ) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

// Walks Claude's projects/ tree. Top-level .jsonl files are sessions; files
// under any `subagents/` subdir are deliberately skipped (their usage is
// already represented in the parent session's assistant messages).
function walkClaudeSessions(root) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "subagents") continue;
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// Claude Code JSONL loader
// ---------------------------------------------------------------------------
//
// Each top-level file under projects/<encoded-cwd>/<UUID>.jsonl is one session.
// Per assistant line, `message.usage` carries the per-turn token counts; we
// merge streamed usage by message and request, then sum unique responses. cwd / model / timestamp come from the line itself.

async function loadClaudeJsonl(rootDir) {
  const errors = [];
  const files = walkClaudeSessions(rootDir);
  const results = await mapConcurrent(
    files,
    async (f) => {
      try {
        return await parseClaudeSession(f);
      } catch (e) {
        errors.push(`${f}: ${e.message}`);
        return null;
      }
    },
    48,
  );
  return { records: results.filter(Boolean), errors };
}

async function parseClaudeSession(path) {
  const sessionId = path.split("/").pop().replace(".jsonl", "");
  const usages = new Map();
  const usageModels = new Map();
  let anonymous = 0;
  let cwd = "";
  let model = "";
  let firstTs = null;
  let lastTs = null;
  let title = "";

  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensCacheRead = 0;
  let tokensCacheWrite = 0;

  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    // Grab summary title from the first human message that has one.
    if (!title && ev.type === "summary" && typeof ev.summary === "string")
      title = ev.summary;
    if (ev.type !== "assistant") continue;
    const msg = ev.message || {};
    const usage = msg.usage;
    if (!usage) continue;
    const id = msg.id;
    const key = id ? JSON.stringify([id, ev.requestId || null]) : `anonymous:${anonymous++}`;
    const previous = usages.get(key) || {};
    const merged = {};
    for (const field of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) {
      merged[field] = Math.max(tokenCount(previous[field]), tokenCount(usage[field]));
    }
    usages.set(key, merged);
    if (msg.model) usageModels.set(key, msg.model);
    if (!cwd && typeof ev.cwd === "string") cwd = ev.cwd;
    if (!model && typeof msg.model === "string") model = msg.model;
    const evTs = parseIsoMs(ev.timestamp);
    if (firstTs === null && evTs !== null) firstTs = evTs;
    if (evTs !== null) lastTs = evTs;
  }
  for (const usage of usages.values()) {
    tokensInput += usage.input_tokens || 0;
    tokensOutput += usage.output_tokens || 0;
    tokensCacheRead += usage.cache_read_input_tokens || 0;
    tokensCacheWrite += usage.cache_creation_input_tokens || 0;
  }

  const tot = tokensInput + tokensOutput + tokensCacheRead + tokensCacheWrite;
  if (tot === 0) return null;
  const ts = firstTs ?? Date.now();
  const durationMs = firstTs !== null && lastTs !== null ? lastTs - firstTs : 0;

  const usageEvents = [...usages].map(([key, usage]) => ({ model: usageModels.get(key) || "", usage }));
  return {
    tool: "claude",
    sessionId,
    project: compactHome(cwd),
    title,
    week: isoWeekKey(ts),
    month: monthKey(ts),
    ts,
    durationMs,
    tokensInput,
    tokensOutput,
    tokensCacheRead,
    tokensCacheWrite,
    tokensReasoning: 0,
    tokensTotal: tot,
    ...estimateUsage("claude", usageEvents),
    model,
    usageEvents,
  };
}

// ---------------------------------------------------------------------------
// Public: load all session records for given detectors
// ---------------------------------------------------------------------------

export async function loadAll(detections) {
  const all = [];
  const errors = [];

  const tasks = detections
    .filter((d) => d.status === "present")
    .map((d) => {
      if (d.key === "opencode" || d.key === "mimocode") {
        return Promise.resolve({
          d,
          r: loadOpencodeStyleSqlite(d.path, d.key),
        });
      } else if (d.key === "codex") {
        return loadCodexRollouts(d.path).then((r) => ({ d, r }));
      } else if (d.key === "claude") {
        return loadClaudeJsonl(d.path).then((r) => ({ d, r }));
      }
      return null;
    })
    .filter(Boolean);

  for (const item of await Promise.all(tasks)) {
    const { d, r } = item;
    all.push(...r.records);
    if (r.error) errors.push(`${d.name}: ${r.error}`);
    if (r.info) errors.push(`${d.name}: ${r.info}`);
    if (r.errors) errors.push(...r.errors);
  }
  return { records: all, errors };
}

// ---------------------------------------------------------------------------
// Public: date range helper
// ---------------------------------------------------------------------------

export function dateRange(records) {
  if (records.length === 0) return [null, null];
  let min = Infinity,
    max = -Infinity;
  for (const r of records) {
    if (r.ts < min) min = r.ts;
    if (r.ts > max) max = r.ts;
  }
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  return [fmt(min), fmt(max)];
}
