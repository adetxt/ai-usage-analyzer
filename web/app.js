import { overall, perProject, perTool, perMonth, topSessions } from '/aggregate.js';

const $ = id => document.getElementById(id);
const root = document.documentElement;
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const number = new Intl.NumberFormat('en');
const monthDate = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const dayDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });
const utcDayLong = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const utcDayShort = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayLong = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pageSize = 20;
const projectLimit = 8;
const views = ['overview', 'sessions', 'sources'];
const tokenFields = [
  ['Input', 'tokensInput'],
  ['Output', 'tokensOutput'],
  ['Cache read', 'tokensCacheRead'],
  ['Cache write', 'tokensCacheWrite'],
  ['Reasoning', 'tokensReasoning'],
];
const periodLabels = { all: 'All time', today: 'Today', week: 'This week', 30: 'Last 30 days', 90: 'Last 90 days', year: 'This year', custom: 'Custom range' };
const brandIcons = new Set(['claude', 'codex', 'opencode']);
const state = { data: null, page: 0, project: null, period: { key: 'all' }, tool: 'all', sort: 'tokens', allProjects: false, totalTarget: 0, previousTotal: 0, tapeKey: '', tapeFresh: false, tape: null };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let animation;

function readTheme() {
  try {
    const value = localStorage.getItem('theme');
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function effectiveTheme() {
  return root.dataset.theme || 'light';
}

function syncThemeButton() {
  $('theme').setAttribute('aria-pressed', String(effectiveTheme() === 'dark'));
}

function setTheme(theme) {
  root.dataset.theme = theme;
  syncThemeButton();
  try {
    localStorage.setItem('theme', theme);
  } catch {}
}

function finishAnimation() {
  animation?.progress(1).kill();
  animation = null;
  setTotal(state.totalTarget);
}

function currentView() {
  const name = location.hash.slice(1);
  return views.includes(name) ? name : 'overview';
}

function animateContent(kind) {
  finishAnimation();
  const gsap = window.gsap;
  if (!gsap || reducedMotion.matches) return;
  animation = gsap.timeline({ defaults: { ease: 'power3.out', duration: .6, clearProps: 'transform,opacity,visibility' } });
  const add = (selector, vars, position) => {
    if (gsap.utils.toArray(selector).length) animation.from(selector, vars, position);
  };
  if (kind === 'dialog') {
    animation.from($('session-dialog'), { x: 56, opacity: 0, duration: .4 });
    return;
  }
  const intro = kind === 'intro';
  const view = currentView();
  if (intro) {
    add('.masthead', { y: -12, autoAlpha: 0, duration: .5 });
    add('.filters', { autoAlpha: 0, duration: .5 }, .1);
  }
  const start = intro ? .15 : 0;
  if (view !== 'overview') {
    add(`#${view}-view`, { y: 14, autoAlpha: 0, duration: .45 }, start);
    return;
  }
  const from = intro || kind === 'view' ? 0 : state.previousTotal;
  setTotal(from);
  const counter = { value: from };
  animation.add(gsap.to(counter, { value: state.totalTarget, duration: 1.1, ease: 'power2.out', onUpdate: () => setTotal(counter.value) }), start);
  if (kind !== 'data') {
    add('#view-title, .hero-detail, .insight', { y: 16, autoAlpha: 0, stagger: .06 }, start);
    add('.slip > div', { y: 12, autoAlpha: 0, stagger: .06 }, start + .15);
  }
  add('#breakdown-bar .seg', { scaleX: 0, stagger: .06, duration: .7 }, start + .2);
  if (state.tapeFresh) {
    add('.tick', { scaleY: 0, stagger: { amount: .7 }, duration: .6 }, start + .3);
    state.tapeFresh = false;
  }
  add('.tool-row .fill, .proj-row .part', { scaleX: 0, stagger: .02, duration: .6 }, start + .4);
  add('.wd-bar', { scaleY: 0, stagger: .04 }, start + .4);
}

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) finishAnimation();
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clear(id) {
  const node = $(id);
  node.replaceChildren();
  return node;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function setTotal(value) {
  const text = compact.format(Math.max(0, value));
  const match = /^([\d.,]+)(.*)$/.exec(text);
  $('total-value').textContent = match ? match[1] : text;
  $('total-unit').textContent = match ? match[2] : '';
}

function toolName(key) {
  return state.data.detections.find(tool => tool.key === key)?.name || key;
}

function textureSwatch(key) {
  const node = el('span', `tx tx-${Math.max(0, state.data.tokenTools.indexOf(key)) % 6}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function toolSwatch(key) {
  if (!brandIcons.has(key)) return textureSwatch(key);
  const node = el('span', `ic ic-${key}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function textureClass(key) {
  return `tx-${Math.max(0, state.data.tokenTools.indexOf(key)) % 6}`;
}

function costLabel(summary) {
  const prefixes = { partial: '≥ ', estimated: '≈ ', recorded: '' };
  return summary.costStatus === 'unavailable' ? 'N/A' : `${prefixes[summary.costStatus] || ''}$${summary.cost.toFixed(2)}`;
}

function costDescription(status) {
  return ({ recorded: 'Recorded in local data', estimated: 'Estimated at public API rates', partial: 'Partial total, some costs missing', unavailable: 'Cost data unavailable' })[status];
}

function validTs(record) {
  return Number.isFinite(record.ts) && !Number.isNaN(new Date(record.ts).getTime());
}

function dated(ts, formatter = dayDate) {
  return Number.isFinite(ts) && !Number.isNaN(new Date(ts).getTime()) ? formatter.format(ts) : 'Unknown date';
}

function dayNumber(ts) {
  const date = new Date(ts);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function dayLabel(day, formatter = utcDayLong) {
  return formatter.format(day * 86400000);
}

function periodBounds() {
  const { key, from, to } = state.period;
  const today = dayNumber(Date.now());
  if (key === 'all') return null;
  if (key === 'custom') return [from, to];
  if (key === 'today') return [today, today];
  if (key === 'week') return [today - (new Date().getDay() + 6) % 7, today];
  if (key === 'year') return [dayNumber(new Date(new Date().getFullYear(), 0, 1).getTime()), today];
  return [today - Number(key) + 1, today];
}

function periodRecords() {
  const bounds = periodBounds();
  if (!bounds) return state.data.records;
  return state.data.records.filter(record => validTs(record) && dayNumber(record.ts) >= bounds[0] && dayNumber(record.ts) <= bounds[1]);
}

function toolRecords() {
  return state.tool === 'all' ? state.data.records : state.data.records.filter(record => record.tool === state.tool);
}

function selectedRecords() {
  return state.tool === 'all' ? periodRecords() : periodRecords().filter(record => record.tool === state.tool);
}

function makeTable(headers, numeric = []) {
  const table = el('table');
  const head = el('thead');
  const row = el('tr');
  headers.forEach((name, index) => {
    const th = el('th', numeric.includes(index) ? 'numeric' : '', name);
    th.scope = 'col';
    row.append(th);
  });
  head.append(row);
  const body = el('tbody');
  table.append(head, body);
  return { table, body, numeric };
}

function addRow(target, cells) {
  const row = el('tr');
  cells.forEach((content, index) => {
    const td = el('td', target.numeric.includes(index) ? 'numeric' : '');
    td.append(content instanceof Node ? content : document.createTextNode(String(content)));
    row.append(td);
  });
  target.body.append(row);
}

function empty(container, message, label, handler) {
  const block = el('div', 'empty');
  block.append(el('p', '', message));
  if (label) block.append(action(label, handler));
  container.append(block);
}

function action(text, handler) {
  const button = el('button', 'text-button', text);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function resetFilters() {
  state.period = { key: 'all' };
  state.tool = 'all';
  state.page = 0;
  render();
}

function filtersActive() {
  return state.period.key !== 'all' || state.tool !== 'all';
}

function dailyTotals(records) {
  const days = new Map();
  for (const record of records) {
    if (!validTs(record)) continue;
    const day = dayNumber(record.ts);
    days.set(day, (days.get(day) || 0) + (record.tokensTotal || 0));
  }
  return days;
}

function insightText(totals) {
  if (!totals.tokensTotal) return '';
  const share = value => `${(value / totals.tokensTotal * 100).toFixed(1)}%`;
  const [name, key] = tokenFields.reduce((best, field) => totals[field[1]] > totals[best[1]] ? field : best);
  if (key === 'tokensOutput') return `Output is ${share(totals.tokensOutput)} of the tokens.`;
  return `${name} is ${share(totals[key])} of the tokens. Output, the text you read back, is ${share(totals.tokensOutput)}.`;
}

function renderSummary(records) {
  const totals = overall(records);
  state.previousTotal = state.totalTarget;
  state.totalTarget = totals.tokensTotal;
  setTotal(totals.tokensTotal);
  $('total-detail').textContent = totals.n ? `${number.format(totals.tokensTotal)} tokens across ${number.format(totals.n)} ${totals.n === 1 ? 'session' : 'sessions'}` : 'No sessions in this selection';
  $('insight').textContent = insightText(totals);
  $('session-count').textContent = number.format(totals.n);
  $('project-count').textContent = number.format(new Set(records.map(record => record.project)).size);
  $('average').textContent = totals.n ? compact.format(totals.avg) : 'None';
  $('cost').textContent = costLabel(totals);
  $('cost-detail').textContent = costDescription(totals.costStatus);
  const days = dailyTotals(records);
  const busiest = [...days].reduce((best, entry) => !best || entry[1] > best[1] ? entry : best, null);
  $('busiest-day').textContent = busiest ? `${dayLabel(busiest[0], utcDayShort)} · ${compact.format(busiest[1])}` : 'None';
  const times = records.filter(validTs).map(record => record.ts);
  const range = times.reduce((result, ts) => [Math.min(result[0], ts), Math.max(result[1], ts)], [Infinity, -Infinity]);
  $('range-label').textContent = times.length ? `${dated(range[0])} to ${dated(range[1])}` : '';
  renderComposition(totals);
}

function renderComposition(totals) {
  const bar = clear('breakdown-bar');
  const list = clear('breakdown');
  const percent = value => totals.tokensTotal ? `${(Math.min(100, value / totals.tokensTotal * 100)).toFixed(1)}%` : '0%';
  bar.setAttribute('aria-label', `Token categories: ${tokenFields.map(([name, key]) => `${name} ${percent(totals[key])}`).join(', ')}`);
  tokenFields.forEach(([name, key], index) => {
    const value = totals[key] || 0;
    if (value) {
      const segment = el('div', `seg t${index}`);
      segment.style.flex = `${value} 1 0%`;
      bar.append(segment);
    }
    const item = el('li');
    item.title = `${name}: ${number.format(value)} tokens`;
    item.append(el('span', `chip seg t${index}`), el('span', '', name), el('strong', '', compact.format(value)), el('em', '', percent(value)));
    list.append(item);
  });
}

function tapeModel() {
  const records = toolRecords().filter(validTs);
  if (!records.length) return null;
  let first = Infinity;
  let last = dayNumber(Date.now());
  for (const record of records) {
    const day = dayNumber(record.ts);
    if (day < first) first = day;
    if (day > last) last = day;
  }
  const span = last - first + 1;
  const size = span > 400 ? 7 : 1;
  const count = Math.ceil(span / size);
  const buckets = Array.from({ length: count }, (_, index) => ({ start: first + index * size, end: Math.min(first + (index + 1) * size - 1, last), tokens: 0, n: 0 }));
  for (const record of records) {
    const bucket = buckets[Math.floor((dayNumber(record.ts) - first) / size)];
    bucket.tokens += record.tokensTotal || 0;
    bucket.n++;
  }
  return { first, last, size, count, buckets };
}

function bucketLabel(model, bucket) {
  return model.size === 1 ? dayLabel(bucket.start) : `Week of ${dayLabel(bucket.start, utcDayShort)}`;
}

function rangeReadout() {
  const bounds = periodBounds();
  const totals = overall(selectedRecords());
  const readout = clear('tape-readout');
  const detail = bounds
    ? `${bounds[0] === bounds[1] ? dayLabel(bounds[0], utcDayShort) : `${dayLabel(bounds[0], utcDayShort)} to ${dayLabel(bounds[1], utcDayShort)}`} · ${compact.format(totals.tokensTotal)} tokens`
    : state.tape ? `${dayLabel(state.tape.first, utcDayShort)} to ${dayLabel(state.tape.last, utcDayShort)}` : '';
  readout.append(document.createTextNode(`${periodLabels[state.period.key]} `), el('span', '', detail));
  $('tape-reset').hidden = !bounds;
}

function placeSelection(range) {
  const model = state.tape;
  const plot = $('tape').querySelector('.tape-plot');
  if (!model || !plot) return;
  const [left, right, pick] = plot.querySelectorAll('.veil-left, .veil-right, .pick');
  if (!range) {
    for (const node of [left, right, pick]) node.hidden = true;
    return;
  }
  const outside = range[1] < model.first || range[0] > model.last;
  const from = clamp(Math.floor((range[0] - model.first) / model.size), 0, model.count - 1);
  const to = clamp(Math.floor((range[1] - model.first) / model.size), 0, model.count - 1);
  const a = from / model.count * 100;
  const b = (to + 1) / model.count * 100;
  left.hidden = right.hidden = false;
  pick.hidden = outside;
  left.style.left = '0';
  left.style.width = outside ? '100%' : `${a}%`;
  right.style.left = `${b}%`;
  right.style.width = outside ? '0' : `${100 - b}%`;
  pick.style.left = `${a}%`;
  pick.style.width = `${b - a}%`;
}

function commitRange(fromIndex, toIndex) {
  const model = state.tape;
  const a = Math.min(fromIndex, toIndex);
  const b = Math.max(fromIndex, toIndex);
  state.period = { key: 'custom', from: model.first + a * model.size, to: Math.min(model.first + (b + 1) * model.size - 1, model.last) };
  state.page = 0;
  render();
}

function buildAxis(model, plotWidth) {
  const axis = el('div', 'tape-axis');
  axis.setAttribute('aria-hidden', 'true');
  let lastKey = '';
  let lastLeft = -Infinity;
  model.buckets.forEach((bucket, index) => {
    const date = new Date(bucket.start * 86400000);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    if (key === lastKey) return;
    lastKey = key;
    const left = index / model.count * plotWidth;
    if (left - lastLeft < 64) return;
    lastLeft = left;
    const label = el('span', '', date.getUTCMonth() === 0 || index === 0 ? monthDate.format(date) : shortMonth.format(date));
    label.style.left = `${index / model.count * 100}%`;
    axis.append(label);
  });
  return axis;
}

function renderTape() {
  const container = $('tape');
  const model = tapeModel();
  const key = `${state.tool}|${state.data.generatedAt}|${innerWidth}`;
  if (model && key === state.tapeKey && container.querySelector('.tape-plot')) {
    state.tape = model;
    placeSelection(periodBounds());
    rangeReadout();
    return;
  }
  state.tapeKey = key;
  state.tape = model;
  container.replaceChildren();
  if (!model) {
    $('tape-readout').replaceChildren();
    $('tape-reset').hidden = true;
    empty(container, 'No dated sessions for this tool. Sessions without a date cannot be placed on the tape.', state.tool !== 'all' ? 'Show all tools' : '', () => { state.tool = 'all'; render(); });
    return;
  }
  state.tapeFresh = true;
  const peak = model.buckets.reduce((best, bucket) => bucket.tokens > best.tokens ? bucket : best);
  const peakIndex = model.buckets.indexOf(peak);
  const plot = el('div', 'tape-plot');
  plot.tabIndex = 0;
  plot.setAttribute('role', 'group');
  plot.setAttribute('aria-label', 'Daily token activity. Use left and right arrow keys to read each day, hold Shift to select a range, press Escape to clear it. Exact monthly values are below.');
  model.buckets.forEach((bucket, index) => {
    const tick = el('div', 'tick');
    if (!bucket.tokens) tick.classList.add('zero');
    else tick.style.setProperty('--h', `${Math.max(2, bucket.tokens / peak.tokens * 100)}%`);
    if (index === peakIndex && bucket.tokens) tick.classList.add('peak');
    plot.append(tick);
  });
  const cursor = el('div', 'cursor');
  cursor.hidden = true;
  plot.append(el('div', 'veil veil-left'), el('div', 'veil veil-right'), el('div', 'pick'), cursor);
  if (peak.tokens) {
    const flag = el('div', 'peak-flag', `Peak ${compact.format(peak.tokens)} · ${model.size === 1 ? dayLabel(peak.start, utcDayShort) : `week of ${dayLabel(peak.start, utcDayShort)}`}`);
    const center = (peakIndex + .5) / model.count * 100;
    if (center > 65) flag.style.right = `${100 - center}%`;
    else flag.style.left = `${center}%`;
    plot.append(flag);
  }
  container.append(plot);
  container.append(buildAxis(model, plot.getBoundingClientRect().width || 800));
  placeSelection(periodBounds());
  rangeReadout();
  bindTape(plot, model, cursor);
  renderMonthly();
}

function bindTape(plot, model, cursor) {
  const indexAt = event => {
    const rect = plot.getBoundingClientRect();
    return clamp(Math.floor((event.clientX - rect.left) / rect.width * model.count), 0, model.count - 1);
  };
  const preview = (a, b) => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    placeSelection([model.first + low * model.size, model.first + (high + 1) * model.size - 1]);
  };
  const show = index => {
    const bucket = model.buckets[index];
    cursor.hidden = false;
    cursor.style.left = `${(index + .5) / model.count * 100}%`;
    const readout = clear('tape-readout');
    readout.append(document.createTextNode(`${bucketLabel(model, bucket)} `), el('span', '', `${compact.format(bucket.tokens)} tokens · ${number.format(bucket.n)} ${bucket.n === 1 ? 'session' : 'sessions'}`));
    return readout.textContent;
  };
  const rest = () => {
    cursor.hidden = true;
    rangeReadout();
  };
  let drag = null;
  let position = null;
  let anchor = null;
  plot.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    plot.setPointerCapture(event.pointerId);
    const index = indexAt(event);
    drag = { from: index, to: index };
    preview(index, index);
  });
  plot.addEventListener('pointermove', event => {
    const index = indexAt(event);
    show(index);
    if (!drag) return;
    drag.to = index;
    preview(drag.from, drag.to);
  });
  plot.addEventListener('pointerup', () => {
    if (!drag) return;
    const { from, to } = drag;
    drag = null;
    commitRange(from, to);
  });
  plot.addEventListener('pointercancel', () => {
    drag = null;
    placeSelection(periodBounds());
    rest();
  });
  plot.addEventListener('pointerleave', () => {
    if (!drag) rest();
  });
  plot.addEventListener('blur', () => {
    position = null;
    anchor = null;
    rest();
  });
  plot.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.period.key === 'all') return;
      event.preventDefault();
      anchor = null;
      state.period = { key: 'all' };
      render();
      $('tape-live').textContent = 'Range cleared. Showing all time.';
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step == null && event.key !== 'Home' && event.key !== 'End' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const previous = position;
    if (event.key === 'Home') position = 0;
    else if (event.key === 'End') position = model.count - 1;
    else if (step != null) position = clamp((position ?? (step < 0 ? model.count : -1)) + step, 0, model.count - 1);
    else position ??= model.count - 1;
    if (event.shiftKey || event.key === 'Enter' || event.key === ' ') {
      anchor ??= previous ?? position;
      commitRange(anchor, position);
    } else {
      anchor = null;
    }
    $('tape-live').textContent = show(position);
  });
}

function renderMonthly() {
  const container = clear('monthly-values');
  const months = perMonth(toolRecords().filter(record => /^\d{4}-(0[1-9]|1[0-2])$/.test(record.month)));
  if (!months.length) {
    empty(container, 'No monthly records for this tool.');
    return;
  }
  const table = makeTable(['Month (UTC)', 'Tokens', 'Sessions'], [1, 2]);
  for (const month of months) addRow(table, [monthDate.format(new Date(`${month.month}-01T00:00:00Z`)), number.format(month.tokensTotal), number.format(month.n)]);
  container.append(table.table);
}

function renderTools() {
  const container = clear('tools');
  const records = periodRecords();
  const groups = perTool(records);
  if (!groups.length) {
    empty(container, 'No token records in this period. Sources lists which tools were detected.', filtersActive() ? 'Show all time and all tools' : '', resetFilters);
    return;
  }
  const total = overall(records).tokensTotal;
  for (const group of groups) {
    const row = el('button', 'tool-row');
    row.type = 'button';
    row.setAttribute('aria-pressed', String(state.tool === group.tool));
    const head = el('span', 'tool-head');
    const name = el('span', 'name');
    name.append(toolSwatch(group.tool), document.createTextNode(toolName(group.tool)));
    head.append(name);
    if (state.tool === group.tool) head.append(el('span', 'state', 'Filter on'));
    head.append(el('strong', '', compact.format(group.tokensTotal)));
    const bar = el('span', 'bar');
    const fill = el('span', `fill ${textureClass(group.tool)}`);
    fill.style.width = `${total ? group.tokensTotal / total * 100 : 0}%`;
    bar.append(fill);
    const share = total ? (group.tokensTotal / total * 100).toFixed(1) : '0';
    row.append(head, bar, el('span', 'tool-meta', `${share}% of tokens · ${number.format(group.n)} ${group.n === 1 ? 'session' : 'sessions'} · ${compact.format(group.avg)} average`));
    row.setAttribute('aria-label', `${state.tool === group.tool ? 'Clear filter for' : 'Filter by'} ${toolName(group.tool)}: ${compact.format(group.tokensTotal)} tokens`);
    row.addEventListener('click', () => {
      state.tool = state.tool === group.tool ? 'all' : group.tool;
      state.page = 0;
      render();
    });
    container.append(row);
  }
}

function renderWeekday(records) {
  const container = clear('weekday');
  const totals = Array(7).fill(0);
  for (const record of records) if (validTs(record)) totals[(new Date(record.ts).getDay() + 6) % 7] += record.tokensTotal || 0;
  const sum = totals.reduce((a, b) => a + b, 0);
  const peak = Math.max(...totals);
  const top = peak ? totals.indexOf(peak) : -1;
  totals.forEach((value, index) => {
    const column = el('div', index === top ? 'wd top' : 'wd');
    column.title = `${weekdayLong[index]}: ${number.format(value)} tokens`;
    const track = el('div', 'wd-track');
    const bar = el('div', 'wd-bar');
    bar.style.height = `${peak ? value / peak * 100 : 0}%`;
    track.append(bar);
    column.append(track, el('span', 'wd-label', weekdays[index]));
    container.append(column);
  });
  $('weekday-note').textContent = sum ? `${weekdayLong[top]} carries ${(peak / sum * 100).toFixed(0)}% of the tokens, in your local time.` : 'No dated sessions in this selection.';
}

function renderProjects(records) {
  const container = clear('projects');
  const more = $('projects-more');
  const groups = perProject(records);
  more.hidden = groups.length <= projectLimit;
  more.textContent = state.allProjects ? `Show top ${projectLimit} only` : `Show all ${groups.length} projects`;
  if (!groups.length) {
    clear('projects-legend');
    empty(container, 'No projects in this selection.', filtersActive() ? 'Show all time and all tools' : '', resetFilters);
    return;
  }
  const total = overall(records).tokensTotal;
  const peak = groups[0].tokensTotal || 1;
  const legend = clear('projects-legend');
  for (const tool of new Set(groups.flatMap(group => Object.keys(group.byTool)))) {
    const item = el('li');
    item.append(textureSwatch(tool), document.createTextNode(toolName(tool)));
    legend.append(item);
  }
  const list = el('ol');
  groups.slice(0, state.allProjects ? groups.length : projectLimit).forEach((project, index) => {
    const row = el('li', 'proj-row');
    row.append(el('span', 'proj-rank', String(index + 1).padStart(2, '0')));
    const name = el('div', 'proj-name');
    const label = project.project || '(unknown project)';
    name.append(action(label.split('/').filter(Boolean).at(-1) || label, () => {
      state.project = project.project;
      state.page = 0;
      $('search').value = '';
      location.hash = 'sessions';
    }), el('span', 'path', label));
    const stack = el('div', 'stack');
    stack.setAttribute('role', 'img');
    const parts = Object.entries(project.byTool).sort((a, b) => b[1] - a[1]);
    stack.setAttribute('aria-label', parts.map(([tool, value]) => `${toolName(tool)} ${compact.format(value)}`).join(', '));
    for (const [tool, value] of parts) {
      const part = el('div', `part ${textureClass(tool)}`);
      part.style.width = `${value / peak * 100}%`;
      part.title = `${toolName(tool)}: ${number.format(value)} tokens`;
      stack.append(part);
    }
    row.append(name, stack, el('span', 'proj-tokens', compact.format(project.tokensTotal)), el('span', 'proj-share', `${total ? (project.tokensTotal / total * 100).toFixed(1) : 0}%`));
    list.append(row);
  });
  container.append(list);
}

function renderHeaviest(records) {
  const container = clear('heaviest');
  const items = topSessions(records.filter(record => record.tokensTotal > 0), 5);
  if (!items.length) {
    const item = el('li');
    empty(item, 'No sessions with token records in this selection.', filtersActive() ? 'Show all time and all tools' : '', resetFilters);
    container.append(item);
    return;
  }
  items.forEach((record, index) => {
    const item = el('li');
    const button = el('button', 'heavy-row');
    button.type = 'button';
    button.setAttribute('aria-label', `Open session ${record.title || 'Untitled session'}, ${compact.format(record.tokensTotal)} tokens`);
    const meta = el('span', 'heavy-meta');
    const tag = el('span', 'tag');
    tag.append(toolSwatch(record.tool), document.createTextNode(toolName(record.tool)));
    meta.append(tag, el('span', '', record.project || '(unknown project)'), el('span', '', dated(record.ts)));
    button.append(el('span', 'heavy-rank', String(index + 1).padStart(2, '0')), el('span', 'heavy-tokens', compact.format(record.tokensTotal)), el('span', 'heavy-title', record.title || 'Untitled session'), meta);
    button.addEventListener('click', () => openSession(record));
    item.append(button);
    container.append(item);
  });
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'Under a minute';
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function openSession(record) {
  $('session-title').textContent = record.title || 'Untitled session';
  const tool = clear('session-tool');
  tool.append(toolSwatch(record.tool), document.createTextNode(toolName(record.tool)));
  const total = clear('session-total');
  total.append(document.createTextNode(number.format(record.tokensTotal)), el('small', '', 'tokens'));
  const split = clear('session-split');
  tokenFields.forEach(([name, key], index) => {
    if (!record[key]) return;
    const segment = el('div', `seg t${index}`);
    segment.style.flex = `${record[key]} 1 0%`;
    segment.title = `${name}: ${number.format(record[key])} tokens`;
    split.append(segment);
  });
  const summary = overall([record]);
  const details = clear('session-details');
  const fields = [
    ['Project', record.project || '(unknown)'],
    ['Date', dated(record.ts)],
    ...(record.durationMs > 0 ? [['Duration', formatDuration(record.durationMs)]] : []),
    ['Model', record.model || 'Not recorded'],
    ['Session ID', record.sessionId || 'Not recorded'],
    ...tokenFields.map(([name, key], index) => [name, number.format(record[key] || 0), index]),
    ['API cost', `${costLabel(summary)} · ${costDescription(summary.costStatus)}`],
  ];
  for (const [name, value, tone] of fields) {
    const row = el('div');
    const term = el('dt');
    if (tone != null) term.append(el('span', `swatch seg t${tone}`));
    term.append(document.createTextNode(name));
    row.append(term, el('dd', '', value));
    details.append(row);
  }
  $('session-dialog').showModal();
  animateContent('dialog');
}

function renderSessions(records) {
  const query = $('search').value.trim().toLocaleLowerCase();
  const items = records.filter(record => (!state.project || record.project === state.project) && (!query || [record.title, record.project, record.model, toolName(record.tool)].some(value => String(value || '').toLocaleLowerCase().includes(query))));
  items.sort(state.sort === 'newest' ? (a, b) => (b.ts || 0) - (a.ts || 0) : (a, b) => b.tokensTotal - a.tokensTotal);
  state.page = Math.min(state.page, Math.max(0, Math.ceil(items.length / pageSize) - 1));
  const start = state.page * pageSize;
  const container = clear('session-list');
  $('project-filter').hidden = !state.project;
  $('selected-project').textContent = state.project || '';
  for (const button of document.querySelectorAll('[data-sort]')) button.setAttribute('aria-pressed', String(button.dataset.sort === state.sort));
  if (!items.length) {
    const anyFilter = query || state.project || filtersActive();
    empty(container, anyFilter ? 'No sessions match. Clear the search or widen the filters.' : 'No sessions were found. Sources shows which tools were detected.', anyFilter ? 'Clear search and filters' : '', () => {
      $('search').value = '';
      state.project = null;
      resetFilters();
    });
  } else {
    const peak = Math.max(...items.map(record => record.tokensTotal), 1);
    const target = makeTable(['Session', 'Tool', 'Date', 'Tokens', 'API cost'], [3, 4]);
    target.table.className = 'session-table';
    for (const record of items.slice(start, start + pageSize)) {
      const summary = overall([record]);
      const name = el('div', 'session-title-cell');
      name.append(
        action(record.title || 'Untitled session', () => openSession(record)),
        el('span', 'cell-detail', record.project || '(unknown project)'),
        el('span', 'mobile-session-meta', `${toolName(record.tool)} · ${dated(record.ts)} · ${costLabel(summary)}`),
      );
      const tag = el('span', 'tool-tag');
      tag.append(toolSwatch(record.tool), document.createTextNode(toolName(record.tool)));
      const tokens = el('div', 'token-cell');
      const mini = el('div', 'mini');
      const fill = el('span');
      fill.style.width = `${record.tokensTotal / peak * 100}%`;
      mini.append(fill);
      tokens.append(el('strong', '', compact.format(record.tokensTotal)), mini);
      const cost = el('span', '', costLabel(summary));
      cost.title = costDescription(summary.costStatus);
      addRow(target, [name, tag, dated(record.ts), tokens, cost]);
    }
    container.append(target.table);
  }
  $('session-range').textContent = items.length ? `${start + 1}–${Math.min(start + pageSize, items.length)} of ${number.format(items.length)} sessions` : '0 sessions';
  $('previous').disabled = state.page === 0;
  $('next').disabled = start + pageSize >= items.length;
}

function renderSources() {
  const container = clear('sources');
  const target = makeTable(['Tool', 'Availability', 'Data path', 'Token records']);
  target.table.className = 'sources-table';
  let detected = 0;
  for (const tool of state.data.detections) {
    if (tool.status === 'present') detected++;
    const path = el('span', 'source-path', tool.path || 'No local data found');
    const status = el('span', tool.status === 'present' ? 'status detected' : 'status', tool.status === 'present' ? 'Detected' : 'Not detected');
    const name = el('strong', '', tool.name);
    addRow(target, [name, status, path, tool.hasTokens ? 'Supported' : 'Presence only']);
  }
  container.append(target.table);
  $('source-count').textContent = `${detected}/${state.data.detections.length}`;
  const errors = clear('error-list');
  $('read-errors').hidden = !state.data.errors?.length;
  for (const error of state.data.errors || []) errors.append(el('li', '', String(error)));
}

function buildToolFilter() {
  const group = clear('tool-filter');
  const all = el('button', '', 'All tools');
  all.type = 'button';
  all.dataset.tool = 'all';
  group.append(all);
  for (const detection of state.data.detections.filter(item => item.hasTokens)) {
    const button = el('button');
    button.type = 'button';
    button.dataset.tool = detection.key;
    button.append(toolSwatch(detection.key), document.createTextNode(detection.name));
    group.append(button);
  }
}

function renderFilters(records) {
  for (const button of document.querySelectorAll('[data-period]')) {
    const key = button.dataset.period;
    button.setAttribute('aria-pressed', String(state.period.key === key));
    if (key === 'custom') button.hidden = state.period.key !== 'custom';
  }
  for (const button of $('tool-filter').children) button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
  $('scope').textContent = `${number.format(records.length)} ${records.length === 1 ? 'session' : 'sessions'} in view`;
}

function render(animate = true) {
  if (!state.data) return;
  finishAnimation();
  const records = selectedRecords();
  renderFilters(records);
  renderSummary(records);
  renderTape();
  renderTools();
  renderWeekday(records);
  renderProjects(records);
  renderHeaviest(records);
  renderSessions(records);
  if (animate) animateContent('data');
}

function showView(animate = true) {
  finishAnimation();
  const view = currentView();
  for (const link of document.querySelectorAll('.views a')) {
    if (link.hash === `#${view}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  for (const name of views) $(`${name}-view`).hidden = view !== name;
  $('filters').hidden = view === 'sources';
  document.title = `${({ overview: 'Usage overview', sessions: 'Sessions', sources: 'Local sources' })[view]} · AI Usage Analyzer`;
  if (state.data && view === 'sessions') renderSessions(selectedRecords());
  if (state.data && animate) animateContent('view');
}

function setMessage(text, { error = false, link, retry } = {}) {
  const node = clear('message');
  node.classList.toggle('error', error);
  if (!text) return;
  node.append(document.createTextNode(text));
  if (link) {
    const anchor = el('a', '', link[0]);
    anchor.href = link[1];
    node.append(anchor);
  }
  if (retry) node.append(action(retry, load));
}

async function load() {
  const initial = !state.data;
  $('refresh').disabled = true;
  $('refresh-label').textContent = 'Reading…';
  $('dashboard').setAttribute('aria-busy', 'true');
  if (initial) $('loading').hidden = false;
  else setMessage('Refreshing local usage records…');
  try {
    const response = await fetch('/api/usage');
    if (!response.ok) throw new Error('The analyzer could not read your local usage records.');
    const data = await response.json();
    data.tokenTools = data.detections.filter(item => item.hasTokens).map(item => item.key);
    state.data = data;
    if (state.tool !== 'all' && !data.tokenTools.includes(state.tool)) state.tool = 'all';
    state.tapeKey = '';
    buildToolFilter();
    $('loading').hidden = true;
    $('dashboard').hidden = false;
    setMessage('');
    if (data.errors?.length) setMessage(`${data.errors.length} read ${data.errors.length === 1 ? 'issue needs' : 'issues need'} attention. Totals may be incomplete.`, { link: ['View read issues', '#sources'] });
    $('updated').textContent = `Read at ${new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    renderSources();
    render(false);
    showView(false);
    animateContent(initial ? 'intro' : 'data');
  } catch (error) {
    $('loading').hidden = true;
    const reason = error instanceof TypeError ? 'The analyzer server did not respond.' : error.message;
    setMessage(`${reason} ${state.data ? 'Showing the previous snapshot. ' : ''}Check the terminal where it is running.`, { error: true, retry: 'Read again' });
  } finally {
    $('refresh').disabled = false;
    $('refresh-label').textContent = 'Refresh records';
    $('dashboard').setAttribute('aria-busy', 'false');
  }
}

const storedTheme = readTheme();
if (storedTheme) root.dataset.theme = storedTheme;
syncThemeButton();
$('theme').addEventListener('click', () => setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'));
$('refresh').addEventListener('click', load);
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  $('main').focus();
});
for (const button of document.querySelectorAll('[data-period]')) {
  button.addEventListener('click', () => {
    if (button.dataset.period === 'custom') return;
    state.period = { key: button.dataset.period };
    state.page = 0;
    render();
  });
}
$('tool-filter').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  state.tool = button.dataset.tool;
  state.page = 0;
  render();
});
$('tape-reset').addEventListener('click', () => {
  state.period = { key: 'all' };
  render();
});
$('projects-more').addEventListener('click', () => {
  state.allProjects = !state.allProjects;
  renderProjects(selectedRecords());
});
for (const button of document.querySelectorAll('[data-sort]')) {
  button.addEventListener('click', () => {
    state.sort = button.dataset.sort;
    state.page = 0;
    renderSessions(selectedRecords());
  });
}
$('search').addEventListener('input', () => { state.page = 0; renderSessions(selectedRecords()); });
$('clear-project').addEventListener('click', () => { state.project = null; state.page = 0; renderSessions(selectedRecords()); });
$('previous').addEventListener('click', () => { state.page--; renderSessions(selectedRecords()); });
$('next').addEventListener('click', () => { state.page++; renderSessions(selectedRecords()); });
$('close-dialog').addEventListener('click', () => { finishAnimation(); $('session-dialog').close(); });
$('session-dialog').addEventListener('cancel', finishAnimation);
$('session-dialog').addEventListener('click', event => {
  if (event.target === event.currentTarget) { finishAnimation(); event.currentTarget.close(); }
});
let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.data || $('dashboard').hidden || currentView() !== 'overview') return;
    renderTape();
    state.tapeFresh = false;
  }, 150);
});
addEventListener('hashchange', () => { showView(true); scrollTo(0, 0); });
showView(false);
load();
