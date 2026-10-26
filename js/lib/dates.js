// Date helpers. Dates travel as 'YYYY-MM-DD' strings and months as 'YYYY-MM'
// so timezone shifts can never move a record to another day.

export const pad = (n) => String(n).padStart(2, '0');

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 0 = Sunday ... 6 = Saturday
export function weekday(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(a, b) {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

// The Sunday on or before `iso`: weeks run Sunday to Saturday.
export const weekStart = (iso) => addDays(iso, -weekday(iso));

export function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return { from: toISO(y, m, 1), to: toISO(y, m, daysInMonth(y, m)) };
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

function partsIn(tz, date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}

export function todayIn(tz, now = new Date()) {
  const p = partsIn(tz, now);
  return toISO(p.y, p.m, p.d);
}

export function minutesOfDay(tz, now = new Date()) {
  const p = partsIn(tz, now);
  return p.hh * 60 + p.mm;
}

// 'HH:MM' or 'HH:MM:SS' -> minutes since midnight
export function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function formatTime(iso, tz) {
  if (!iso) return '';
  const p = partsIn(tz, new Date(iso));
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

// Wall-clock time in `tz` -> UTC ISO string.
export function zonedTimeToISO(dateISO, hhmm, tz) {
  const { y, m, d } = parseISO(dateISO);
  const [hh, mm] = hhmm.split(':').map(Number);
  const asUTC = Date.UTC(y, m - 1, d, hh, mm);
  let guess = asUTC;
  // Two passes settle the offset even across a DST change.
  for (let i = 0; i < 2; i++) {
    const p = partsIn(tz, new Date(guess));
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += asUTC - seen;
  }
  return new Date(guess).toISOString();
}

export const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
