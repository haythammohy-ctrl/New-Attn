// QA runner: load tests/index.html in headless Chrome, print each failure with its reason.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://localhost:8095/tests/index.html';
const port = 9700 + Math.floor(Math.random() * 200);
const profile = path.join(os.tmpdir(), `cdp-qa-${Date.now()}`);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('CDP endpoint never came up');
}

const ws = new WebSocket(await endpoint());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 0;
const pending = new Map();
const consoleLines = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleLines.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++nextId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url });

let text = '';
for (let i = 0; i < 200; i++) {
  await sleep(250);
  const { result } = await send('Runtime.evaluate', {
    expression: "document.getElementById('results')?.textContent || ''", returnByValue: true,
  });
  text = result?.result?.value || '';
  if (text) break;
}

const lines = text.split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('FAIL')) {
    out.push(lines[i]);
    for (let j = i + 1; j < lines.length && lines[j].startsWith('      '); j++) out.push(lines[j]);
  }
}
console.log(out.length ? out.join('\n') : 'no failures');
console.log(lines[lines.length - 1] || '(no summary — harness did not finish)');
if (consoleLines.length) console.log('console:\n' + consoleLines.slice(0, 8).join('\n'));

ws.close();
chrome.kill();
await sleep(800);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* profile may be locked */ }
