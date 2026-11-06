import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, periodBounds, dateValue, parseDate, calendarDays } from '../web/dates.js';

test('date values round-trip without UTC shifting local calendar days', () => {
  const local = new Date(2026, 10, 6, 23, 59);
  assert.equal(dateValue(dayNumber(local.getTime())), '2026-11-06');
  assert.equal(parseDate('2026-11-06'), dayNumber(local.getTime()));
  for (const value of ['', '2026-02-30', '2026-13-01', 'not-a-date']) assert.equal(parseDate(value), null);
});

test('period bounds retain inclusive presets and custom endpoints', () => {
  const now = new Date(2026, 10, 6, 12).getTime();
  const today = dayNumber(now);
  assert.equal(periodBounds({ key: 'all' }, now), null);
  assert.deepEqual(periodBounds({ key: 'today' }, now), [today, today]);
  assert.deepEqual(periodBounds({ key: 'week' }, now), [parseDate('2026-11-02'), today]);
  assert.deepEqual(periodBounds({ key: '30' }, now), [today - 29, today]);
  assert.deepEqual(periodBounds({ key: '90' }, now), [today - 89, today]);
  assert.deepEqual(periodBounds({ key: 'year' }, now), [parseDate('2026-01-01'), today]);
  assert.deepEqual(periodBounds({ key: 'custom', from: today - 2, to: today }, now), [today - 2, today]);
});

test('calendar includes six complete Monday-first weeks across leap days and year boundaries', () => {
  const days = calendarDays(parseDate('2024-02-01'));
  assert.equal(days.length, 42);
  assert.equal(dateValue(days[0]), '2024-01-29');
  assert.ok(days.includes(parseDate('2024-02-29')));
  assert.equal(dateValue(days.at(-1)), '2024-03-10');
  assert.equal(dateValue(calendarDays(parseDate('2027-01-01'))[0]), '2026-12-28');
});
