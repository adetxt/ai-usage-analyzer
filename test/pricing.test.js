import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateUsage } from '../src/pricing.js';

test('prices Claude input, output, cache read, and cache write by model', () => {
  const result = estimateUsage('claude', [{ model: 'claude-sonnet-4-6', usage: { input_tokens: 1000000, output_tokens: 1000000, cache_read_input_tokens: 1000000, cache_creation_input_tokens: 1000000 } }]);
  assert.equal(result.cost, 22.05);
  assert.equal(result.costStatus, 'estimated');
});

test('prices Codex cache and reasoning without double billing and uses long-context rates', () => {
  const result = estimateUsage('codex', [{ model: 'gpt-5.4', usage: { input_tokens: 300000, cached_input_tokens: 100000, output_tokens: 10000, reasoning_output_tokens: 5000 } }]);
  assert.equal(result.cost, 1.275);
});

test('keeps known estimates while marking unknown models incomplete', () => {
  const result = estimateUsage('claude', [{ model: 'claude-haiku-4-5', usage: { input_tokens: 1000000 } }, { model: 'future-model', usage: { input_tokens: 1 } }]);
  assert.equal(result.cost, 1);
  assert.equal(result.costStatus, 'partial');
  assert.deepEqual(result.unknownModels, ['future-model']);
});

test('does not apply a known model rate to a future model family', () => {
  assert.equal(estimateUsage('codex', [{ model: 'gpt-5.99', usage: { input_tokens: 10 } }]).costStatus, 'unavailable');
});

test('aggregates recorded and estimated costs while marking unknown portions', async () => {
  const { overall } = await import('../src/aggregate.js');
  const totals = overall([{ cost: 5, costStatus: 'recorded' }, { cost: 1, costStatus: 'estimated' }, { cost: 0, costStatus: 'unavailable', unknownModels: ['new-model'] }]);
  assert.equal(totals.cost, 6);
  assert.equal(totals.costStatus, 'partial');
  assert.deepEqual(totals.unknownModels, ['new-model']);
});

test('Markdown identifies estimated and incomplete totals', async () => {
  const { renderMarkdown } = await import('../src/markdown.js');
  const records = [{ tool: 'claude', project: '/tmp', month: '2026-01', week: '2026-W01', ts: Date.parse('2026-01-01'), tokensInput: 10, tokensOutput: 0, tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, tokensTotal: 10, cost: 1, costStatus: 'partial', unknownModels: ['future-model'] }];
  const text = renderMarkdown({ records, detections: [], dateRange: ['2026-01-01', '2026-01-01'] });
  assert.match(text, /partial/i);
  assert.match(text, /future-model/);
  assert.doesNotMatch(text, /opencode only/i);
});

test('TUI overview names models excluded from the cost estimate', async () => {
  const { renderOverview } = await import('../src/render.js');
  const text = renderOverview([{ tool: 'claude', project: '/tmp', tokensTotal: 1, tokensInput: 1, tokensOutput: 0, tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 0, costStatus: 'unavailable', unknownModels: ['unknown-xyz'] }], []);
  assert.match(text, /unknown-xyz/);
});

test('prices GPT-5.1 Codex using its published rates', () => {
  const result = estimateUsage('codex', [{ model: 'gpt-5.1-codex', usage: { input_tokens: 1000000, output_tokens: 1000000 } }]);
  assert.equal(result.cost, 11.25);
  assert.equal(result.costStatus, 'estimated');
});

test('GPT-5.5 long-context rates apply to the entire request', () => {
  const result = estimateUsage('codex', [{ model: 'gpt-5.5', usage: { input_tokens: 300000, cached_input_tokens: 100000, output_tokens: 10000 } }]);
  assert.equal(result.cost, 2.55);
});

test('prices long-context Claude Sonnet 4.5 using all prompt token categories', () => {
  const result = estimateUsage('claude', [{ model: 'claude-sonnet-4-5', usage: { input_tokens: 100000, cache_read_input_tokens: 100001, output_tokens: 1000 } }]);
  assert.ok(Math.abs(result.cost - 0.6825006) < 1e-10);
});

test('long-context Claude cache writes use the higher rate', () => {
  const result = estimateUsage('claude', [{ model: 'claude-sonnet-4-5', usage: { cache_creation_input_tokens: 200001 } }]);
  assert.ok(Math.abs(result.cost - 1.5000075) < 1e-10);
});

test('unknown variants do not inherit a known model price', () => {
  assert.equal(estimateUsage('codex', [{ model: 'gpt-5.4-future', usage: { input_tokens: 10 } }]).costStatus, 'unavailable');
  assert.equal(estimateUsage('claude', [{ model: 'claude-opus-4-6-fast', usage: { input_tokens: 10 } }]).costStatus, 'unavailable');
});

test('TUI does not emit control characters from unpriced model names', async () => {
  const { renderOverview } = await import('../src/render.js');
  const text = renderOverview([{ tool: 'claude', project: '/tmp', tokensTotal: 1, tokensInput: 1, tokensOutput: 0, tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0, cost: 0, costStatus: 'unavailable', unknownModels: ['\u001b]0;fixture\u0007'] }], []);
  assert.doesNotMatch(text, /\u001b\]0;fixture/);
});

test('does not price aggregated Codex usage when request thresholds are unknowable', () => {
  const result = estimateUsage('codex', [{ model: 'gpt-5.4', aggregated: true, usage: { input_tokens: 300000, output_tokens: 1000 } }]);
  assert.equal(result.costStatus, 'unavailable');
  assert.equal(result.cost, 0);
});

test('does not attribute aggregate usage across model changes', () => {
  const result = estimateUsage('codex', [{ model: 'gpt-5.4', ambiguousModel: true, usage: { input_tokens: 1000 } }]);
  assert.equal(result.costStatus, 'unavailable');
});

