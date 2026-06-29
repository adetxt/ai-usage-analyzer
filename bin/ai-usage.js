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
import { renderMarkdown } from '../src/markdown.js';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`) || args.includes(`-${name}`);
const showHelp = hasFlag('help') || hasFlag('h');
const jsonOut = hasFlag('json');
const mdOut = hasFlag('markdown') || hasFlag('md');
const topN = (() => {
  const i = args.indexOf('--top');
  if (i < 0) return 5;
  const v = parseInt(args[i + 1], 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
})();

if (showHelp) {
  console.log(`
ai-usage-analyzer — local AI coding agent token consumption TUI

Usage:
  ai-usage [options]

Options:
  -h, --help         Show this help
  --json             Output machine-readable JSON instead of TUI
  --markdown, --md   Output as a Markdown report (GitHub-flavored tables)
  --top N            Show top N heaviest sessions (default: 5)

Examples:
  ai-usage                       # default TUI
  ai-usage --json | jq .summary  # pipe to jq
  ai-usage --md > report.md      # save as markdown
  ai-usage --top 20              # show top 20 sessions

Environment overrides (per-tool data path):
  CLAUDE_HOME, CODEX_HOME, OPENCODE_HOME, MIMOCODE_HOME,
  COPILOT_HOME, ANTIGRAVITY_HOME, GEMINI_HOME,
  AI_USAGE_PATHS_JSON='{"codex":"/custom/path",...}'

Supported tools:
  • Claude Code    — ~/.claude/projects  (presence only)
  • Codex          — ~/.codex/sessions      (tokens from token_count events)
  • OpenCode       — ~/.local/share/opencode/opencode.db  (tokens + cost)
  • MimoCode       — ~/.local/share/mimocode/mimocode.db  (tokens + cost)
  • GitHub Copilot — ~/.copilot/session-state  (presence only)
  • Antigravity    — ~/Library/Application Support/Antigravity  (presence only)
  • Gemini CLI     — ~/.gemini/antigravity/conversations  (presence only)
`);
  process.exit(0);
}

if (jsonOut && mdOut) {
  console.error('Error: --json and --markdown are mutually exclusive.');
  process.exit(2);
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

  if (mdOut) {
    const out = renderMarkdown({
      records, detections, errors,
      dateRange: range, topN, generatedAt: new Date().toISOString(),
    });
    process.stdout.write(out);
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
