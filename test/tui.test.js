import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInteractive } from '../src/tui.js';

test('interactive exit reports that the session was handled', async () => {
  const stdinTTY = process.stdin.isTTY;
  const stdoutTTY = process.stdout.isTTY;
  const rawMode = process.stdin.setRawMode;
  const write = process.stdout.write;
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
  process.stdin.setRawMode = () => {};
  process.stdout.write = () => true;
  try {
    const result = runInteractive({ records: [], detections: [], errors: [], topN: 5 });
    process.stdin.emit('keypress', 'q', { name: 'q' });
    assert.equal(await result, true);
  } finally {
    process.stdin.isTTY = stdinTTY;
    process.stdout.isTTY = stdoutTTY;
    process.stdin.setRawMode = rawMode;
    process.stdout.write = write;
  }
});

test('quota tab renders both providers and removes listeners on exit', async () => {
  const stdinTTY = process.stdin.isTTY, stdoutTTY = process.stdout.isTTY;
  const rawMode = process.stdin.setRawMode, write = process.stdout.write;
  const initialKeys = process.stdin.listenerCount('keypress');
  const initialResize = process.stdout.listenerCount('resize');
  let output = '';
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
  process.stdin.setRawMode = () => {};
  process.stdout.write = chunk => { output += chunk; return true; };
  try {
    const result = runInteractive({ records: [], detections: [], errors: [], topN: 5, quotaPromise: Promise.resolve([
      { provider: 'claude', windows: [{ label: 'Session', usedPercent: 25 }] },
      { provider: 'codex', windows: [{ label: 'Weekly', usedPercent: 50 }] },
    ]) });
    await Promise.resolve();
    process.stdin.emit('keypress', '0', { name: '0' });
    process.stdin.emit('keypress', 'q', { name: 'q' });
    await result;
    assert.match(output, /Claude/);
    assert.match(output, /Codex/);
    assert.equal(process.stdin.listenerCount('keypress'), initialKeys);
    assert.equal(process.stdout.listenerCount('resize'), initialResize);
  } finally {
    process.stdin.isTTY = stdinTTY;
    process.stdout.isTTY = stdoutTTY;
    process.stdin.setRawMode = rawMode;
    process.stdout.write = write;
  }
});

test('interactive TUI shows the live ten-minute rate and closes its timer', async () => {
  const stdinTTY = process.stdin.isTTY, stdoutTTY = process.stdout.isTTY;
  const rawMode = process.stdin.setRawMode, write = process.stdout.write;
  let output = '', ticks = 0;
  process.stdin.isTTY = true; process.stdout.isTTY = true;
  process.stdin.setRawMode = () => {};
  process.stdout.write = chunk => { output += chunk; return true; };
  try {
    const result = runInteractive({ records: [], detections: [], errors: [], topN: 5, liveTailer: { tick: () => { ticks++; return 42; } } });
    process.stdin.emit('keypress', 'q', { name: 'q' });
    await result;
    assert.equal(ticks, 1);
    assert.match(output, /42.*tokens\/min/);
  } finally {
    process.stdin.isTTY = stdinTTY; process.stdout.isTTY = stdoutTTY;
    process.stdin.setRawMode = rawMode; process.stdout.write = write;
  }
});
