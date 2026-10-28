import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveUsageTailer } from '../src/live.js';

test('tailer starts at end, reads partial lines, and merges Claude streamed events', () => {
  const root = mkdtempSync(join(tmpdir(), 'live-'));
  try {
    const file = join(root, 'session.jsonl');
    const event = n => JSON.stringify({ type: 'assistant', requestId: 'r', message: { id: 'm', usage: { input_tokens: 10, output_tokens: n } } });
    writeFileSync(file, event(1) + '\n');
    const live = new LiveUsageTailer([{ key: 'claude', path: root }]);
    live.tick(1000);
    assert.equal(live.rate(1000, 60), 0);
    const line = event(3);
    appendFileSync(file, line.slice(0, 20));
    live.tick(2000);
    assert.equal(live.rate(2000, 60), 0);
    appendFileSync(file, line.slice(20) + '\n' + event(5) + '\n');
    live.tick(3000);
    assert.equal(live.rate(3000, 60), 15);
    assert.equal(live.rate(64000, 60), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('tailer reads new Codex files and resets after truncation', () => {
  const root = mkdtempSync(join(tmpdir(), 'live-'));
  try {
    const live = new LiveUsageTailer([{ key: 'codex', path: root }]);
    live.tick(1000);
    const file = join(root, 'rollout-a.jsonl');
    const line = (total, input) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total }, last_token_usage: { input_tokens: input, output_tokens: 2 } } } }) + '\n';
    writeFileSync(file, line(100, 10) + line(100, 10));
    live.tick(2000);
    assert.equal(live.rate(2000, 60), 12);
    writeFileSync(file, line(1, 1));
    live.tick(3000);
    assert.equal(live.rate(3000, 60), 15);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('tailer reads a rotated file from the beginning', async () => {
  const { renameSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'live-rotate-'));
  try {
    const path = join(root, 'session.jsonl');
    writeFileSync(path, 'old\n');
    const live = new LiveUsageTailer([{ key: 'claude', path: root }]);
    live.tick(1000);
    renameSync(path, join(root, 'session.old'));
    writeFileSync(path, JSON.stringify({ type: 'assistant', message: { id: 'new', usage: { output_tokens: 7 } } }) + '\n');
    live.tick(2000);
    assert.equal(live.rate(2000, 60), 7);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('periodic full scan catches an old session that resumes', async () => {
  const { utimesSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'live-resume-'));
  try {
    const file = join(root, 'session.jsonl');
    writeFileSync(file, 'old\n');
    const now = Date.now();
    utimesSync(file, new Date(now - 3600000), new Date(now - 3600000));
    const live = new LiveUsageTailer([{ key: 'claude', path: root }]);
    live.tick(now);
    appendFileSync(file, JSON.stringify({ type: 'assistant', message: { id: 'resumed', usage: { output_tokens: 12 } } }) + '\n');
    live.tick(now + 5000);
    assert.equal(live.rate(now + 5000, 60), 0);
    live.tick(now + 60000);
    assert.equal(live.rate(now + 60000, 60), 12);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('archiving a completed Codex log does not replay history as live usage', async () => {
  const { renameSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'live-archive-'));
  try {
    const sessions = join(root, 'sessions'), archived = join(root, 'archived_sessions');
    mkdirSync(sessions); mkdirSync(archived);
    const name = 'rollout-test.jsonl';
    writeFileSync(join(sessions, name), JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100 } } } }) + '\n');
    const live = new LiveUsageTailer([{ key: 'codex', path: sessions }]);
    live.tick(1000);
    renameSync(join(sessions, name), join(archived, name));
    live.tick(2000);
    assert.equal(live.rate(2000, 60), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('tailer detects truncation and regrowth between polls on the same inode', () => {
  const root = mkdtempSync(join(tmpdir(), 'live-regrowth-'));
  try {
    const path = join(root, 'session.jsonl');
    writeFileSync(path, 'old history\n');
    const live = new LiveUsageTailer([{ key: 'claude', path: root }]);
    live.tick(1000);
    writeFileSync(path, JSON.stringify({ type: 'assistant', message: { id: 'replacement', usage: { output_tokens: 8 } } }) + '\n');
    live.tick(2000);
    assert.equal(live.rate(2000, 60), 8);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
