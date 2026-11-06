export function dayNumber(ts) {
  const date = new Date(ts);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function periodBounds(period, now = Date.now()) {
  const { key, from, to } = period;
  const today = dayNumber(now);
  const date = new Date(now);
  if (key === 'all') return null;
  if (key === 'custom') return [from, to];
  if (key === 'today') return [today, today];
  if (key === 'week') return [today - (date.getDay() + 6) % 7, today];
  if (key === 'year') return [dayNumber(new Date(date.getFullYear(), 0, 1).getTime()), today];
  return [today - Number(key) + 1, today];
}

export function dateValue(day) {
  return day == null ? '' : new Date(day * 86400000).toISOString().slice(0, 10);
}

export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ts = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ts)) return null;
  const day = ts / 86400000;
  return dateValue(day) === value ? day : null;
}

export function calendarDays(month) {
  const date = new Date(month * 86400000);
  date.setUTCDate(1);
  const first = date.getTime() / 86400000 - (date.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => first + index);
}
