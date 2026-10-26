// Small DOM toolkit: no framework, no innerHTML, so user text can never become markup.
import { errorText } from './api/errors.js';
import { getLang } from './lib/i18n.js';

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

export function dataTable(columns, rows, empty = getLang() === 'ar' ? 'لا توجد بيانات.' : 'No data available.') {
  if (!rows.length) return h('p', { class: 'empty' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.class || '' }, c.render(r))))))));
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
    const s = v == null ? '' : String(v);
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
