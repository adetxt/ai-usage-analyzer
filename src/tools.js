// Single source of truth for every AI coding tool this analyzer supports.
//
// Each tool entry describes both:
//   - How to find it on disk (kind, envVar, candidatePaths, count)
//   - How to render it in the report (name, label, color, barChar)
//
// To add a new tool, append one entry to TOOLS. If the tool exposes token
// data, also wire a loader branch in src/loaders.js.

import { statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { env } from 'node:process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const HOME = homedir();
const OS = platform(); // 'darwin' | 'linux' | 'win32'

const APP_SUPPORT = OS === 'darwin'
  ? join(HOME, 'Library', 'Application Support')
  : env.XDG_DATA_HOME
    ? join(env.XDG_DATA_HOME, '..')  // XDG_DATA_HOME/../ = ~/.local/share
    : join(HOME, '.local', 'share');

// ---------------------------------------------------------------------------
// Reusable count helpers
// ---------------------------------------------------------------------------

function countJsonlRecursive(dir) {
  if (!dir) return 0;
  let n = 0;
  function walk(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.jsonl')) n++;
      }
    } catch {}
  }
  walk(dir);
  return n;
}

function countSqliteRows(dbPath) {
  if (!dbPath) return 0;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    return db.prepare('SELECT COUNT(*) AS c FROM session').get().c;
  } catch { return 0; }
}

function countSubdirs(dir) {
  if (!dir) return 0;
  let n = 0;
  try {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) n++;
    }
  } catch {}
  return n;
}

function countProtobuf(dir) {
  if (!dir) return 0;
  let n = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.pb')) n++;
    }
  } catch {}
  return n;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOLS = [
  // -----------------------------------------------------------------------
  // Claude Code
  // -----------------------------------------------------------------------
  {
    key: 'claude',
    name: 'Claude Code',
    label: 'claude',
    color: '#ff9e64',     // orange
    barChar: '█',
    kind: 'jsonl',
    envVar: 'CLAUDE_HOME',
    candidatePaths: () => [
      env.CLAUDE_HOME
        ? join(env.CLAUDE_HOME, 'projects')
        : join(HOME, '.claude', 'projects'),
    ],
    count: countJsonlRecursive,
    hasTokens: true,
    description: '~/.claude/projects/*/<UUID>.jsonl  (per-message usage in assistant lines)',
  },

  // -----------------------------------------------------------------------
  // Codex
  // -----------------------------------------------------------------------
  {
    key: 'codex',
    name: 'Codex',
    label: 'codex',
    color: '#87ceeb',     // sky blue
    barChar: '▓',
    kind: 'jsonl-rollout',
    envVar: 'CODEX_HOME',
    candidatePaths: () => [
      env.CODEX_HOME || join(HOME, '.codex', 'sessions'),
    ],
    count: countJsonlRecursive,
    hasTokens: true,
    description: '~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl',
  },

  // -----------------------------------------------------------------------
  // OpenCode
  // -----------------------------------------------------------------------
  {
    key: 'opencode',
    name: 'OpenCode',
    label: 'opencode',
    color: '#f8f8f2',     // white
    barChar: '▒',
    kind: 'sqlite',
    envVar: 'OPENCODE_HOME',
    candidatePaths: () => [
      env.OPENCODE_HOME
        ? join(env.OPENCODE_HOME, 'opencode.db')
        : join(HOME, '.local', 'share', 'opencode', 'opencode.db'),
    ],
    count: countSqliteRows,
    hasTokens: true,
    description: '~/.local/share/opencode/opencode.db  (tokens + cost)',
  },

  // -----------------------------------------------------------------------
  // MimoCode (same schema as OpenCode)
  // -----------------------------------------------------------------------
  {
    key: 'mimocode',
    name: 'MimoCode',
    label: 'mimocode',
    color: '#f1fa8c',     // yellow
    barChar: '░',
    kind: 'sqlite',
    envVar: 'MIMOCODE_HOME',
    candidatePaths: () => [
      env.MIMOCODE_HOME
        ? join(env.MIMOCODE_HOME, 'mimocode.db')
        : join(HOME, '.local', 'share', 'mimocode', 'mimocode.db'),
    ],
    count: countSqliteRows,
    hasTokens: true,
    description: '~/.local/share/mimocode/mimocode.db  (tokens + cost)',
  },

  // -----------------------------------------------------------------------
  // GitHub Copilot CLI (presence only)
  // -----------------------------------------------------------------------
  {
    key: 'copilot',
    name: 'GitHub Copilot',
    label: 'copilot',
    color: '#3b82f6',     // deep blue
    barChar: '·',
    kind: 'jsonl-events',
    envVar: 'COPILOT_HOME',
    candidatePaths: () => {
      const base = env.COPILOT_HOME || join(HOME, '.copilot');
      return [
        join(base, 'session-state'),
        base,
      ];
    },
    count: countJsonlRecursive,
    hasTokens: false,
    description: '~/.copilot/session-state/*/events.jsonl  (no token data)',
  },

  // -----------------------------------------------------------------------
  // Antigravity (VS Code variant) - mostly cache; no token data
  // -----------------------------------------------------------------------
  {
    key: 'antigravity',
    name: 'Antigravity',
    label: 'antigravity',
    color: '#ff5555',     // red
    barChar: '·',
    kind: 'dir',
    envVar: 'ANTIGRAVITY_HOME',
    candidatePaths: () => [
      env.ANTIGRAVITY_HOME || APP_SUPPORT + '/Antigravity',
      join(HOME, '.antigravity'),
    ],
    count: countSubdirs,
    hasTokens: false,
    description: '~/Library/Application Support/Antigravity  (no token data)',
  },

  // -----------------------------------------------------------------------
  // Gemini CLI
  // -----------------------------------------------------------------------
  {
    key: 'gemini',
    name: 'Gemini CLI',
    label: 'gemini',
    color: '#14b8a6',     // teal
    barChar: '·',
    kind: 'protobuf',
    envVar: 'GEMINI_HOME',
    candidatePaths: () => {
      const base = env.GEMINI_HOME || join(HOME, '.gemini');
      return [
        join(base, 'antigravity', 'conversations'),
        join(base, 'conversations'),
      ];
    },
    count: countProtobuf,
    hasTokens: false,
    description: '~/.gemini/antigravity/conversations/*.pb  (binary, no token data)',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers — consumers should use these instead of indexing TOOLS
// directly so the null-handling stays in one place.
// ---------------------------------------------------------------------------

const TOOL_BY_KEY = new Map(TOOLS.map(t => [t.key, t]));
const FALLBACK_COLOR = '#ffffff';
const FALLBACK_BAR_CHAR = '·';

export function getTool(key) {
  return TOOL_BY_KEY.get(key) || null;
}

export function getToolColor(key) {
  return TOOL_BY_KEY.get(key)?.color ?? FALLBACK_COLOR;
}

export function getToolBarChar(key) {
  return TOOL_BY_KEY.get(key)?.barChar ?? FALLBACK_BAR_CHAR;
}

export function getToolLabel(key) {
  return TOOL_BY_KEY.get(key)?.label ?? key;
}

// Stable UI column order — derived from TOOLS so adding a tool only
// requires one edit in this file.
export const TOOL_ORDER = TOOLS.map(t => t.key);
