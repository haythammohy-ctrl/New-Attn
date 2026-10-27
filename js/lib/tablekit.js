// What the header menus of every table need, kept free of the DOM so it can be tested: telling numbers and dates
// from text, sorting, filtering by the values of a column, and the rows of the CSV export.

export const cleanText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Empty cells show as a dash.
export const isBlank = (v) => v == null || /^(—|–|-)?$/.test(cleanText(v));

// The value a filter menu groups by: blank cells all count as one "empty" value.
export const normalize = (v) => (isBlank(v) ? '' : cleanText(v));

// "15,000.00" -> 15000. Text with a leading zero ("0100123", "007") is a code, not a number, and stays text.
export function numberOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = cleanText(v).replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s) || /^-?0\d/.test(s)) return null;
  return Number(s);
}

// "الأحد 12/10/2026" or "2026-10-12" -> 202610120000, so dates sort by day and not by the digits of the day first.
// A time after the date counts too ("12/10/2026 17:00" -> 202610121700), so two entries of one day sort by the time.
export function dateKey(v) {
  const s = cleanText(v);
  const dmy = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  const iso = dmy ? null : /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const found = dmy || iso;
  if (!found) return null;
  const day = dmy ? Number(`${dmy[3]}${dmy[2]}${dmy[1]}`) : Number(`${iso[1]}${iso[2]}${iso[3]}`);
  const time = /(\d{1,2}):(\d{2})/.exec(s.slice(found.index + found[0].length));
  return day * 10000 + (time ? Number(time[1]) * 100 + Number(time[2]) : 0);
}

// 'number' when every filled cell is a number, 'date' when every filled cell holds a date, otherwise 'text'.
export function columnKind(values) {
  const filled = values.filter((v) => !isBlank(v));
  if (!filled.length) return 'text';
  if (filled.every((v) => numberOf(v) !== null)) return 'number';
  if (filled.every((v) => dateKey(v) !== null)) return 'date';
  return 'text';
}

const sortKey = (kind, v) => (kind === 'number' ? numberOf(v) : kind === 'date' ? dateKey(v) : cleanText(v));
const collator = new Intl.Collator(['ar', 'en'], { numeric: true, sensitivity: 'base' });

// The given row numbers, in order. Empty cells always come last, ascending or descending; ties keep their order.
export function orderRows(sortVals, kind, dir, indexes) {
  const sign = dir === 'desc' ? -1 : 1;
  const keyed = indexes.map((i) => ({ i, blank: isBlank(sortVals[i]), key: sortKey(kind, sortVals[i]) }));
  keyed.sort((a, b) => {
    if (a.blank !== b.blank) return a.blank ? 1 : -1;
    if (a.blank) return a.i - b.i;
    const c = kind === 'text' ? collator.compare(a.key, b.key) : a.key - b.key;
    return c ? c * sign : a.i - b.i;
  });
  return keyed.map((k) => k.i);
}

// The values in a column for its filter list, each with how many rows have it, in the column's own order. `sortVals`
// are what the rows sort by when that is not the text shown (minutes behind "1h 30m"); the first row of each value
// decides where the value goes.
export function distinctValues(texts, kind, sortVals = texts) {
  const groups = new Map();
  texts.forEach((t, i) => {
    const v = normalize(t);
    const g = groups.get(v);
    if (g) g.count += 1; else groups.set(v, { count: 1, sortVal: sortVals[i] });
  });
  const values = [...groups.keys()];
  const keys = values.map((v) => (v === '' ? '' : groups.get(v).sortVal));
  const order = orderRows(keys, kind, 'asc', values.map((_, i) => i));
  return order.map((i) => ({ value: values[i], count: groups.get(values[i]).count }));
}

// Which rows to show and in what order.
//   cols:  [{ texts: [cell text per row], sortVals: [value to sort by per row], kind }]
//   state: { filters: { [column]: Set of allowed values }, sort: { col, dir } | null }
export function viewIndexes(cols, rowCount, { filters = {}, sort = null } = {}) {
  const active = Object.entries(filters).filter(([, allowed]) => allowed);
  let idx = [];
  for (let i = 0; i < rowCount; i += 1) {
    if (active.every(([ci, allowed]) => allowed.has(normalize(cols[ci].texts[i])))) idx.push(i);
  }
  if (sort && cols[sort.col]) idx = orderRows(cols[sort.col].sortVals, cols[sort.col].kind, sort.dir, idx);
  return idx;
}

// What goes in a CSV cell: numbers as numbers (so Excel can add them up), empty cells as empty.
export function exportCell(kind, text) {
  if (isBlank(text)) return '';
  if (kind === 'number') return numberOf(text);
  return cleanText(text);
}

// Excel and Google Sheets run a cell that starts with = + - @ (or a tab or return) as a formula, and people can type
// anything in a name or a note. A quote in front keeps the cell as text. Real numbers (-250) are left alone.
export function csvSafe(v) {
  if (typeof v !== 'string') return v == null ? '' : v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

// Today's date as the person using the app sees it (not the UTC date, which is a day behind after midnight in Cairo).
export function localIsoDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "payroll 2026-10" -> "payroll-2026-10-2026-10-27.csv"
export function exportFilename(base, isoDate) {
  const slug = cleanText(base).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
  return `${slug}-${isoDate}.csv`;
}
