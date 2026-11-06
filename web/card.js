import { dayNumber } from './dates.js';

export const CARD_FORMATS = [
  { key: 'link', label: 'Link preview', ratio: '1.91:1', w: 1200, h: 630, pad: 64, stacked: false, headY: 74, headSize: 20, numSize: 190, numY: 270, nameSize: 40, subSize: 28, personaY: 330, personaSize: 34, personaSubSize: 20, mixY: 362, tapeTop: 390, tapeH: 74, figCols: 4, figY: 530, figRow: 0, figSize: 44, figLabelSize: 15, footY: 606, footSize: 15 },
  { key: 'portrait', label: 'Portrait', ratio: '4:5', w: 1080, h: 1350, pad: 72, stacked: true, headY: 110, headSize: 24, numSize: 300, numY: 420, nameSize: 56, subSize: 30, personaY: 680, personaSize: 48, personaSubSize: 26, mixY: 770, tapeTop: 830, tapeH: 200, figCols: 2, figY: 1130, figRow: 100, figSize: 56, figLabelSize: 17, footY: 1306, footSize: 20 },
  { key: 'story', label: 'Story', ratio: '9:16', w: 1080, h: 1920, pad: 72, stacked: true, headY: 230, headSize: 26, numSize: 360, numY: 560, nameSize: 64, subSize: 34, personaY: 860, personaSize: 56, personaSubSize: 30, mixY: 960, tapeTop: 1050, tapeH: 280, figCols: 2, figY: 1450, figRow: 118, figSize: 64, figLabelSize: 19, footY: 1664, footSize: 24 },
];

const BRAND = { cli: 'npx ai-usage-analyzer', repo: 'github.com/adetxt/ai-usage-analyzer' };

const PERSONAS = [
  ['night', 'Night owl', 'Most sessions start after dark.'],
  ['morning', 'Early shipper', 'Most sessions start before noon.'],
  ['afternoon', 'Daytime builder', 'Most sessions start in the afternoon.'],
  ['evening', 'Evening grinder', 'Most sessions start after work hours.'],
];

function bucket(hour) {
  if (hour >= 22 || hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function persona(times) {
  if (!times.length) return null;
  const weekend = times.filter(ts => [0, 6].includes(new Date(ts).getDay())).length / times.length;
  if (weekend >= 0.35) return ['Weekend warrior', 'A third of the work lands on weekends.'];
  const counts = {};
  for (const ts of times) {
    const key = bucket(new Date(ts).getHours());
    counts[key] = (counts[key] || 0) + 1;
  }
  const [key] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const [, name, line] = PERSONAS.find(entry => entry[0] === key);
  return [name, line];
}

export function cardStats(records) {
  const dated = records.filter(record => Number.isFinite(record.ts));
  const days = new Map();
  for (const record of dated) {
    const day = dayNumber(record.ts);
    days.set(day, (days.get(day) || 0) + (record.tokensTotal || 0));
  }
  const sorted = [...days.keys()].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  sorted.forEach((day, index) => {
    run = index && day === sorted[index - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  const busiest = [...days].reduce((best, entry) => !best || entry[1] > best[1] ? entry : best, null);
  const tools = {};
  for (const record of records) tools[record.tool] = (tools[record.tool] || 0) + (record.tokensTotal || 0);
  const tokens = Object.values(tools).reduce((a, b) => a + b, 0);
  return {
    sessions: records.length,
    projects: new Set(records.map(record => record.project)).size,
    tokens,
    activeDays: days.size,
    longestStreak: longest,
    busiest: busiest ? { day: busiest[0], tokens: busiest[1] } : null,
    tape: sorted.length ? { from: sorted[0], to: sorted.at(-1), days } : null,
    tools: Object.entries(tools).filter(entry => entry[1] > 0).sort((a, b) => b[1] - a[1]),
    persona: persona(dated.map(record => record.ts)),
  };
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');
const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function cardSummary(stats, rangeLabel) {
  if (!stats.sessions) return 'No sessions in this selection.';
  const parts = [
    `${whole.format(stats.sessions)} AI coding sessions`,
    `${whole.format(stats.projects)} projects`,
    `${whole.format(stats.activeDays)} active days`,
    `longest streak ${whole.format(stats.longestStreak)} days`,
    `${compact.format(stats.tokens)} tokens`,
  ];
  return `${parts.join(', ')}. ${rangeLabel}.${stats.persona ? ` ${stats.persona[0]}.` : ''}`;
}

function colors() {
  const style = getComputedStyle(document.documentElement);
  const read = name => style.getPropertyValue(name).trim();
  return { paper: read('--paper'), ink: read('--ink'), ink2: read('--ink-2'), ink3: read('--ink-3'), rule: read('--rule'), accent: read('--accent') };
}

function text(ctx, value, x, y, { size, weight = 700, color, align = 'left', track = 0 }) {
  ctx.font = `${weight} ${size}px Manrope, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.letterSpacing = `${track}px`;
  ctx.fillText(value, x, y);
}

function fit(ctx, value, maxWidth) {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function dots(ctx, c, w, h) {
  const gap = Math.round(w / 52);
  ctx.fillStyle = c.rule;
  ctx.globalAlpha = .75;
  for (let y = gap; y < h; y += gap) {
    for (let x = gap; x < w; x += gap) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export async function drawCard(canvas, stats, { format, rangeLabel, toolLabel, toolName }) {
  await document.fonts.load('800 100px Manrope');
  await document.fonts.load('600 20px Manrope');
  const L = format;
  const scale = 2;
  canvas.width = L.w * scale;
  canvas.height = L.h * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const c = colors();
  const { pad } = L;
  const right = L.w - pad;

  ctx.fillStyle = c.paper;
  ctx.fillRect(0, 0, L.w, L.h);
  dots(ctx, c, L.w, L.h);
  ctx.fillStyle = c.ink;
  ctx.fillRect(0, 0, L.w, 10);

  text(ctx, 'AI USAGE', pad, L.headY, { size: L.headSize, weight: 800, color: c.ink, track: 3 });
  text(ctx, 'ANALYZER', pad + ctx.measureText('AI USAGE').width + 12, L.headY, { size: L.headSize, weight: 400, color: c.ink2, track: 3 });
  const scope = [rangeLabel, toolLabel].filter(Boolean).join(' · ');
  ctx.font = `600 ${L.headSize}px Manrope, sans-serif`;
  text(ctx, fit(ctx, scope, L.w * .52), right, L.headY, { size: L.headSize, weight: 600, color: c.ink2, align: 'right' });

  if (!stats.sessions) {
    text(ctx, 'No sessions yet.', pad, L.h / 2, { size: L.numSize / 2.6, weight: 800, color: c.ink, track: -2 });
    return;
  }

  const count = whole.format(stats.sessions);
  const noun = stats.sessions === 1 ? 'session shipped' : 'sessions shipped';
  const across = `across ${whole.format(stats.projects)} ${stats.projects === 1 ? 'project' : 'projects'}`;
  text(ctx, count, pad - L.numSize / 48, L.numY, { size: L.numSize, weight: 800, color: c.accent, track: -L.numSize / 24 });
  if (L.stacked) {
    text(ctx, noun, pad, L.numY + L.nameSize * 1.5, { size: L.nameSize, weight: 800, color: c.ink, track: -1 });
    text(ctx, across, pad, L.numY + L.nameSize * 1.5 + L.subSize * 1.5, { size: L.subSize, weight: 600, color: c.ink2 });
  } else {
    ctx.font = `800 ${L.numSize}px Manrope, sans-serif`;
    ctx.letterSpacing = `${-L.numSize / 24}px`;
    const x = pad + ctx.measureText(count).width + 18;
    text(ctx, noun, x, L.numY, { size: L.nameSize, weight: 800, color: c.ink, track: -1 });
    text(ctx, across, x, L.numY - 52, { size: L.subSize, weight: 600, color: c.ink2 });
  }

  if (stats.persona) {
    text(ctx, stats.persona[0], pad, L.personaY, { size: L.personaSize, weight: 800, color: c.ink, track: -.5 });
    text(ctx, stats.persona[1], pad, L.personaY + L.personaSize * .95, { size: L.personaSubSize, weight: 600, color: c.ink2 });
  }

  const total = stats.tools.reduce((sum, entry) => sum + entry[1], 0) || 1;
  const shares = stats.tools.slice(0, 3).map(([name, value]) => `${toolName(name)} ${Math.round(value / total * 100)}%`);
  const mixWidth = L.stacked ? L.w - pad * 2 : 520;
  ctx.font = `600 ${L.personaSubSize}px Manrope, sans-serif`;
  while (shares.length > 1 && ctx.measureText(shares.join('  ·  ')).width > mixWidth) shares.pop();
  text(ctx, fit(ctx, shares.join('  ·  '), mixWidth), L.stacked ? pad : right, L.mixY, { size: L.personaSubSize, weight: 600, color: c.ink2, align: L.stacked ? 'left' : 'right' });

  const tape = stats.tape;
  const tapeWidth = L.w - pad * 2;
  const span = tape.to - tape.from + 1;
  const columns = Math.min(span, 120);
  const slot = tapeWidth / columns;
  const bars = new Array(columns).fill(0);
  for (const [day, value] of tape.days) {
    bars[Math.min(columns - 1, Math.floor((day - tape.from) / span * columns))] += value;
  }
  const columnPeak = Math.max(...bars, 1);
  bars.forEach((value, index) => {
    const height = value ? Math.max(6, value / columnPeak * L.tapeH) : 2;
    ctx.fillStyle = value && value === columnPeak ? c.accent : value ? c.ink : c.rule;
    ctx.fillRect(pad + index * slot + slot * .2, L.tapeTop + L.tapeH - height, Math.max(1.5, slot * .6), height);
  });
  ctx.fillStyle = c.ink;
  ctx.fillRect(pad, L.tapeTop + L.tapeH + 6, tapeWidth, 2);

  const figures = [
    [whole.format(stats.activeDays), 'active days'],
    [whole.format(stats.longestStreak), 'day streak'],
    [compact.format(stats.tokens), 'tokens'],
    [stats.busiest ? dayFormat.format(stats.busiest.day * 86400000) : '–', 'busiest day'],
  ];
  const cell = tapeWidth / L.figCols;
  figures.forEach(([value, label], index) => {
    const x = pad + index % L.figCols * cell;
    const y = L.figY + Math.floor(index / L.figCols) * L.figRow;
    text(ctx, value, x, y, { size: L.figSize, weight: 800, color: c.ink, track: -1.5 });
    text(ctx, label.toUpperCase(), x, y + L.figLabelSize * 2, { size: L.figLabelSize, weight: 700, color: c.ink2, track: 1.5 });
  });

  text(ctx, BRAND.cli, pad, L.footY, { size: L.footSize, weight: 700, color: c.ink, track: .3 });
  text(ctx, BRAND.repo, right, L.footY, { size: L.footSize, weight: 600, color: c.ink2, align: 'right', track: .3 });
}

export function cardBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not render the card.')), 'image/png'));
}
