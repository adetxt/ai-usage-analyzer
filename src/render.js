// TUI renderer using chalk + cli-table3 + boxen + gradient-string.

import chalk from 'chalk';
import Table from 'cli-table3';
import boxen from 'boxen';
import gradient from 'gradient-string';
import process from 'node:process';
import {
  perProject, perMonth, perWeek, perTool, perToolPerMonth, overall, topSessions, tokenBreakdown,
  MONTH_NAMES,
} from './aggregate.js';
import { getToolColor } from './tools.js';

// ---------------------------------------------------------------------------
// Terminal width detection
// ---------------------------------------------------------------------------

function detectWidth() {
  // 1. process.stdout.columns (when piped to terminal)
  if (process.stdout.columns && Number.isFinite(process.stdout.columns)) {
    return process.stdout.columns;
  }
  // 2. COLUMNS env var (some terminals set this)
  if (process.env.COLUMNS) {
    const n = parseInt(process.env.COLUMNS, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // 3. tput cols (POSIX)
  try {
    const { execSync } = require('node:child_process');
    const out = execSync('tput cols 2>/dev/null', { encoding: 'utf8' });
    const n = parseInt(out.trim(), 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {}
  // 4. default
  return 100;
}

export const TERM_WIDTH = detectWidth();
export const NARROW = TERM_WIDTH < 110;

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

export function fmtInt(n) {
  return Number(n).toLocaleString('en-US');
}

export function fmtCompact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function fmtCost(n) {
  if (!n) return '—';
  return '$' + Number(n).toFixed(2);
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function toolColor(t) { return getToolColor(t); }
export function colorize(t, c) { return chalk.hex(c)(t); }

// Cool-to-warm gradient: small bars feel subtle, large bars pop.
const BAR_GRADIENT = gradient(['#3b82f6', '#14b8a6', '#f1fa8c', '#ff9e64']);

function bar(value, max, width) {
  if (max <= 0) return ' '.repeat(width);
  const pct = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(pct * width);
  const empty = width - filled;
  if (filled === 0) return chalk.gray('░'.repeat(width));
  return BAR_GRADIENT('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

// Stacked bar — one segment per tool, widths proportional to that tool's
// share of the row's total. Used wherever a row spans multiple tools
// (per-project / per-month / per-week). Single-tool rows are just one
// colored segment; no change in feel.
function stackedBar(byTool, width) {
  const total = Object.values(byTool).reduce((a, b) => a + b, 0);
  if (total <= 0 || width <= 0) return ' '.repeat(Math.max(0, width));
  const entries = Object.entries(byTool)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  let out = '';
  let x = 0;
  for (let i = 0; i < entries.length; i++) {
    const [tool, value] = entries[i];
    // Last segment fills the remaining width so rounding doesn't leave
    // a visible gap or overshoot.
    const segW = i === entries.length - 1
      ? width - x
      : Math.round((value / total) * width);
    if (segW <= 0) continue;
    out += chalk.hex(toolColor(tool))('█'.repeat(segW));
    x += segW;
  }
  return out;
}

function shortModel(m) {
  if (!m) return '—';
  if (typeof m === 'string' && m.trim().startsWith('{')) {
    try {
      const d = JSON.parse(m);
      const id = d.id || d.model || m;
      const prov = d.providerId || d.provider;
      return id + (prov ? ` (${prov})` : '');
    } catch { return m.slice(0, 30); }
  }
  return m;
}

function truncMiddle(s, w) {
  if (!s) return '';
  if (s.length <= w) return s;
  if (w <= 1) return s.slice(0, w);
  const head = Math.ceil((w - 1) / 2);
  const tail = Math.floor((w - 1) / 2);
  return s.slice(0, head) + '…' + s.slice(s.length - tail);
}

function truncEnd(s, w) {
  if (!s) return '';
  if (s.length <= w) return s;
  return s.slice(0, w - 1) + '…';
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function renderHeader({ totalSessions, totalTokens, totalCost, dateRange }) {
  const title = gradient.pastel.multiline('◆  AI TOKEN ANALYZER  ◆');
  const sub = chalk.dim(`${totalSessions} sessions`) + '  •  ' +
              chalk.bold.cyan(`${fmtCompact(totalTokens)} total tokens`) +
              (totalCost ? '  •  ' + chalk.bold.yellow(`$${totalCost.toFixed(2)} USD`) : '');
  const range = (dateRange[0] && dateRange[1])
    ? chalk.dim.italic(`\n  range: ${dateRange[0]}  →  ${dateRange[1]}`)
    : '';
  return boxen(`${title}\n\n${sub}${range}`, {
    borderStyle: 'round',
    borderColor: 'magenta',
    padding: { top: 0, bottom: 0, left: 2, right: 2 },
    align: 'center',
  });
}

// ---------------------------------------------------------------------------
// Tool detection panel
// ---------------------------------------------------------------------------

export function renderDetections(detections) {
  // For narrow terminals, simplify to Tool + Status + Count + Tokens (drop Path)
  if (NARROW) {
    const t = new Table({
      head: [chalk.bold('Tool'), chalk.bold('Status'), chalk.bold('Count'), chalk.bold('Tokens')],
      style: { head: [], border: [] },
    });
    for (const d of detections) {
      const status = d.status === 'present' ? chalk.green('● present') : chalk.red('○ absent');
      const count = d.count ? fmtInt(d.count) : chalk.dim('—');
      const tok = d.hasTokens ? (d.count ? chalk.cyan('yes') : chalk.dim('—')) : chalk.dim('n/a');
      t.push([colorize(d.name, toolColor(d.key)), status, count, tok]);
    }
    return boxen(t.toString() + '\n' + chalk.dim('(paths hidden in narrow mode — use $AI_USAGE_PATHS_JSON to inspect)'),
      { title: chalk.bold('AI Tools Detected'), borderStyle: 'round', borderColor: 'cyan',
        padding: { top: 0, bottom: 0, left: 1, right: 1 } });
  }

  const t = new Table({
    head: [chalk.bold('Tool'), chalk.bold('Status'), chalk.bold('Path'), chalk.bold('Count'), chalk.bold('Tokens')],
    style: { head: [], border: [] },
  });

  for (const d of detections) {
    const status = d.status === 'present' ? chalk.green('● present') : chalk.red('○ absent');
    const path = d.path ? truncEnd(d.path.replace(process.env.HOME || '', '~'), 50) : chalk.dim('—');
    const count = d.count ? fmtInt(d.count) : chalk.dim('—');
    const tok = d.hasTokens
      ? (d.count ? chalk.cyan('yes') : chalk.dim('—'))
      : chalk.dim('n/a');
    t.push([colorize(d.name, toolColor(d.key)), status, path, count, tok]);
  }
  return boxen(t.toString(), {
    title: chalk.bold('AI Tools Detected'),
    borderStyle: 'round',
    borderColor: 'cyan',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}

// ---------------------------------------------------------------------------
// Overview (totals + token breakdown)
// ---------------------------------------------------------------------------

export function renderOverview(records, detections) {
  const t = overall(records);
  const breakdown = tokenBreakdown(t);

  // Token breakdown sub-table
  const bt = new Table({
    style: { border: ['gray'] },
    colWidths: [14, 12, 12],
  });
  bt.push(
    [chalk.bold('Type'), chalk.bold('Tokens'), chalk.bold('Share')],
    [chalk.cyan('Input'),       fmtCompact(breakdown.input),       pct(breakdown.ratios.input)],
    [chalk.green('Output'),     fmtCompact(breakdown.output),      pct(breakdown.ratios.output)],
    [chalk.cyan('Cache Read'),  fmtCompact(breakdown.cacheRead),   pct(breakdown.ratios.cacheRead)],
    [chalk.cyan('Cache Write'), fmtCompact(breakdown.cacheWrite),  pct(breakdown.ratios.cacheWrite)],
    [chalk.yellow('Reasoning'),  fmtCompact(breakdown.reasoning),   pct(breakdown.ratios.reasoning)],
    [chalk.bold('Total'),       chalk.bold(fmtCompact(breakdown.total)), '100.0%'],
  );

  // Per-tool mini summary
  const pt = new Table({
    head: [chalk.bold('Tool'), chalk.bold('n'), chalk.bold('Total'), chalk.bold('Avg/sess'), chalk.bold('Cost')],
    style: { head: [], border: ['gray'] },
    colWidths: [14, 5, 10, 11, 9],
  });
  const byTool = perTool(records);
  for (const p of byTool) {
    pt.push([
      colorize(p.tool, toolColor(p.tool)),
      fmtInt(p.n),
      fmtCompact(p.tokensTotal),
      fmtCompact(p.avg),
      fmtCost(p.cost),
    ]);
  }
  pt.push([
    chalk.bold('TOTAL'),
    chalk.bold(fmtInt(records.length)),
    chalk.bold(fmtCompact(t.tokensTotal)),
    chalk.bold(fmtCompact(t.avg)),
    chalk.bold(fmtCost(t.cost)),
  ]);

  const body = pt.toString() + '\n\n' + chalk.bold.underline('Token Breakdown') + '\n' + bt.toString();
  return boxen(body, {
    title: chalk.bold('Overview'),
    borderStyle: 'round',
    borderColor: 'blue',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}

function pct(x) { return (x * 100).toFixed(1) + '%'; }

// ---------------------------------------------------------------------------
// Per Project
// ---------------------------------------------------------------------------

export function renderPerProject(records) {
  const items = perProject(records);
  if (items.length === 0) return '';
  const barW = NARROW ? 10 : 18;

  // Narrow mode: drop In/Out/Cache columns, just show n + Total + Dist
  const head = NARROW
    ? [chalk.bold('Project'), chalk.bold('n'),
       chalk.bold('Total'), chalk.bold('Dist')]
    : [chalk.bold('Project'), chalk.bold('n'),
       chalk.bold('In'), chalk.bold('Out'),
       chalk.bold('Cache'), chalk.bold('Total'), chalk.bold('Dist')];
  const t = new Table({ head, style: { head: [], border: [] } });

  for (const p of items) {
    const cache = p.tokensCacheRead + p.tokensCacheWrite;
    const row = [truncEnd(p.project, NARROW ? 28 : 40), fmtInt(p.n)];
    if (!NARROW) {
      row.push(
        fmtCompact(p.tokensInput),
        fmtCompact(p.tokensOutput),
        fmtCompact(cache),
      );
    }
    row.push(fmtCompact(p.tokensTotal), stackedBar(p.byTool, barW));
    t.push(row);
  }
  return boxen(t.toString(), {
    title: chalk.bold('Per Project'),
    borderStyle: 'round',
    borderColor: 'cyan',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}

// ---------------------------------------------------------------------------
// Per Tool (detailed — complements the brief summary in Overview)
// ---------------------------------------------------------------------------

export function renderPerTool(records) {
  const items = perTool(records);
  if (items.length === 0) return '';
  const max = items[0].tokensTotal;
  const barW = NARROW ? 10 : 18;

  const head = NARROW
    ? [chalk.bold('Tool'), chalk.bold('n'),
       chalk.bold('Total'), chalk.bold('Cost'), chalk.bold('Avg/sess'), chalk.bold('Dist')]
    : [chalk.bold('Tool'), chalk.bold('n'),
       chalk.bold('Input'), chalk.bold('Output'), chalk.bold('Cache'),
       chalk.bold('Total'), chalk.bold('Cost'), chalk.bold('Avg/sess'), chalk.bold('Dist')];
  const t = new Table({ head, style: { head: [], border: [] } });

  for (const p of items) {
    const cache = p.tokensCacheRead + p.tokensCacheWrite;
    const row = [
      colorize(p.tool, toolColor(p.tool)),
      fmtInt(p.n),
    ];
    if (!NARROW) {
      row.push(
        fmtCompact(p.tokensInput),
        fmtCompact(p.tokensOutput),
        fmtCompact(cache),
      );
    }
    row.push(
      fmtCompact(p.tokensTotal),
      fmtCost(p.cost),
      fmtCompact(p.avg),
      bar(p.tokensTotal, max, barW),
    );
    t.push(row);
  }
  return boxen(t.toString(), {
    title: chalk.bold('Per Tool'),
    borderStyle: 'round',
    borderColor: 'magenta',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}

// ---------------------------------------------------------------------------
// Per Tool per Month (cross-tab — one row per (tool, month))
// ---------------------------------------------------------------------------

export function renderPerToolPerMonth(records) {
  const items = perToolPerMonth(records);
  if (items.length === 0) return '';
  const max = items[0].tokensTotal;
  const barW = NARROW ? 8 : 16;

  const head = NARROW
    ? [chalk.bold('Tool'), chalk.bold('Month'), chalk.bold('n'),
       chalk.bold('Total'), chalk.bold('Dist')]
    : [chalk.bold('Tool'), chalk.bold('Month'), chalk.bold('n'),
       chalk.bold('Input'), chalk.bold('Output'), chalk.bold('Cache'),
       chalk.bold('Total'), chalk.bold('Dist')];
  const t = new Table({ head, style: { head: [], border: [] } });

  for (const p of items) {
    const cache = p.tokensCacheRead + p.tokensCacheWrite;
    const yyyy = p.month.slice(0, 4);
    const mm = p.month.slice(5, 7);
    const monthLabel = `${MONTH_NAMES[mm] || mm} ${yyyy}`;
    const row = [
      colorize(p.tool, toolColor(p.tool)),
      chalk.bold(monthLabel),
      fmtInt(p.n),
    ];
    if (!NARROW) {
      row.push(
        fmtCompact(p.tokensInput),
        fmtCompact(p.tokensOutput),
        fmtCompact(cache),
      );
    }
    row.push(
      fmtCompact(p.tokensTotal),
      bar(p.tokensTotal, max, barW),
    );
    t.push(row);
  }
  return boxen(t.toString(), {
    title: chalk.bold('Per Tool per Month'),
    borderStyle: 'round',
    borderColor: 'cyan',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}

// ---------------------------------------------------------------------------
// Per Month
// ---------------------------------------------------------------------------

export function renderPerMonth(records) {
  const items = perMonth(records);
  if (items.length === 0) return '';
  const barW = NARROW ? 10 : 16;

  const head = [
    chalk.bold('Month'), chalk.bold('n'),
    chalk.bold('Input'), chalk.bold('Output'),
    chalk.bold('Total'), chalk.bold('Dist'),
  ];
  const t = new Table({ head, style: { head: [], border: [] } });

  for (const p of items) {
    const yyyy = p.month.slice(0, 4);
    const mm = p.month.slice(5, 7);
    const label = `${MONTH_NAMES[mm] || mm} ${yyyy}`;
    t.push([
      chalk.bold(label),
      fmtInt(p.n),
      fmtCompact(p.tokensInput),
      fmtCompact(p.tokensOutput),
      fmtCompact(p.tokensTotal),
      stackedBar(p.byTool, barW),
    ]);
  }

  // TOTAL row
  const tot = overall(records);
  t.push([
    chalk.bgGray.white.bold(' TOTAL '),
    chalk.bgGray.white.bold(fmtInt(records.length)),
    chalk.bgGray.white.bold(fmtCompact(tot.tokensInput)),
    chalk.bgGray.white.bold(fmtCompact(tot.tokensOutput)),
    chalk.bgGray.white.bold(fmtCompact(tot.tokensTotal)),
    '',
  ]);

  return boxen(t.toString(), {
    title: chalk.bold('Per Month'),
    borderStyle: 'round',
    borderColor: 'green',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}

// ---------------------------------------------------------------------------
// Per Week
// ---------------------------------------------------------------------------

export function renderPerWeek(records) {
  const items = perWeek(records);
  if (items.length === 0) return '';
  const barW = NARROW ? 10 : 14;

  const head = [
    chalk.bold('ISO Week'), chalk.bold('n'),
    chalk.bold('Input'), chalk.bold('Output'),
    chalk.bold('Total'), chalk.bold('Dist'),
  ];
  const t = new Table({ head, style: { head: [], border: [] } });

  for (const p of items) {
    t.push([
      chalk.bold(p.week),
      fmtInt(p.n),
      fmtCompact(p.tokensInput),
      fmtCompact(p.tokensOutput),
      fmtCompact(p.tokensTotal),
      stackedBar(p.byTool, barW),
    ]);
  }
  // TOTAL row
  const tot = overall(records);
  t.push([
    chalk.bgGray.white.bold(' TOTAL '),
    chalk.bgGray.white.bold(fmtInt(records.length)),
    chalk.bgGray.white.bold(fmtCompact(tot.tokensInput)),
    chalk.bgGray.white.bold(fmtCompact(tot.tokensOutput)),
    chalk.bgGray.white.bold(fmtCompact(tot.tokensTotal)),
    '',
  ]);

  return boxen(t.toString(), {
    title: chalk.bold('Per Week'),
    borderStyle: 'round',
    borderColor: 'magenta',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}

// ---------------------------------------------------------------------------
// Top N heaviest sessions
// ---------------------------------------------------------------------------

export function renderTopSessions(records, n = 5) {
  const top = topSessions(records, n);
  if (top.length === 0) return '';

  if (NARROW) {
    const t = new Table({
      head: [chalk.bold('#'), chalk.bold('Total'), chalk.bold('In/Out'),
             chalk.bold('Cost'), chalk.bold('Title')],
      style: { head: [], border: [] },
    });
    top.forEach((r, i) => {
      t.push([
        chalk.bold(String(i + 1)),
        chalk.bold.yellow(fmtCompact(r.tokensTotal)),
        `${fmtCompact(r.tokensInput)}/${fmtCompact(r.tokensOutput)}`,
        r.cost ? '$' + r.cost.toFixed(4) : '—',
        truncEnd(r.title, 30) || '—',
      ]);
    });
    return boxen(t.toString() + '\n' + chalk.dim('(full project + model in wide mode)'),
      { title: chalk.bold.yellow(`Top ${n} Heaviest Sessions`),
        borderStyle: 'round', borderColor: 'yellow',
        padding: { top: 0, bottom: 0, left: 1, right: 1 } });
  }

  const t = new Table({
    head: [
      chalk.bold('#'), chalk.bold('Total'),
      chalk.bold('Input'), chalk.bold('Output'),
      chalk.bold('Cost'), chalk.bold('Model'),
      chalk.bold('Project'), chalk.bold('Title'),
    ],
    style: { head: [], border: [] },
  });
  top.forEach((r, i) => {
    t.push([
      chalk.bold(String(i + 1)),
      chalk.bold.yellow(fmtCompact(r.tokensTotal)),
      fmtCompact(r.tokensInput),
      fmtCompact(r.tokensOutput),
      r.cost ? '$' + r.cost.toFixed(4) : '—',
      shortModel(r.model),
      truncEnd(r.project, 30),
      truncEnd(r.title, 40) || '—',
    ]);
  });
  return boxen(t.toString(), {
    title: chalk.bold.yellow(`Top ${n} Heaviest Sessions`),
    borderStyle: 'round',
    borderColor: 'yellow',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function renderNotes(detections, errors) {
  const lines = [];
  lines.push(chalk.bold.underline('Token definitions'));
  lines.push(`  • ${chalk.cyan('Input')}        — prompt tokens (what was sent to the model)`);
  lines.push(`  • ${chalk.green('Output')}       — completion tokens (what the model generated)`);
  lines.push(`  • ${chalk.cyan('Cache Read')}   — prompt tokens served from provider cache (cheap)`);
  lines.push(`  • ${chalk.cyan('Cache Write')}  — prompt tokens cached for future use (OpenCode only)`);
  lines.push(`  • ${chalk.yellow('Reasoning')}    — extended thinking / chain-of-thought tokens`);

  lines.push('');
  lines.push(chalk.bold.underline('Detected tools with token data'));
  const withTokens = detections.filter(d => d.hasTokens && d.status === 'present');
  if (withTokens.length === 0) {
    lines.push('  ' + chalk.dim('(none — only presence info available)'));
  } else {
    for (const d of withTokens) {
      lines.push(`  ${chalk.green('●')} ${colorize(d.name, toolColor(d.key))}  ${chalk.dim(d.description)}`);
    }
  }

  lines.push('');
  lines.push(chalk.bold.underline('Detected tools without token data (presence only)'));
  const noTokens = detections.filter(d => !d.hasTokens && d.status === 'present');
  if (noTokens.length === 0) {
    lines.push('  ' + chalk.dim('(none)'));
  } else {
    for (const d of noTokens) {
      lines.push(`  ${chalk.green('●')} ${colorize(d.name, toolColor(d.key))}  ${chalk.dim(d.description)}`);
    }
  }

  lines.push('');
  lines.push(chalk.bold.underline('Env overrides'));
  lines.push('  $CLAUDE_HOME    $CODEX_HOME    $OPENCODE_HOME    $MIMOCODE_HOME');
  lines.push('  $COPILOT_HOME   $ANTIGRAVITY_HOME    $GEMINI_HOME');
  lines.push('  $AI_USAGE_PATHS_JSON = ' + chalk.italic('\'{"codex":"/custom/path"}\''));

  if (errors && errors.length) {
    lines.push('');
    lines.push(chalk.bold.underline(chalk.red(`Errors (${errors.length})`)));
    for (const e of errors.slice(0, 5)) {
      lines.push('  ' + chalk.red('! ') + e);
    }
    if (errors.length > 5) lines.push('  ' + chalk.dim(`... and ${errors.length - 5} more`));
  }

  return boxen(lines.join('\n'), {
    borderStyle: 'round',
    borderColor: 'gray',
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });
}
