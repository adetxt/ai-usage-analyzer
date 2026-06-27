// Auto-detect AI coding agent data directories.
//
// Strategy:
//   1. Honor $AI_USAGE_PATHS_JSON if set (JSON map of { toolKey: "/abs/path" })
//   2. Honor per-tool env var (e.g. $CLAUDE_HOME, $CODEX_HOME, $OPENCODE_HOME)
//   3. Probe well-known locations per platform (mac/linux) relative to $HOME
//   4. Return a status for each tool: 'present' | 'absent' | 'disabled'
//
// Tools that share the opencode SQLite schema are auto-registered.

import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { homedir, platform } from 'node:os';
import { env, exitCode } from 'node:process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const HOME = homedir();
const OS = platform(); // 'darwin' | 'linux' | 'win32'

// macOS Application Support helper
const APP_SUPPORT = OS === 'darwin'
  ? join(HOME, 'Library', 'Application Support')
  : process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, '..')  // XDG_DATA_HOME/../ = ~/.local/share
    : join(HOME, '.local', 'share');

const CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(HOME, '.config');

// Probe = array of candidate paths; first one that exists wins.
function firstExisting(paths) {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}
function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// ---------------------------------------------------------------------------
// Detector definitions. Each entry returns:
//   { key, name, kind, status, path, count, details }
// ---------------------------------------------------------------------------

const DETECTORS = [
  // -----------------------------------------------------------------------
  // Claude Code
  // -----------------------------------------------------------------------
  {
    key: 'claude',
    name: 'Claude Code',
    kind: 'jsonl',
    envVar: 'CLAUDE_HOME',
    candidatePaths: () => {
      const base = env.CLAUDE_HOME || join(HOME, '.claude');
      return [
        join(base, 'transcripts'),
        join(base, 'projects'),
      ];
    },
    count: (p) => {
      if (!p) return 0;
      let n = 0;
      try {
        for (const f of readdirSync(p)) {
          if (f.startsWith('ses_') && f.endsWith('.jsonl')) n++;
        }
      } catch {}
      return n;
    },
    hasTokens: false,  // transcripts only contain text, no token counts
    description: '~/.claude/transcripts/*.jsonl  (no token data stored locally)',
  },

  // -----------------------------------------------------------------------
  // Codex
  // -----------------------------------------------------------------------
  {
    key: 'codex',
    name: 'Codex',
    kind: 'jsonl-rollout',
    envVar: 'CODEX_HOME',
    candidatePaths: () => [
      env.CODEX_HOME || join(HOME, '.codex', 'sessions'),
    ],
    count: (p) => {
      if (!p) return 0;
      let n = 0;
      function walk(dir) {
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) n++;
          }
        } catch {}
      }
      walk(p);
      return n;
    },
    hasTokens: true,
    description: '~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl',
  },

  // -----------------------------------------------------------------------
  // OpenCode
  // -----------------------------------------------------------------------
  {
    key: 'opencode',
    name: 'OpenCode',
    kind: 'sqlite',
    envVar: 'OPENCODE_HOME',
    candidatePaths: () => [
      env.OPENCODE_HOME
        ? join(env.OPENCODE_HOME, 'opencode.db')
        : join(HOME, '.local', 'share', 'opencode', 'opencode.db'),
    ],
    count: (p) => {
      if (!p) return 0;
      try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(p, { readOnly: true });
        return db.prepare('SELECT COUNT(*) AS c FROM session').get().c;
      } catch { return 0; }
    },
    hasTokens: true,
    description: '~/.local/share/opencode/opencode.db  (tokens + cost)',
  },

  // -----------------------------------------------------------------------
  // MimoCode (same schema as OpenCode)
  // -----------------------------------------------------------------------
  {
    key: 'mimocode',
    name: 'MimoCode',
    kind: 'sqlite',
    envVar: 'MIMOCODE_HOME',
    candidatePaths: () => [
      env.MIMOCODE_HOME
        ? join(env.MIMOCODE_HOME, 'mimocode.db')
        : join(HOME, '.local', 'share', 'mimocode', 'mimocode.db'),
    ],
    count: (p) => {
      if (!p) return 0;
      try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(p, { readOnly: true });
        return db.prepare('SELECT COUNT(*) AS c FROM session').get().c;
      } catch { return 0; }
    },
    hasTokens: true,
    description: '~/.local/share/mimocode/mimocode.db  (tokens + cost)',
  },

  // -----------------------------------------------------------------------
  // GitHub Copilot CLI
  // -----------------------------------------------------------------------
  {
    key: 'copilot',
    name: 'GitHub Copilot',
    kind: 'jsonl-events',
    envVar: 'COPILOT_HOME',
    candidatePaths: () => {
      const base = env.COPILOT_HOME || join(HOME, '.copilot');
      return [
        join(base, 'session-state'),
        base,
      ];
    },
    count: (p) => {
      if (!p) return 0;
      let n = 0;
      function walk(dir) {
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && e.name.endsWith('.jsonl')) n++;
          }
        } catch {}
      }
      walk(p);
      return n;
    },
    hasTokens: false,
    description: '~/.copilot/session-state/*/events.jsonl  (no token data)',
  },

  // -----------------------------------------------------------------------
  // Antigravity (VS Code variant) - mostly cache; no token data
  // -----------------------------------------------------------------------
  {
    key: 'antigravity',
    name: 'Antigravity',
    kind: 'dir',
    envVar: 'ANTIGRAVITY_HOME',
    candidatePaths: () => {
      const base = env.ANTIGRAVITY_HOME || join(APP_SUPPORT, 'Antigravity');
      return [
        base,
        join(HOME, '.antigravity'),
      ];
    },
    count: (p) => {
      if (!p) return 0;
      let n = 0;
      try {
        for (const e of readdirSync(p)) {
          const full = join(p, e);
          if (statSync(full).isDirectory()) n++;
        }
      } catch {}
      return n;
    },
    hasTokens: false,
    description: '~/Library/Application Support/Antigravity  (no token data)',
  },

  // -----------------------------------------------------------------------
  // Gemini CLI
  // -----------------------------------------------------------------------
  {
    key: 'gemini',
    name: 'Gemini CLI',
    kind: 'protobuf',
    envVar: 'GEMINI_HOME',
    candidatePaths: () => {
      const base = env.GEMINI_HOME || join(HOME, '.gemini');
      return [
        join(base, 'antigravity', 'conversations'),
        join(base, 'conversations'),
      ];
    },
    count: (p) => {
      if (!p) return 0;
      let n = 0;
      try {
        for (const f of readdirSync(p)) {
          if (f.endsWith('.pb')) n++;
        }
      } catch {}
      return n;
    },
    hasTokens: false,
    description: '~/.gemini/antigravity/conversations/*.pb  (binary, no token data)',
  },
];

// ---------------------------------------------------------------------------
// Public: run all detectors
// ---------------------------------------------------------------------------

export function detectAll(opts = {}) {
  const override = opts.override || (env.AI_USAGE_PATHS_JSON
    ? safeParseJSON(env.AI_USAGE_PATHS_JSON)
    : {});

  const results = [];
  for (const def of DETECTORS) {
    let candidatePaths = def.candidatePaths();

    // Apply override if user supplied one
    if (override[def.key]) {
      const ov = override[def.key];
      if (typeof ov === 'string' && isAbsolute(ov)) {
        candidatePaths = [ov, ...candidatePaths];
      }
    }

    const path = firstExisting(candidatePaths);
    const status = path ? 'present' : 'absent';
    const count = path ? def.count(path) : 0;
    results.push({
      key: def.key,
      name: def.name,
      kind: def.kind,
      status,
      path,
      count,
      hasTokens: def.hasTokens,
      description: def.description,
    });
  }
  return results;
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Public: just keys in order (for stable UI columns)
// ---------------------------------------------------------------------------

export const TOOL_ORDER = DETECTORS.map(d => d.key);
