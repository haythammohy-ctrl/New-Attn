import { test, eq } from './harness.js';
import {
  columnKind, csvSafe, dateKey, distinctValues, exportCell, exportFilename, isBlank, localIsoDate, normalize, numberOf,
  orderRows, viewIndexes,
} from '../js/lib/tablekit.js';

test('tablekit: blank cells are empty text or a dash', () => {
  for (const v of ['', '  ', '—', '-', null, undefined]) eq(isBlank(v), true, String(v));
  for (const v of ['0', 'a', '—x']) eq(isBlank(v), false, v);
  eq(normalize(' — '), '');
  eq(normalize('  Team   A '), 'Team A');
});

test('tablekit: numberOf reads money and counts but leaves codes with a leading zero alone', () => {
  eq(numberOf('15,000.00'), 15000);
  eq(numberOf('-250.5'), -250.5);
  eq(numberOf('0'), 0);
  eq(numberOf('0.5'), 0.5);
  eq(numberOf(12), 12);
  for (const v of ['0100123456', '007', 'DC000001', '1h 30m', '12/10/2026', '', '—', '5,000.00 EGP']) eq(numberOf(v), null, v);
});

test('tablekit: dates in the app (dd/mm/yyyy, with a weekday in front or not) and ISO dates sort by day', () => {
  eq(dateKey('الأحد 12/10/2026'), 202610120000);
  eq(dateKey('01/02/2027'), 202702010000);
  eq(dateKey('2026-10-12'), 202610120000);
  eq(dateKey('Team A'), null);
  eq(dateKey('08:00'), null);
});

test('tablekit: a time after the date counts, so entries of one day sort by the time', () => {
  eq(dateKey('12/10/2026 17:00'), 202610121700);
  eq(dateKey('12/10/2026 9:05'), 202610120905);
  eq(dateKey('2026-10-12 00:30'), 202610120030);
  eq(columnKind(['12/10/2026 17:00', '12/10/2026 09:00']), 'date');
  eq(orderRows(['27/10/2026 15:00', '26/10/2026 23:00', '27/10/2026 09:15'], 'date', 'asc', [0, 1, 2]), [1, 2, 0]);
  eq(orderRows(['27/10/2026 15:00', '26/10/2026 23:00', '27/10/2026 09:15'], 'date', 'desc', [0, 1, 2]), [0, 2, 1]);
});

test('tablekit: the filter list is ordered by what the rows sort by, not by the text shown', () => {
  const texts = ['2h 0m', '30m', '1h 30m', '45m', '30m', '—'];
  const minutes = [120, 30, 90, 45, 30, 0];
  eq(distinctValues(texts, 'number', minutes).map((v) => v.value), ['30m', '45m', '1h 30m', '2h 0m', '']);
  eq(distinctValues(texts, 'number', minutes).find((v) => v.value === '30m').count, 2);
  eq(distinctValues(['B', 'A'], 'text').map((v) => v.value), ['A', 'B']);                 // no sort values: the text itself
});

test('tablekit: cells that Excel would run as a formula get a quote in front, numbers are left alone', () => {
  eq(csvSafe('=HYPERLINK("http://evil/","click")'), '\'=HYPERLINK("http://evil/","click")');
  eq(csvSafe('+cmd|\' /C calc\'!A0'), '\'+cmd|\' /C calc\'!A0');
  eq(csvSafe('-1+1'), '\'-1+1');
  eq(csvSafe('@SUM(1+1)'), '\'@SUM(1+1)');
  eq(csvSafe('\t=1'), '\'\t=1');
  eq(csvSafe('Sara Ahmed Ali'), 'Sara Ahmed Ali');
  eq(csvSafe('a=b'), 'a=b');
  eq(csvSafe(-250.5), -250.5);
  eq(csvSafe(0), 0);
  eq(csvSafe(null), '');
  eq(csvSafe(undefined), '');
});

test('tablekit: the file date is the local day, not the UTC day', () => {
  eq(localIsoDate(new Date(2026, 9, 27, 0, 30)), '2026-10-27');   // half past midnight, whatever the time zone
  eq(localIsoDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('tablekit: a column is numbers, dates or text by what its filled cells hold', () => {
  eq(columnKind(['1', '2,500.00', '—', '']), 'number');
  eq(columnKind(['12/10/2026', 'الاثنين 13/10/2026', '—']), 'date');
  eq(columnKind(['12', 'Team A']), 'text');
  eq(columnKind(['0100123', '0100124']), 'text');       // phone numbers
  eq(columnKind(['—', '']), 'text');
  eq(columnKind([]), 'text');
});

test('tablekit: sorting numbers numerically, dates by day, text naturally, blanks always last', () => {
  const idx = [0, 1, 2, 3, 4];
  eq(orderRows(['10', '9', '—', '1,000', '2'], 'number', 'asc', idx), [4, 1, 0, 3, 2]);
  eq(orderRows(['10', '9', '—', '1,000', '2'], 'number', 'desc', idx), [3, 0, 1, 4, 2]);
  eq(orderRows(['02/01/2027', '30/12/2026', '', '15/01/2027', '01/01/2027'], 'date', 'asc', idx), [1, 4, 0, 3, 2]);
  eq(orderRows(['02/01/2027', '30/12/2026', '', '15/01/2027', '01/01/2027'], 'date', 'desc', idx), [3, 0, 4, 1, 2]);
  eq(orderRows(['Team 10', 'Team 2', '—', 'Team 1', 'team 3'], 'text', 'asc', idx), [3, 1, 4, 0, 2]);
  eq(orderRows(['b', 'a', 'a'], 'text', 'asc', [0, 1, 2]), [1, 2, 0]);        // ties keep their order
  eq(orderRows(['ياسمين', 'أحمد', 'منى'], 'text', 'asc', [0, 1, 2]), [1, 2, 0]);
  eq(orderRows(['10', '9'], 'number', 'asc', [0]), [0]);                     // only the rows given
});

test('tablekit: the filter list holds each value once with its count, in the column order, blanks as one empty value', () => {
  eq(distinctValues(['B', 'A', 'B', '—', ''], 'text'), [{ value: 'A', count: 1 }, { value: 'B', count: 2 }, { value: '', count: 2 }]);
  eq(distinctValues(['10', '9', '10'], 'number'), [{ value: '9', count: 1 }, { value: '10', count: 2 }]);
});

test('tablekit: filters narrow the rows (all columns must agree) and sorting orders what is left', () => {
  const cols = [
    { texts: ['Sara', 'Omar', 'Mona', 'Ali'], sortVals: ['Sara', 'Omar', 'Mona', 'Ali'], kind: 'text' },
    { texts: ['Team A', 'Team B', 'Team A', '—'], sortVals: ['Team A', 'Team B', 'Team A', '—'], kind: 'text' },
    { texts: ['6,000.00', '8,000.00', '7,500.00', '5,000.00'], sortVals: [6000, 8000, 7500, 5000], kind: 'number' },
  ];
  eq(viewIndexes(cols, 4), [0, 1, 2, 3]);
  eq(viewIndexes(cols, 4, { filters: { 1: new Set(['Team A']) } }), [0, 2]);
  eq(viewIndexes(cols, 4, { filters: { 1: new Set(['Team A', '']) } }), [0, 2, 3]);          // blank is a value too
  eq(viewIndexes(cols, 4, { filters: { 1: new Set(['Team A']), 0: new Set(['Mona']) } }), [2]);
  eq(viewIndexes(cols, 4, { filters: { 0: new Set() } }), []);                                // nothing allowed
  eq(viewIndexes(cols, 4, { filters: { 1: new Set(['Team A', 'Team B']) }, sort: { col: 2, dir: 'desc' } }), [1, 2, 0]);
  eq(viewIndexes(cols, 4, { sort: { col: 0, dir: 'asc' } }), [3, 2, 1, 0]);
  eq(viewIndexes(cols, 4, { filters: { 1: undefined } }), [0, 1, 2, 3]);                     // no filter on that column
});

test('tablekit: CSV cells are numbers for numeric columns, empty for blanks, plain text otherwise', () => {
  eq(exportCell('number', '15,000.00'), 15000);
  eq(exportCell('number', '—'), '');
  eq(exportCell('text', '  Team   A '), 'Team A');
  eq(exportCell('text', '0100123456'), '0100123456');
  eq(exportCell('date', 'الأحد 12/10/2026'), 'الأحد 12/10/2026');
});

test('tablekit: file names are safe and dated', () => {
  eq(exportFilename('payroll 2026-10', '2026-10-27'), 'payroll-2026-10-2026-10-27.csv');
  eq(exportFilename('employees / Deleted: (2)', '2026-10-27'), 'employees-Deleted-(2)-2026-10-27.csv');
  eq(exportFilename('', '2026-10-27'), 'export-2026-10-27.csv');
  eq(exportFilename('الموظفون', '2026-10-27'), 'الموظفون-2026-10-27.csv');
});
