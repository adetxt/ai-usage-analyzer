import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardStats, cardSummary } from '../web/card.js';

const at = (iso, extra = {}) => ({ ts: new Date(iso).getTime(), tool: 'claude', project: 'a', tokensTotal: 100, ...extra });

test('cardStats counts sessions, projects, active days and the longest streak', () => {
  const stats = cardStats([
    at('2026-03-02T10:00:00'),
    at('2026-03-02T15:00:00', { project: 'b', tokensTotal: 400 }),
    at('2026-03-03T10:00:00'),
    at('2026-03-04T10:00:00', { tool: 'codex' }),
    at('2026-03-09T10:00:00'),
  ]);
  assert.equal(stats.sessions, 5);
  assert.equal(stats.projects, 2);
  assert.equal(stats.activeDays, 4);
  assert.equal(stats.longestStreak, 3);
  assert.equal(stats.tokens, 800);
  assert.equal(stats.busiest.tokens, 500);
  assert.deepEqual(stats.tools.map(entry => entry[0]), ['claude', 'codex']);
});

test('cardStats picks a persona from session start times', () => {
  assert.equal(cardStats([at('2026-03-02T23:30:00'), at('2026-03-03T01:00:00'), at('2026-03-04T10:00:00')]).persona[0], 'Night owl');
  assert.equal(cardStats([at('2026-03-07T10:00:00'), at('2026-03-08T10:00:00'), at('2026-03-04T10:00:00')]).persona[0], 'Weekend warrior');
});

test('cardStats handles empty and undated input', () => {
  const empty = cardStats([]);
  assert.equal(empty.sessions, 0);
  assert.equal(empty.tape, null);
  assert.equal(empty.persona, null);
  assert.equal(cardSummary(empty, 'All time'), 'No sessions in this selection.');
  assert.equal(cardStats([{ ts: NaN, tool: 'x', project: 'p', tokensTotal: 5 }]).activeDays, 0);
});
