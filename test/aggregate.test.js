// Smoke tests for ai-usage-analyzer
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAll } from '../src/detectors.js';
import { loadAll, dateRange } from '../src/loaders.js';
import {
  overall, perTool, perProject, perMonth, perWeek, tokenBreakdown,
} from '../src/aggregate.js';

test('detectAll returns the seven expected tool keys', () => {
  const dets = detectAll();
  const keys = dets.map(d => d.key);
  for (const k of ['claude', 'codex', 'opencode', 'mimocode', 'copilot', 'antigravity', 'gemini']) {
    assert.ok(keys.includes(k), `missing detector for ${k}`);
  }
  assert.equal(dets.length, 7);
});

test('every detection has the required fields', () => {
  const dets = detectAll();
  for (const d of dets) {
    assert.ok(typeof d.key === 'string');
    assert.ok(typeof d.name === 'string');
    assert.ok(['present', 'absent'].includes(d.status));
    assert.equal(typeof d.hasTokens, 'boolean');
  }
});

test('tokenBreakdown ratios sum to ~1.0', () => {
  const totals = {
    tokensTotal: 1000,
    tokensInput: 400,
    tokensOutput: 200,
    tokensCacheRead: 300,
    tokensCacheWrite: 50,
    tokensReasoning: 50,
  };
  const b = tokenBreakdown(totals);
  const sumRatios = Object.values(b.ratios).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumRatios - 1.0) < 0.001, `ratios sum to ${sumRatios}`);
});

test('aggregate functions return sane shapes on empty input', () => {
  assert.deepEqual(perProject([]), []);
  assert.deepEqual(perMonth([]), []);
  assert.deepEqual(perWeek([]), []);
  assert.deepEqual(perTool([]), []);
  assert.deepEqual(overall([]), {
    n: 0, tokensTotal: 0, tokensInput: 0, tokensOutput: 0,
    tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0,
    cost: 0, avg: 0,
  });
});

test('overall sums fields correctly', () => {
  const records = [
    { tokensInput: 100, tokensOutput: 50, tokensCacheRead: 200,
      tokensCacheWrite: 10, tokensReasoning: 5, tokensTotal: 365, cost: 0.01 },
    { tokensInput: 50, tokensOutput: 25, tokensCacheRead: 100,
      tokensCacheWrite: 5, tokensReasoning: 2, tokensTotal: 182, cost: 0.02 },
  ];
  const t = overall(records);
  assert.equal(t.n, 2);
  assert.equal(t.tokensTotal, 547);
  assert.equal(t.cost, 0.03);
  assert.equal(t.avg, 273.5);
});

test('perTool groups by tool key', () => {
  const records = [
    { tool: 'opencode', tokensTotal: 100, tokensInput: 0, tokensOutput: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 0 },
    { tool: 'opencode', tokensTotal: 200, tokensInput: 0, tokensOutput: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 0 },
    { tool: 'codex', tokensTotal: 50, tokensInput: 0, tokensOutput: 0,
      tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 0 },
  ];
  const t = perTool(records);
  assert.equal(t.length, 2);
  const oc = t.find(p => p.tool === 'opencode');
  const cx = t.find(p => p.tool === 'codex');
  assert.equal(oc.tokensTotal, 300);
  assert.equal(oc.n, 2);
  assert.equal(cx.tokensTotal, 50);
});

test('dateRange returns nulls for empty input', () => {
  assert.deepEqual(dateRange([]), [null, null]);
});

test('loadAll returns an object with records and errors arrays', async () => {
  const dets = detectAll();
  const r = await loadAll(dets);
  assert.ok(Array.isArray(r.records));
  assert.ok(Array.isArray(r.errors));
});

test('records have the unified shape', async () => {
  const dets = detectAll();
  const { records } = await loadAll(dets);
  for (const r of records) {
    assert.ok(typeof r.tool === 'string');
    assert.ok(typeof r.week === 'string');
    assert.ok(/^\d{4}-W\d{2}$/.test(r.week), `bad week: ${r.week}`);
    assert.ok(/^\d{4}-\d{2}$/.test(r.month), `bad month: ${r.month}`);
    assert.equal(typeof r.tokensTotal, 'number');
    assert.ok(r.tokensTotal > 0);
  }
});

test('claude detector counts nested .jsonl files under projects/<dir>/', () => {
  // Simulate real Claude Code layout: ~/.claude/projects/<encoded-cwd>/<UUID>.jsonl
  const root = mkdtempSync(join(tmpdir(), 'claude-detector-'));
  const prev = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = root;
  try {
    const proj1 = join(root, 'projects', '-Users-foo--my-app');
    const proj2 = join(root, 'projects', '-Users-foo--other');
    mkdirSync(proj1, { recursive: true });
    mkdirSync(proj2, { recursive: true });
    writeFileSync(join(proj1, 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa.jsonl'), '{"type":"user"}\n');
    writeFileSync(join(proj1, 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb.jsonl'), '{"type":"user"}\n');
    writeFileSync(join(proj2, 'cccccccc-3333-3333-3333-cccccccccccc.jsonl'), '{"type":"user"}\n');
    // junk file that should be ignored
    writeFileSync(join(proj1, 'README.md'), 'not a session');

    const dets = detectAll();
    const claude = dets.find(d => d.key === 'claude');
    assert.ok(claude, 'claude detector missing');
    assert.equal(claude.status, 'present', `expected present, got ${claude.status}`);
    assert.equal(claude.count, 3, `expected 3 sessions, got ${claude.count}`);
    assert.equal(claude.path, join(root, 'projects'));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test('claude detector is absent when CLAUDE_HOME has no projects dir', () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-detector-'));
  const prev = process.env.CLAUDE_HOME;
  process.env.CLAUDE_HOME = root;
  try {
    // root exists but has no `projects` subdir
    mkdirSync(join(root, 'settings'), { recursive: true });
    const dets = detectAll();
    const claude = dets.find(d => d.key === 'claude');
    assert.equal(claude.status, 'absent');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_HOME;
    else process.env.CLAUDE_HOME = prev;
    rmSync(root, { recursive: true, force: true });
  }
});
