import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAll } from '../src/loaders.js';

async function load(key, lines) {
  const dir = mkdtempSync(join(tmpdir(), 'usage-'));
  try {
    writeFileSync(join(dir, key === 'codex' ? 'rollout-test.jsonl' : 'test.jsonl'), lines.map(x => JSON.stringify(x)).join('\n'));
    return (await loadAll([{ key, name: key, status: 'present', path: dir }])).records[0];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('Claude merges streamed usage by message and request', async () => {
  const line = (requestId, usage) => ({ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', requestId, message: { id: 'msg', model: 'claude', usage } });
  const r = await load('claude', [line('a', { input_tokens: 10, output_tokens: 1 }), line('a', { input_tokens: 10, output_tokens: 5 }), line('b', { input_tokens: 3, output_tokens: 2 })]);
  assert.equal(r.tokensInput, 13);
  assert.equal(r.tokensOutput, 7);
});

test('Codex separates cache and reasoning from inclusive token counts', async () => {
  const r = await load('codex', [
    { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { cwd: '/tmp' } },
    { type: 'turn_context', payload: { model: 'gpt-5' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 5 } } } },
  ]);
  assert.equal(r.tokensInput, 60);
  assert.equal(r.tokensOutput, 15);
  assert.equal(r.tokensCacheRead, 40);
  assert.equal(r.tokensReasoning, 5);
  assert.equal(r.tokensTotal, 120);
  assert.equal(r.model, 'gpt-5');
});

test('Codex excludes fork baseline and counts resets without repeated totals', async () => {
  const usage = (total, last) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total }, ...(last == null ? {} : { last_token_usage: { input_tokens: last } }) } } });
  const r = await load('codex', [
    { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { forked_from_id: 'parent' } },
    usage(100), { type: 'turn_context', payload: { model: 'gpt-5' } },
    usage(100, 100), usage(120, 20), usage(120, 20), usage(5, 5), usage(8),
  ]);
  assert.equal(r.tokensInput, 28);
});

test('Codex discovers archived sessions alongside sessions', async () => {
  const { mkdirSync } = await import('node:fs');
  const home = mkdtempSync(join(tmpdir(), 'usage-archive-'));
  try {
    const sessions = join(home, 'sessions');
    const archived = join(home, 'archived_sessions');
    mkdirSync(sessions);
    mkdirSync(archived);
    writeFileSync(join(archived, 'rollout-archived.jsonl'), [
      { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: {} },
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 4 } } } },
    ].map(JSON.stringify).join('\n'));
    const result = await loadAll([{ key: 'codex', name: 'codex', status: 'present', path: sessions }]);
    assert.equal(result.records.length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Codex skips inherited reported total after fork and counts subsequent usage', async () => {
  const event = (usage, last) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage, last_token_usage: last } } });
  const r = await load('codex', [
    { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { forked_from_id: 'parent' } },
    event({ input_tokens: 100, total_tokens: 100 }),
    { type: 'turn_context', payload: { model: 'gpt-5' } },
    event({ input_tokens: 80, total_tokens: 100 }, { input_tokens: 1 }),
    event({ input_tokens: 110, total_tokens: 110 }, { input_tokens: 10 }),
  ]);
  assert.equal(r.tokensTotal, 10);
});

test('Claude retains the model for each merged usage event', async () => {
  const line = (id, model, output) => ({ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { id, model, usage: { output_tokens: output } } });
  const r = await load('claude', [line('a', 'claude-sonnet', 1), line('a', 'claude-sonnet', 4), line('b', 'claude-opus', 3)]);
  assert.deepEqual(r.usageEvents.map(e => [e.model, e.usage.output_tokens]), [['claude-sonnet', 4], ['claude-opus', 3]]);
});

test('Claude session exposes a partial estimate for a mixed-model session', async () => {
  const line = (id, model, input) => ({ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { id, model, usage: { input_tokens: input } } });
  const r = await load('claude', [line('a', 'claude-haiku-4-5', 1000000), line('b', 'unknown-model', 10)]);
  assert.equal(r.cost, 1);
  assert.equal(r.costStatus, 'partial');
  assert.deepEqual(r.unknownModels, ['unknown-model']);
});

test('Codex detects duplicate sessions across active and archived copies', async () => {
  const { mkdirSync } = await import('node:fs');
  const home = mkdtempSync(join(tmpdir(), 'usage-duplicates-'));
  try {
    const sessions = join(home, 'sessions'), archived = join(home, 'archived_sessions');
    mkdirSync(sessions); mkdirSync(archived);
    const filename = 'rollout-2026-01-01T00-00-00-12345678-1234-1234-1234-123456789abc.jsonl';
    const lines = [{ type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { id: '12345678-1234-1234-1234-123456789abc' } }, { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10 } } } }].map(JSON.stringify).join('\n');
    writeFileSync(join(sessions, filename), lines);
    writeFileSync(join(archived, filename), lines);
    const result = await loadAll([{ key: 'codex', name: 'codex', status: 'present', path: sessions }]);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].sessionId, '12345678-1234-1234-1234-123456789abc');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('malformed token fields cannot poison history totals', async () => {
  const claude = await load('claude', [{ type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { id: 'a', model: 'claude-haiku-4-5', usage: { input_tokens: 'Infinity', output_tokens: 3, cache_read_input_tokens: 'bad' } } }]);
  assert.equal(claude.tokensTotal, 3);
  const codex = await load('codex', [{ type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: {} }, { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 'Infinity', output_tokens: 4 } } } }]);
  assert.equal(codex.tokensTotal, 4);
});

test('Codex custom-provider usage is not priced as OpenAI', async () => {
  const r = await load('codex', [
    { type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { model_provider: 'custom' } },
    { type: 'turn_context', payload: { model: 'gpt-5.4' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100 }, last_token_usage: { input_tokens: 100 } } } },
  ]);
  assert.equal(r.costStatus, 'unavailable');
});
