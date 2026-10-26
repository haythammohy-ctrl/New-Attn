// Minimal in-browser test harness: no install, open tests/index.html through serve.ps1.
const results = [];

export async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

// Compares strings code point by code point and names the first difference.
// (A whole-string diff would only say "these two long strings differ".)
function describeDiff(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return '';
  const a = [...actual];
  const e = [...expected];
  for (let i = 0; i < Math.max(a.length, e.length); i += 1) {
    if (a[i] === e[i]) continue;
    const show = (c) => (c === undefined ? 'nothing'
      : c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}` : `"${c}"`);
    return ` (first difference at index ${i}: expected ${show(e[i])}, got ${show(a[i])})`;
  }
  return '';
}

export function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} expected ${e} but got ${a}${describeDiff(actual, expected)}`);
}

export function near(actual, expected, tolerance, label = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} expected ${expected} (+/-${tolerance}) but got ${actual}`);
  }
}

export function throwsCode(fn, code) {
  try {
    fn();
  } catch (err) {
    if (err.code !== code) throw new Error(`expected error '${code}' but got '${err.code || err.message}'`);
    return;
  }
  throw new Error(`expected error '${code}' but nothing was thrown`);
}

export function report() {
  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.error}`}`);
  lines.push('', `${results.length - failed.length}/${results.length} passed`);
  document.body.textContent = '';
  const pre = document.createElement('pre');
  pre.id = 'results';
  pre.textContent = lines.join('\n');
  pre.style.color = failed.length ? '#b00020' : '#146c2e';
  document.body.append(pre);
  window.__results = { total: results.length, failed: failed.length };
}
