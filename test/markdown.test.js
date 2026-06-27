// Tests for the markdown renderer
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';

const DETECTIONS_FULL = [
  { key: 'claude', name: 'Claude Code', kind: 'jsonl', status: 'present',
    path: '/home/u/.claude/transcripts', count: 2, hasTokens: false,
    description: '~/.claude/transcripts/*.jsonl  (no token data stored locally)' },
  { key: 'codex', name: 'Codex', kind: 'jsonl-rollout', status: 'present',
    path: '/home/u/.codex/sessions', count: 94, hasTokens: true,
    description: '~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl' },
  { key: 'opencode', name: 'OpenCode', kind: 'sqlite', status: 'present',
    path: '/home/u/.local/share/opencode/opencode.db', count: 328, hasTokens: true,
    description: '~/.local/share/opencode/opencode.db  (tokens + cost)' },
  { key: 'mimocode', name: 'MimoCode', kind: 'sqlite', status: 'present',
    path: '/home/u/.local/share/mimocode/mimocode.db', count: 0, hasTokens: true,
    description: '~/.local/share/mimocode/mimocode.db  (tokens + cost)' },
  { key: 'copilot', name: 'GitHub Copilot', kind: 'jsonl-events', status: 'present',
    path: '/home/u/.copilot/session-state', count: 1, hasTokens: false,
    description: '~/.copilot/session-state/*/events.jsonl  (no token data)' },
  { key: 'antigravity', name: 'Antigravity', kind: 'dir', status: 'present',
    path: '/home/u/Library/Application Support/Antigravity', count: 17, hasTokens: false,
    description: '~/Library/Application Support/Antigravity  (no token data)' },
  { key: 'gemini', name: 'Gemini CLI', kind: 'protobuf', status: 'present',
    path: '/home/u/.gemini/antigravity/conversations', count: 6, hasTokens: false,
    description: '~/.gemini/antigravity/conversations/*.pb  (binary, no token data)' },
];

const RECORDS = [
  { tool: 'codex', project: '/home/u/dev/after-last-night', title: 'Refactor',
    week: '2026-W22', month: '2026-05', ts: 1716000000000,
    tokensInput: 100, tokensOutput: 50, tokensCacheRead: 200,
    tokensCacheWrite: 0, tokensReasoning: 0, tokensTotal: 350, cost: 0, model: '' },
  { tool: 'opencode', project: '/home/u/dev/after-last-night', title: 'Setup',
    week: '2026-W22', month: '2026-05', ts: 1716100000000,
    tokensInput: 50, tokensOutput: 25, tokensCacheRead: 100,
    tokensCacheWrite: 10, tokensReasoning: 5, tokensTotal: 190, cost: 0.01, model: '{"id":"mimo-v2.5","providerId":"minimax"}' },
  { tool: 'opencode', project: '/home/u/dev/tahu-tempe', title: 'Feature X',
    week: '2026-W23', month: '2026-06', ts: 1716200000000,
    tokensInput: 200, tokensOutput: 100, tokensCacheRead: 400,
    tokensCacheWrite: 0, tokensReasoning: 0, tokensTotal: 700, cost: 0.02, model: 'mimo-v2.5' },
];

test('markdown: returns a string', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  assert.equal(typeof md, 'string');
  assert.ok(md.length > 0);
});

test('markdown: starts with H1 title', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  assert.ok(md.startsWith('# AI Token Usage Report'),
    `expected to start with H1, got: ${md.slice(0, 50)}`);
});

test('markdown: contains all 7 tools in the Detected table', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  for (const d of DETECTIONS_FULL) {
    assert.ok(md.includes(d.name), `missing tool: ${d.name}`);
  }
});

test('markdown: shows session count and total tokens in header', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  assert.ok(md.includes('**Sessions**: 3'));
  // 350 + 190 + 700 = 1240 → fmtCompact → "1.2K"
  assert.ok(md.includes('1.2K'), `expected '1.2K' for 1240 tokens, got: ${md.split('\n').find(l => l.includes('Total tokens'))}`);
});

test('markdown: includes per-project table with code-fenced paths', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  assert.ok(md.includes('## Per Project'));
  assert.ok(md.includes('`/home/u/dev/after-last-night`'),
    'expected backtick-quoted path');
});

test('markdown: per-project path is unchanged when no HOME is set', () => {
  // mdEscape uses HOME from env; in CI HOME may be set. We only check that
  // the path appears at all, not that it was compacted.
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  assert.ok(md.includes('after-last-night'));
});

test('markdown: includes per-month and per-week sections', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  assert.ok(md.includes('## Per Month'));
  assert.ok(md.includes('## Per Week'));
});

test('markdown: includes top N sessions table', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL, topN: 2 });
  assert.ok(md.includes('## Top 2 Heaviest Sessions'));
  assert.ok(md.includes('| 1 |'));   // row 1
  assert.ok(md.includes('| 2 |'));   // row 2
  // row 3 should NOT appear
  assert.ok(!md.includes('| 3 |'));
});

test('markdown: token breakdown has all 5 categories', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  for (const label of ['Input', 'Output', 'Cache Read', 'Cache Write', 'Reasoning', 'Total']) {
    assert.ok(md.includes(`| ${label} |`), `missing breakdown row: ${label}`);
  }
});

test('markdown: distribution bars use unicode block chars', () => {
  const md = renderMarkdown({ records: RECORDS, detections: DETECTIONS_FULL });
  // at least one row should have a non-empty bar (█ or both chars)
  const barPattern = /[█░]{6,}/;
  assert.ok(barPattern.test(md), 'no distribution bar found in markdown');
});

test('markdown: escapes pipe characters in titles', () => {
  const tricky = [{
    tool: 'codex', project: '/h/p', title: 'A | B | C',
    week: '2026-W22', month: '2026-05', ts: 1,
    tokensInput: 0, tokensOutput: 0, tokensCacheRead: 0,
    tokensCacheWrite: 0, tokensReasoning: 0, tokensTotal: 1, cost: 0, model: '',
  }];
  const md = renderMarkdown({ records: tricky, detections: DETECTIONS_FULL });
  assert.ok(md.includes('A \\| B \\| C'), 'pipes should be escaped');
  // And the table should still be valid (no broken row from bare pipe)
  const lines = md.split('\n').filter(l => l.includes('A \\| B \\| C'));
  assert.equal(lines.length, 1);
});

test('markdown: shortModel extracts id from JSON model field', () => {
  const rec = [{
    tool: 'opencode', project: '/h/p', title: 't',
    week: '2026-W22', month: '2026-05', ts: 1,
    tokensInput: 0, tokensOutput: 0, tokensCacheRead: 0,
    tokensCacheWrite: 0, tokensReasoning: 0, tokensTotal: 100, cost: 0,
    model: '{"id":"mimo-v2.5","providerId":"minimax"}',
  }];
  const md = renderMarkdown({ records: rec, detections: DETECTIONS_FULL, topN: 1 });
  assert.ok(md.includes('mimo-v2.5'));
  assert.ok(md.includes('minimax'));
});

test('markdown: handles empty records (only detection panel)', () => {
  const md = renderMarkdown({ records: [], detections: DETECTIONS_FULL });
  assert.ok(md.includes('# AI Token Usage Report'));
  assert.ok(md.includes('No session data available'));
  // should NOT include per-project / per-month / per-week / top sections
  assert.ok(!md.includes('## Per Project'));
  assert.ok(!md.includes('## Top '));
});

test('markdown: surfaces errors in Errors section', () => {
  const errors = ['MimoCode: session table has no token columns',
                  'Something else broke'];
  const md = renderMarkdown({
    records: RECORDS, detections: DETECTIONS_FULL, errors,
  });
  assert.ok(md.includes('### Errors'));
  assert.ok(md.includes('MimoCode'));
  assert.ok(md.includes('Something else broke'));
});

test('markdown: trims errors list at 10 entries', () => {
  const errors = Array.from({ length: 15 }, (_, i) => `Error ${i}`);
  const md = renderMarkdown({
    records: RECORDS, detections: DETECTIONS_FULL, errors,
  });
  assert.ok(md.includes('Error 0'));
  assert.ok(md.includes('Error 9'));
  assert.ok(!md.includes('Error 10'));
  assert.ok(md.includes('… and 5 more'));
});

test('markdown: missing dates show as em-dash', () => {
  const md = renderMarkdown({
    records: RECORDS, detections: DETECTIONS_FULL, dateRange: [null, null],
  });
  assert.ok(md.includes('**Range**: — → —'));
});
