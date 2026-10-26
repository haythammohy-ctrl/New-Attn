import { AR_WEEKDAYS } from '../lib/dates.js';
import { getLang } from '../lib/i18n.js';
import { field, h, select } from '../ui.js';

/**
 * fields: [{ key, label, type, options?, required?, nullable?, hint?, step?, default? }]
 * type: text | number | time | date | checkbox | select | weekdays | textarea
 * Returns { nodes, read } where read() throws a readable Error if a required field is empty.
 */
export function buildForm(fields, values = {}) {
  const weekdays = getLang() === 'ar' ? AR_WEEKDAYS : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const inputs = {};
  const initial = (f) => values[f.key] ?? f.default;

  const nodes = fields.map((f) => {
    let el;
    if (f.type === 'checkbox') {
      el = h('input', { type: 'checkbox', checked: Boolean(initial(f)) });
      inputs[f.key] = el;
      return h('label', { class: 'check' }, el, f.label);
    }
    if (f.type === 'select') {
      el = select(f.options, initial(f) ?? '');
    } else if (f.type === 'weekdays') {
      const chosen = initial(f) || [];
      const boxes = weekdays.map((_, i) => h('input', { type: 'checkbox', checked: chosen.includes(i) }));
      el = h('div', { class: 'days' }, boxes.map((b, i) => h('label', {}, b, weekdays[i])));
      el.boxes = boxes;
    } else if (f.type === 'textarea') {
      el = h('textarea', { rows: 2, value: initial(f) ?? '' });
    } else {
      const raw = initial(f) ?? '';
      el = h('input', {
        type: f.type || 'text', step: f.step, min: f.min,
        value: f.type === 'time' ? String(raw).slice(0, 5) : raw,
      });
    }
    inputs[f.key] = el;
    return field(f.label, el, f.hint);
  });

  function read() {
    const out = {};
    for (const f of fields) {
      const el = inputs[f.key];
      let v;
      if (f.type === 'checkbox') v = el.checked;
      else if (f.type === 'weekdays') v = el.boxes.flatMap((b, i) => (b.checked ? [i] : []));
      else if (f.type === 'number') v = el.value === '' ? null : Number(el.value);
      else v = el.value.trim();
      if (f.required && (v === '' || v === null || (Array.isArray(v) && !v.length))) {
        throw new Error(getLang() === 'ar' ? `"${f.label}" مطلوب` : `"${f.label}" is required`);
      }
      if (f.nullable && v === '') v = null;
      out[f.key] = v;
    }
    return out;
  }

  // Fills text-like inputs programmatically (e.g. "use my current location").
  function set(updates) {
    for (const [key, value] of Object.entries(updates)) inputs[key].value = value;
  }

  return { nodes, read, set };
}
