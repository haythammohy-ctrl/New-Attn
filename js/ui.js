// Small DOM toolkit: no framework, no innerHTML, so user text can never become markup.
import { errorText } from './api/errors.js';
import { getLang } from './lib/i18n.js';
import {
  cleanText, columnKind, csvSafe, distinctValues, exportCell, exportFilename, localIsoDate, viewIndexes,
} from './lib/tablekit.js';

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') value = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  if (value !== undefined) el.value = value;   // after children, so <select> options exist
  return el;
}

export const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export const hoursText = (min) => {
  const m = Math.round(min || 0);
  const isAr = getLang() === 'ar';
  return m >= 60
    ? (isAr ? `${Math.floor(m / 60)}س ${m % 60}د` : `${Math.floor(m / 60)}h ${m % 60}m`)
    : (isAr ? `${m}د` : `${m}m`);
};

export function toast(message, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div', { id: 'toasts' });
    document.body.append(box);
  }
  const el = h('div', { class: `toast ${kind}` }, message);
  box.append(el);
  setTimeout(() => el.remove(), 4000);
}

// Runs fn with the button disabled; any error becomes a red toast.
export async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(errorText(err), 'err');
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

export function btn(label, onClick, kind = '', props = {}) {
  const el = h('button', { type: 'button', class: `btn ${kind}`, ...props }, label);
  if (onClick) el.addEventListener('click', () => busy(el, () => onClick(el)));
  return el;
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint && h('small', { class: 'muted' }, hint));
}

export function select(options, value, props = {}) {
  return h('select', { value, ...props }, options.map((o) => h('option', { value: o.value }, o.label)));
}

export function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}` }, text);
}

// The menu that is open right now (only one at a time, across all tables), and the arrow button it belongs to.
let closeOpenMenu = null;
let openMenuTrigger = null;

// The filters and sort of each table, kept while the page redraws (after an edit, or on every key typed in a search
// box) and forgotten when you go to another page.
const tableStates = new Map();
window.addEventListener('hashchange', () => tableStates.clear());

// A table whose headers work like Excel's: a small arrow on every titled column opens a menu to sort it and to pick
// which of its values to show. A toolbar above it exports what is on screen (after filtering and sorting) as a CSV.
//   columns: [{ label, render(row), class?, value?(row), exportLabel? }]
//     value:       what to sort and export by when the shown text is not it (a number behind "1h 30m", an ISO date...)
//     exportLabel: the column's title in the exported file, when it needs more than the header (a unit)
//   opts: { name?: file name of the export, exportable?: false to leave the export button out }
export function dataTable(columns, rows, empty = getLang() === 'ar' ? 'لا توجد بيانات.' : 'No data available.', opts = {}) {
  if (!rows.length) return h('p', { class: 'empty' }, empty);
  const isAr = getLang() === 'ar';
  const L = isAr
    ? {
      asc: { text: 'ترتيب من أ إلى ي', number: 'ترتيب من الأصغر إلى الأكبر', date: 'ترتيب من الأقدم إلى الأحدث' },
      desc: { text: 'ترتيب من ي إلى أ', number: 'ترتيب من الأكبر إلى الأصغر', date: 'ترتيب من الأحدث إلى الأقدم' },
      clearSort: 'مسح الترتيب', search: 'بحث في القيم...', all: 'تحديد الكل', blank: '(فارغ)', ok: 'موافق', cancel: 'إلغاء',
      clearFilter: 'مسح الفلتر', menu: 'قائمة العمود', export: 'تصدير Excel', clearAll: 'مسح الفلاتر والترتيب',
      rows: (shown, total) => (shown === total ? `${total} صف` : `${shown} من ${total} صف`), noMatch: 'لا توجد صفوف تطابق الفلتر.',
    }
    : {
      asc: { text: 'Sort A to Z', number: 'Sort smallest to largest', date: 'Sort oldest to newest' },
      desc: { text: 'Sort Z to A', number: 'Sort largest to smallest', date: 'Sort newest to oldest' },
      clearSort: 'Clear sort', search: 'Search values...', all: 'Select all', blank: '(Blanks)', ok: 'OK', cancel: 'Cancel',
      clearFilter: 'Clear filter', menu: 'Column menu', export: 'Export Excel', clearAll: 'Clear filters and sort',
      rows: (shown, total) => (shown === total ? `${total} rows` : `${shown} of ${total} rows`), noMatch: 'No rows match the filter.',
    };

  // Every cell is drawn once; filtering and sorting only hide and reorder these rows.
  const trs = rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.class || '' }, c.render(r)))));
  const cols = columns.map((c, ci) => {
    const texts = trs.map((tr) => cleanText(tr.children[ci].textContent));
    const sortVals = c.value ? rows.map((r) => c.value(r)) : texts;
    return { texts, sortVals, kind: c.label ? columnKind(sortVals) : 'text' };
  });
  const stateKey = `${location.hash}|${columns.map((c) => c.label).join('|')}`;
  const state = tableStates.get(stateKey) || { filters: {}, sort: null };
  tableStates.set(stateKey, state);

  const triggers = columns.map((c, ci) => (c.label
    ? h('button', {
      type: 'button', class: 'th-menu', 'aria-label': `${L.menu}: ${c.label}`,
      onClick: (e) => {
        e.stopPropagation();
        if (openMenuTrigger === e.currentTarget && closeOpenMenu) { closeOpenMenu(true); return; }   // the arrow of an open menu closes it
        openMenu(ci, e.currentTarget);
      },
    }, '▾')
    : null));
  const tbody = h('tbody', {}, trs);
  const noMatch = h('p', { class: 'empty' }, L.noMatch);
  const count = h('small', { class: 'muted' });
  const clearAll = btn(L.clearAll, () => { state.filters = {}; state.sort = null; apply(); }, 'small ghost');
  const exportBtn = btn(L.export, () => exportCSV(), 'small');
  const wrap = h('div', { class: 'data-table' },
    h('div', { class: 'table-tools' }, count, clearAll, opts.exportable === false ? null : exportBtn),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c, ci) => (c.label
        ? h('th', {}, h('span', { class: 'th-label' }, c.label), triggers[ci])
        : h('th', {}))))),
      tbody)),
    noMatch);

  function apply() {
    const idx = viewIndexes(cols, rows.length, state);
    const keep = new Set(idx);
    trs.forEach((tr, i) => { tr.hidden = !keep.has(i); });
    tbody.replaceChildren(...idx.map((i) => trs[i]), ...trs.filter((_, i) => !keep.has(i)));
    noMatch.hidden = idx.length > 0;
    count.textContent = L.rows(idx.length, rows.length);
    const touched = Object.values(state.filters).some(Boolean) || Boolean(state.sort);
    clearAll.hidden = !touched;
    triggers.forEach((t, ci) => {
      if (!t) return;
      const sorted = state.sort?.col === ci ? state.sort.dir : null;
      t.className = `th-menu${state.filters[ci] ? ' on' : ''}${sorted ? ' sorted' : ''}`;
      t.textContent = sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '▾';
    });
    return idx;
  }

  function exportCSV() {
    const idx = viewIndexes(cols, rows.length, state);
    const titled = columns.map((c, ci) => ({ c, ci })).filter(({ c }) => c.label);
    const cell = ({ c, ci }, i) => {
      if (!c.value) return exportCell(cols[ci].kind, cols[ci].texts[i]);
      const v = c.value(rows[i]);
      return v == null ? '' : v;
    };
    const route = location.hash.replace(/^#\//, '').split('?')[0];
    const title = wrap.closest('.card')?.querySelector('h3')?.textContent.replace(/\s*\(\d+\)\s*$/, '');   // "Deleted (3)" -> "Deleted"
    const name = opts.name || [route, title].filter(Boolean).join(' ');
    downloadCSV(exportFilename(name, localIsoDate()), [
      titled.map(({ c }) => c.exportLabel || c.label),
      ...idx.map((i) => titled.map((t) => cell(t, i))),
    ]);
  }

  function openMenu(ci, trigger) {
    closeOpenMenu?.();
    const col = cols[ci];
    const values = distinctValues(col.texts, col.kind, col.sortVals);
    const chosen = new Set(state.filters[ci] ? [...state.filters[ci]] : values.map((v) => v.value));
    const label = (v) => v || L.blank;
    const matches = (v) => {
      const q = search.value.trim().toLowerCase();
      return !q || label(v.value).toLowerCase().includes(q);
    };

    const sortItem = (dir) => h('button', {
      type: 'button', class: `menu-item${state.sort?.col === ci && state.sort.dir === dir ? ' on' : ''}`,
      onClick: () => { state.sort = { col: ci, dir }; close(true); apply(); },
    }, (dir === 'asc' ? '▲ ' : '▼ ') + L[dir][col.kind]);
    const search = h('input', { type: 'search', placeholder: L.search, 'aria-label': L.search });
    const list = h('div', { class: 'menu-list' });
    const allBox = h('input', { type: 'checkbox' });
    const okBtn = btn(L.ok, () => {
      if (chosen.size === values.length) delete state.filters[ci]; else state.filters[ci] = new Set(chosen);
      close(true);
      apply();
    }, 'small primary');

    // The select-all box and the OK button follow the ticks. Ticking a value must not redraw the list (that would
    // drop the keyboard focus), so only typing in the search box or the select-all box redraws it.
    function syncControls() {
      const visible = values.filter(matches);
      allBox.checked = visible.length > 0 && visible.every((v) => chosen.has(v.value));
      okBtn.disabled = chosen.size === 0;
    }
    function paintList() {
      list.replaceChildren(...values.filter(matches).map((v) => h('label', { class: 'menu-check' },
        h('input', {
          type: 'checkbox', checked: chosen.has(v.value),
          onChange: (e) => { if (e.target.checked) chosen.add(v.value); else chosen.delete(v.value); syncControls(); },
        }),
        h('span', {}, label(v.value)), h('small', { class: 'muted' }, ` (${v.count})`))));
      syncControls();
    }
    allBox.addEventListener('change', () => {
      for (const v of values.filter(matches)) { if (allBox.checked) chosen.add(v.value); else chosen.delete(v.value); }
      paintList();
    });
    // As in Excel: typing in the search box selects just what it finds, so OK filters to those values.
    search.addEventListener('input', () => {
      chosen.clear();
      for (const v of values.filter(matches)) chosen.add(v.value);
      paintList();
    });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !okBtn.disabled) okBtn.click(); });

    const menu = h('div', { class: 'col-menu', role: 'dialog', dir: isAr ? 'rtl' : 'ltr' },
      sortItem('asc'), sortItem('desc'),
      state.sort?.col === ci && btn(L.clearSort, () => { state.sort = null; close(true); apply(); }, 'small ghost'),
      h('hr', {}),
      search,
      h('label', { class: 'menu-check all' }, allBox, h('span', {}, L.all)),
      list,
      h('div', { class: 'menu-actions' }, okBtn, btn(L.cancel, () => close(true), 'small ghost'),
        state.filters[ci] && btn(L.clearFilter, () => { delete state.filters[ci]; close(true); apply(); }, 'small ghost')));
    paintList();
    document.body.append(menu);

    // Fixed, so the table's own scrolling never clips it; kept inside the window.
    const rect = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    const left = isAr ? rect.right - width : rect.left;
    menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    if (spaceBelow < 260 && spaceAbove > spaceBelow) {   // near the bottom of the screen: open upwards
      menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      menu.style.maxHeight = `${Math.max(140, spaceAbove)}px`;
    } else {
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.maxHeight = `${Math.max(140, spaceBelow)}px`;
    }
    // On a phone, focusing the search box would raise the keyboard and scroll the page, which must not close the menu.
    const openedAt = Date.now();
    if (!window.matchMedia('(pointer: coarse)').matches) search.focus();

    const onDown = (e) => { if (!menu.contains(e.target) && e.target !== trigger) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(true); };
    const onScroll = (e) => { if (Date.now() - openedAt > 400 && !menu.contains(e.target)) close(); };
    const onHash = () => close();
    // refocus: put the keyboard focus back on the arrow (when closed with the keyboard or a menu button, not by clicking elsewhere)
    function close(refocus) {
      menu.remove();
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('hashchange', onHash);
      if (closeOpenMenu === close) { closeOpenMenu = null; openMenuTrigger = null; }
      if (refocus === true && trigger.isConnected) trigger.focus();
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('hashchange', onHash);
    closeOpenMenu = close;
    openMenuTrigger = trigger;
  }

  apply();
  return wrap;
}

// buttons: [{ label, kind, onClick }]; onClick may return false to keep the dialog open.
export function modal({ title, body, buttons = [] }) {
  const close = () => overlay.remove();
  const footer = h('div', { class: 'modal-actions' }, buttons.map((b) => btn(b.label, async (el) => {
    const keepOpen = (await b.onClick?.(el)) === false;
    if (!keepOpen) close();
  }, b.kind || '')));
  const overlay = h('div', { class: 'overlay', onClick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'x', type: 'button', onClick: close, 'aria-label': getLang() === 'ar' ? 'إغلاق النافذة' : 'Close dialog' }, '×')),
      h('div', { class: 'modal-body' }, body),
      footer));
  document.body.append(overlay);
  return { close, overlay };
}

export function confirmBox(message, okLabel = getLang() === 'ar' ? 'تأكيد' : 'Confirm', kind = 'danger') {
  return new Promise((resolve) => {
    const m = modal({
      title: getLang() === 'ar' ? 'تأكيد الإجراء' : 'Confirm Action',
      body: h('p', { style: { whiteSpace: 'pre-line' } }, message),
      buttons: [
        { label: okLabel, kind, onClick: () => resolve(true) },
        { label: getLang() === 'ar' ? 'إلغاء' : 'Cancel', kind: 'ghost', onClick: () => resolve(false) },
      ],
    });
    m.overlay.addEventListener('click', (e) => { if (e.target === m.overlay) resolve(false); });
  });
}

function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV with a UTF-8 byte-order mark so Excel reads Arabic correctly.
export function downloadCSV(filename, rows) {
  const cell = (v) => {
    const s = String(csvSafe(v));   // text that Excel would run as a formula gets a quote in front
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`;
  saveBlob(filename, new Blob([text], { type: 'text/csv;charset=utf-8' }));
}

export function downloadJSON(filename, data) {
  saveBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
}

export function spinner() {
  return h('div', { class: 'spinner', role: 'status', 'aria-label': getLang() === 'ar' ? 'جارٍ التحميل' : 'Loading' });
}
