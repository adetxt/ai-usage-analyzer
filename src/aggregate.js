// Group session records by various dimensions and compute stats.

const MONTH_NAMES = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

function sum(arr, key) {
  return arr.reduce((a, b) => a + (b[key] || 0), 0);
}

function avg(arr, key) {
  return arr.length ? sum(arr, key) / arr.length : 0;
}

export function groupBy(records, keyFn) {
  const out = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

function summarize(records) {
  return {
    n: records.length,
    tokensTotal: sum(records, 'tokensTotal'),
    tokensInput: sum(records, 'tokensInput'),
    tokensOutput: sum(records, 'tokensOutput'),
    tokensCacheRead: sum(records, 'tokensCacheRead'),
    tokensCacheWrite: sum(records, 'tokensCacheWrite'),
    tokensReasoning: sum(records, 'tokensReasoning'),
    cost: sum(records, 'cost'),
    avg: avg(records, 'tokensTotal'),
  };
}

function toolBreakdown(records) {
  const byTool = {};
  for (const r of records) {
    byTool[r.tool] = (byTool[r.tool] || 0) + r.tokensTotal;
  }
  return byTool;
}

export function perProject(records) {
  // One row per project — tool mix is shown via the stacked bar / byTool,
  // not as a separate column. Detailed per-tool-per-project breakdown
  // is no longer surfaced here; the "Per Tool per Month" section is the
  // place to see per-tool data over time.
  const m = groupBy(records, r => r.project);
  const out = [];
  for (const [project, arr] of m) {
    out.push({ project, ...summarize(arr), byTool: toolBreakdown(arr) });
  }
  return out.sort((a, b) => b.tokensTotal - a.tokensTotal);
}

export function perMonth(records) {
  const m = groupBy(records, r => r.month);
  const out = [];
  for (const [month, arr] of m) {
    out.push({ month, ...summarize(arr), byTool: toolBreakdown(arr) });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

export function perWeek(records) {
  const m = groupBy(records, r => r.week);
  const out = [];
  for (const [week, arr] of m) {
    out.push({ week, ...summarize(arr), byTool: toolBreakdown(arr) });
  }
  return out.sort((a, b) => a.week.localeCompare(b.week));
}

export function perTool(records) {
  const m = groupBy(records, r => r.tool);
  const out = [];
  for (const [tool, arr] of m) {
    out.push({ tool, ...summarize(arr) });
  }
  return out.sort((a, b) => b.tokensTotal - a.tokensTotal);
}

export function perToolPerMonth(records) {
  // Cross-tab: one row per (tool, month). Lets you see how a single tool's
  // usage is distributed across months — and avoids the hardcoded OC/CX/MM
  // column problem in the per-month table.
  const m = groupBy(records, r => `${r.tool}\u0001${r.month}`);
  const out = [];
  for (const [k, arr] of m) {
    const [tool, month] = k.split('\u0001');
    out.push({ tool, month, ...summarize(arr) });
  }
  return out.sort((a, b) => b.tokensTotal - a.tokensTotal);
}

export function overall(records) {
  return summarize(records);
}

export function topSessions(records, n = 5) {
  return [...records]
    .sort((a, b) => b.tokensTotal - a.tokensTotal)
    .slice(0, n);
}

export function tokenBreakdown(s) {
  // Returns { input, output, cacheRead, cacheWrite, reasoning, total, ratios }
  const total = s.tokensTotal || 1;
  return {
    input: s.tokensInput,
    output: s.tokensOutput,
    cacheRead: s.tokensCacheRead,
    cacheWrite: s.tokensCacheWrite,
    reasoning: s.tokensReasoning,
    total: s.tokensTotal,
    ratios: {
      input: s.tokensInput / total,
      output: s.tokensOutput / total,
      cacheRead: s.tokensCacheRead / total,
      cacheWrite: s.tokensCacheWrite / total,
      reasoning: s.tokensReasoning / total,
    },
  };
}

export { MONTH_NAMES };
