// Auto-detect AI coding agent data directories.
//
// All tool configuration (paths, env vars, kinds, display metadata) lives
// in src/tools.js. This file only orchestrates: probe paths, apply user
// overrides, and project each tool's metadata into the detection result.

import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { env } from 'node:process';
import { TOOLS, TOOL_ORDER } from './tools.js';

function firstExisting(paths) {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export function detectAll(opts = {}) {
  const override = opts.override || (env.AI_USAGE_PATHS_JSON
    ? safeParseJSON(env.AI_USAGE_PATHS_JSON)
    : {});

  const results = [];
  for (const def of TOOLS) {
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

export { TOOL_ORDER };
