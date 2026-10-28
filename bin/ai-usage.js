#!/usr/bin/env node
// AI Usage Analyzer - TUI for local AI coding agent token consumption
// Auto-detects: Claude Code, Codex, OpenCode, MimoCode, Copilot, Antigravity, Gemini

import { overall } from "../src/aggregate.js";
import { detectAll } from "../src/detectors.js";
import { dateRange, loadAll } from "../src/loaders.js";
import { renderMarkdown } from "../src/markdown.js";
import {
    renderDetections,
    renderHeader,
    renderNotes,
    renderOverview,
    renderPerMonth,
    renderPerProject,
    renderPerTool,
    renderPerToolPerMonth,
    renderPerWeek,
    renderTopSessions,
} from "../src/render.js";
import { startDashboard } from "../src/server.js";
import { collectQuotas, renderQuota } from "../src/quota.js";

const args = process.argv.slice(2);
const hasFlag = (name) =>
  args.includes(`--${name}`) || args.includes(`-${name}`);
const showHelp = hasFlag("help") || hasFlag("h");
const jsonOut = hasFlag("json");
const mdOut = hasFlag("markdown") || hasFlag("md");
const quotaOut = hasFlag("quota");
const staticOut = hasFlag("static") || hasFlag("no-interactive");
const topN = (() => {
  const i = args.indexOf("--top");
  if (i < 0) return 5;
  const v = parseInt(args[i + 1], 10);
  return Number.isFinite(v) && v > 0 ? v : 5;
})();
const yearFilter = (() => {
  const i = args.indexOf("--year");
  if (i < 0) return null;
  const v = parseInt(args[i + 1], 10);
  return Number.isFinite(v) && v > 1970 && v < 3000 ? v : null;
})();

if (showHelp) {
  console.log(`
ai-usage-analyzer — local AI coding agent usage dashboard

Usage:
  ai-usage [options]

Options:
  -h, --help               Show this help
  --json                   Output machine-readable JSON instead of TUI
  --markdown, --md         Output as a Markdown report (GitHub-flavored tables)
  --static, --no-interactive  Disable interactive mode; dump all sections at once
  --quota                  Include live quota in JSON, Markdown, or static reports
  --top N                  Show top N sessions in reports (default: 5)
  --year YYYY              Filter reports to a single year (e.g. --year 2026)

Examples:
  ai-usage                       # open dashboard
  ai-usage --static --year 2026  # report, only 2026 sessions
  ai-usage --json | jq .summary  # pipe to jq
  ai-usage --md > report.md      # save as markdown
  ai-usage --static --top 20     # show top 20 sessions

Environment overrides (per-tool data path):
  CLAUDE_HOME, CODEX_HOME, OPENCODE_HOME, MIMOCODE_HOME,
  COPILOT_HOME, ANTIGRAVITY_HOME, GEMINI_HOME,
  AI_USAGE_PATHS_JSON='{"codex":"/custom/path",...}'

Supported tools:
  • Claude Code    — ~/.claude/projects  (tokens from per-message usage)
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
  console.error("Error: --json and --markdown are mutually exclusive.");
  process.exit(2);
}

async function main() {
  if (!jsonOut && !mdOut && !staticOut) {
    await startDashboard();
    return;
  }
  const t0 = Date.now();
  const detections = detectAll();
  const { records: allRecords, errors } = await loadAll(detections);

  // Apply --year filter before any aggregation so dateRange and totals
  // reflect the filtered set.
  const records =
    yearFilter !== null
      ? allRecords.filter(
          (r) => r.month && r.month.startsWith(`${yearFilter}-`),
        )
      : allRecords;

  const range = dateRange(records);
  const tot = overall(records);

  const quotaPromise = quotaOut ? collectQuotas() : null;

  if (jsonOut) {
    const quotas = quotaPromise ? await quotaPromise : null;
    const out = {
      detections,
      ...(quotas ? { quotas } : {}),
      summary: tot,
      dateRange: range,
      sessions: records,
      filter: yearFilter !== null ? { year: yearFilter } : null,
      errors,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (mdOut) {
    const out = renderMarkdown({
      records,
      detections,
      errors,
      dateRange: range,
      topN,
      generatedAt: new Date().toISOString(),
    });
    const quota = quotaPromise ? await quotaPromise : null;
    process.stdout.write(out + (quota ? `\n## Quotas\n\n\`\`\`\n${renderQuota(quota)}\n\`\`\`\n` : ""));
    return;
  }

  // Static fallback (--static, --no-interactive, or piped output)
  const sections = [
    renderHeader({
      totalSessions: records.length,
      totalTokens: tot.tokensTotal,
      totalCost: tot.cost,
      costStatus: tot.costStatus,
      dateRange: range,
    }),
    renderDetections(detections),
  ];
  if (records.length > 0) {
    sections.push(
      renderOverview(records, detections),
      renderPerProject(records),
      renderPerTool(records),
      renderPerToolPerMonth(records),
      renderPerMonth(records),
      renderPerWeek(records),
      renderTopSessions(records, topN),
    );
  }
  sections.push(renderNotes(detections, errors));
  if (quotaPromise) sections.push(renderQuota(await quotaPromise));

  console.log(sections.join("\n\n"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
