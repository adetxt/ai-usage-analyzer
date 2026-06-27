// Group session records by various dimensions and compute stats.

const MONTH_NAMES = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
  '05': 'Mei', '06': 'Jun', '07': 'Jul', '08': 'Agu',
  '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Des',
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

export function perProject(records) {
  const m = groupBy(records, r => `${r.tool}\u0001${r.project}`);
  const out = [];
  for (const [k, arr] of m) {
    const [tool, project] = k.split('\u0001');
    const s = summarize(arr);
    out.push({ tool, project, ...s });
  }
  return out.sort((a, b) => b.tokensTotal - a.tokensTotal);
}

export function perMonth(records) {
  const m = groupBy(records, r => r.month);
  const out = [];
  for (const [month, arr] of m) {
    const byTool = {};
    for (const r of arr) {
      byTool[r.tool] = (byTool[r.tool] || 0) + r.tokensTotal;
    }
    out.push({ month, ...summarize(arr), byTool });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

export function perWeek(records) {
  const m = groupBy(records, r => r.week);
  const out = [];
  for (const [week, arr] of m) {
    const byTool = {};
    for (const r of arr) {
      byTool[r.tool] = (byTool[r.tool] || 0) + r.tokensTotal;
    }
    out.push({ week, ...summarize(arr), byTool });
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
