#!/usr/bin/env node
// AI Usage Analyzer - TUI for local AI coding agent token consumption
// Auto-detects: Claude Code, Codex, OpenCode, MimoCode, Copilot, Antigravity, Gemini

import { detectAll } from '../src/detectors.js';
import { loadAll, dateRange } from '../src/loaders.js';
import { overall } from '../src/aggregate.js';
import {
  renderHeader, renderDetections, renderOverview,
  renderPerProject, renderPerMonth, renderPerWeek,
  renderTopSessions, renderNotes,
} from '../src/render.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const showHelp = flags.has('--help') || flags.has('-h');
const jsonOut = flags.has('--json');
const topN = (() => {
  const i = args.indexOf('--top');
  return i >= 0 ? parseInt(args[i + 1], 10) || 5 : 5;
})();

if (showHelp) {
  console.log(`
ai-usage-analyzer — local AI coding agent token consumption TUI

Usage:
  ai-usage [options]

Options:
  --top N            Show top N heaviest sessions (default: 5)
  --json             Output machine-readable JSON instead of TUI
  -h, --help         Show this help

Environment overrides (per-tool data path):
  CLAUDE_HOME, CODEX_HOME, OPENCODE_HOME, MIMOCODE_HOME,
  COPILOT_HOME, ANTIGRAVITY_HOME, GEMINI_HOME,
  AI_USAGE_PATHS_JSON='{"codex":"/custom/path",...}'

Supported tools:
  • Claude Code    — ~/.claude/transcripts  (presence only)
  • Codex          — ~/.codex/sessions      (tokens from token_count events)
  • OpenCode       — ~/.local/share/opencode/opencode.db  (tokens + cost)
  • MimoCode       — ~/.local/share/mimocode/mimocode.db  (tokens + cost)
  • GitHub Copilot — ~/.copilot/session-state  (presence only)
  • Antigravity    — ~/Library/Application Support/Antigravity  (presence only)
  • Gemini CLI     — ~/.gemini/antigravity/conversations  (presence only)
`);
  process.exit(0);
}

async function main() {
  const t0 = Date.now();
  const detections = detectAll();
  const { records, errors } = await loadAll(detections);
  const range = dateRange(records);
  const tot = overall(records);

  if (jsonOut) {
    const out = {
      detections,
      summary: tot,
      dateRange: range,
      sessions: records,
      errors,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // TUI render
  const sections = [
    renderHeader({
      totalSessions: records.length,
      totalTokens: tot.tokensTotal,
      totalCost: tot.cost,
      dateRange: range,
    }),
    renderDetections(detections),
  ];
  if (records.length > 0) {
    sections.push(
      renderOverview(records, detections),
      renderPerProject(records),
      renderPerMonth(records),
      renderPerWeek(records),
      renderTopSessions(records, topN),
    );
  }
  sections.push(renderNotes(detections, errors));

  console.log(sections.join('\n\n'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
