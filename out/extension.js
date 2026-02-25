"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const os = require("os");
function activate(context) {
    const provider = new FaaaaaahViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('faaaaaah.judgeView', provider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    const cmd = vscode.commands.registerCommand('faaaaaah.openPanel', () => {
        vscode.commands.executeCommand('faaaaaah.judgeView.focus');
    });
    context.subscriptions.push(cmd);
}
class FaaaaaahViewProvider {
    constructor(ctx) { this._ctx = ctx; }
    resolveWebviewView(view) {
        this._view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._ctx.extensionUri, 'media')]
        };
        this._refresh();
        view.onDidChangeVisibility(() => { if (view.visible) {
            this._refresh();
        } });
        view.webview.onDidReceiveMessage(async (msg) => {
            if (!this._view) {
                return;
            }
            switch (msg.type) {
                case 'save':
                    await this._ctx.workspaceState.update(this._key(), msg.tests);
                    break;
                case 'runOne': {
                    const file = this._activeFile();
                    if (!file) {
                        this._view.webview.postMessage({ type: 'result', id: msg.test.id, pass: false, actual: '', error: 'Click your .cpp / .c / .py file first, then run.' });
                        return;
                    }
                    const res = await runTest(file, msg.test);
                    this._view.webview.postMessage({ type: 'result', id: msg.test.id, ...res });
                    break;
                }
                case 'runAll': {
                    const file = this._activeFile();
                    if (!file) {
                        for (const t of msg.tests) {
                            this._view.webview.postMessage({ type: 'result', id: t.id, pass: false, actual: '', error: 'No active source file.' });
                        }
                        return;
                    }
                    for (const test of msg.tests) {
                        const res = await runTest(file, test);
                        this._view.webview.postMessage({ type: 'result', id: test.id, ...res });
                    }
                    break;
                }
            }
        });
    }
    _refresh() {
        if (!this._view) {
            return;
        }
        const wavUri = this._view.webview.asWebviewUri(vscode.Uri.joinPath(this._ctx.extensionUri, 'media', 'Faaaaaah.wav'));
        const saved = this._ctx.workspaceState.get(this._key(), []);
        this._view.webview.html = buildHtml(this._view.webview, wavUri.toString(), saved);
    }
    _key() {
        const editor = vscode.window.activeTextEditor;
        return editor ? `testcases:${editor.document.fileName}` : 'testcases:__global__';
    }
    _activeFile() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        if (editor.document.isDirty) {
            editor.document.save();
        }
        return editor.document.fileName;
    }
}
async function runTest(filePath, test) {
    const ext = path.extname(filePath).toLowerCase();
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, ext);
    try {
        if (ext === '.py') {
            const actual = await execute(`python "${filePath}"`, test.input, dir)
                .catch(() => execute(`python3 "${filePath}"`, test.input, dir));
            return compare(actual, test.expected);
        }
        const outFile = path.join(os.tmpdir(), base + (process.platform === 'win32' ? '.exe' : '.out'));
        let compileCmd;
        if (ext === '.c') {
            compileCmd = `gcc "${filePath}" -o "${outFile}" -lm`;
        }
        else if (['.cpp', '.cc', '.cxx'].includes(ext)) {
            compileCmd = `g++ "${filePath}" -o "${outFile}" -std=c++17 -lm`;
        }
        else {
            return { pass: false, actual: '', error: `Unsupported: ${ext}` };
        }
        await execute(compileCmd, '', dir);
        const actual = await execute(`"${outFile}"`, test.input, dir);
        return compare(actual, test.expected);
    }
    catch (e) {
        return { pass: false, actual: '', error: e instanceof Error ? e.message : String(e) };
    }
}
function compare(actual, expected) {
    const norm = (s) => s.split('\n').map(l => l.trimEnd()).join('\n').trim();
    return { pass: norm(actual) === norm(expected), actual };
}
function execute(cmd, stdin, cwd) {
    return new Promise((resolve, reject) => {
        const proc = cp.spawn(cmd, [], { shell: true, cwd });
        let out = '', err = '';
        proc.stdout.on('data', (d) => out += d.toString());
        proc.stderr.on('data', (d) => err += d.toString());
        proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || `Exit ${code}`)));
        proc.stdin.write(stdin);
        proc.stdin.end();
    });
}
function buildHtml(webview, wavUri, savedTests) {
    const nonce = getNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  media-src ${webview.cspSource};
  script-src 'nonce-${nonce}';
  style-src 'unsafe-inline';
">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Faaaaaah!</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:      #0d0d0f;
  --surface: #111114;
  --line:    #1c1c21;
  --line2:   #28282f;
  --fg:      #e4e4e8;
  --dim:     #5a5a6a;
  --mono:    'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace;

  --accent:  #7c6af7;
  --pass:    #23d18b;
  --fail:    #f14c4c;
  --run:     #4fc1ff;
  --warn:    #f59e0b;
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.55;
  min-height: 100vh;
}

/* ── TOP BAR ── */
.topbar {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--line);
  box-shadow: 0 1px 0 #7c6af720;
}
.topbar-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--accent);
  padding: 10px 14px;
  border-right: 1px solid var(--line);
  flex-shrink: 0;
  user-select: none;
  display: flex;
  align-items: center;
  background: #0d0d0f;
}
.topbar-actions {
  display: flex;
  align-items: center;
  padding: 0 6px;
  gap: 2px;
}
.tbtn {
  background: none;
  border: none;
  color: var(--dim);
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: .04em;
  cursor: pointer;
  padding: 8px 11px;
  transition: color .1s, background .1s;
}
.tbtn:hover  { color: var(--fg); background: var(--line); }
.tbtn:active { opacity: .6; }
.tbtn.primary       { color: var(--accent); }
.tbtn.primary:hover { color: #fff; background: var(--accent); }

/* ── CASES ── */
.cases { display: flex; flex-direction: column; }

/* ── SINGLE CASE ── */
.case {
  border-bottom: 1px solid var(--line);
  border-left: 3px solid var(--line2);
  transition: border-left-color .15s;
}
.case.pass    { border-left-color: var(--pass); }
.case.fail    { border-left-color: var(--fail); }
.case.running { border-left-color: var(--run); }

/* ── CASE HEADER ── */
.case-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.case-id {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--accent);
  flex: 1;
  opacity: .7;
}
.status {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: transparent;
  min-width: 56px;
  text-align: right;
}
.status.pass    { color: var(--pass); }
.status.fail    { color: var(--fail); }
.status.running { color: var(--run); }

.case-btns { display: flex; gap: 2px; margin-left: 4px; }
.cbtn {
  background: none;
  border: none;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  color: var(--dim);
  padding: 4px 8px;
  transition: color .1s, background .1s;
  letter-spacing: .03em;
}
.cbtn:hover         { background: var(--line); }
.cbtn.run:hover     { color: var(--pass); }
.cbtn.del:hover     { color: var(--fail); }

/* ── IO ROWS ── */
.io-rows { display: flex; flex-direction: column; }

.field {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--line);
}
.field:last-child { border-bottom: none; }

.field-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .17em;
  text-transform: uppercase;
  padding: 5px 11px 4px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  user-select: none;
}
.field-label.lbl-input    { color: var(--run); }
.field-label.lbl-expected { color: var(--warn); }
.field-label.lbl-output   { color: var(--pass); }
.field-label.lbl-output.bad { color: var(--fail); }

textarea {
  width: 100%;
  background: var(--bg);
  color: var(--fg);
  border: none;
  outline: none;
  resize: vertical;
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.6;
  padding: 8px 11px;
  min-height: 58px;
}
textarea:focus        { background: #101013; }
textarea::placeholder { color: var(--line2); }

.out-box {
  font-family: var(--mono);
  font-size: 13px;
  line-height: 1.6;
  padding: 8px 11px;
  min-height: 44px;
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
  color: var(--dim);
}
.out-box.ok  { color: var(--pass); }
.out-box.bad { color: var(--fail); }

.err-strip {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--fail);
  border-top: 1px solid #3a1616;
  background: #150707;
  padding: 7px 11px;
  white-space: pre-wrap;
  word-break: break-word;
  opacity: .9;
}

/* ── EMPTY ── */
.empty {
  padding: 52px 16px;
  text-align: center;
  font-size: 11px;
  letter-spacing: .06em;
  line-height: 2.2;
  color: var(--line2);
}
.empty-accent { color: var(--accent); opacity: .5; font-size: 22px; margin-bottom: 12px; }

/* ── FLASH ── */
.flash {
  position: fixed; inset: 0; pointer-events: none; z-index: 9999;
  background: var(--fail);
  opacity: 0;
  animation: fi .06s ease-out forwards, fo 1.0s .06s ease-in forwards;
}
@keyframes fi { to   { opacity: .2 } }
@keyframes fo { from { opacity: .2 } to { opacity: 0 } }

audio { display: none; }
</style>
</head>
<body>

<div class="topbar">
  <span class="topbar-title">Faaaaaah!</span>
  <div class="topbar-actions">
    <button class="tbtn primary" id="btn-add">+ case</button>
    <button class="tbtn" id="btn-runall">&#9654; run all</button>
  </div>
</div>

<div class="cases" id="cases">
  <div class="empty" id="empty-state">
    <div class="empty-accent">&#9651;</div>
    NO CASES YET<br>press <span style="color:var(--accent)">+ case</span> to begin
  </div>
</div>

<audio id="fail-snd" src="${wavUri}" preload="auto"></audio>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let tests = ${JSON.stringify(savedTests)};
let nextId = tests.length ? Math.max(...tests.map(t => t.id)) + 1 : 1;

function save() { vscode.postMessage({ type: 'save', tests }); }

document.getElementById('btn-add').addEventListener('click', () => addCase());
document.getElementById('btn-runall').addEventListener('click', runAll);

function addCase(inp = '', exp = '') {
  const t = { id: nextId++, input: inp, expected: exp };
  tests.push(t);
  renderCase(t);
  renumber();
  updateEmpty();
  save();
}

function delCase(id) {
  tests = tests.filter(t => t.id !== id);
  document.getElementById('case-' + id)?.remove();
  renumber();
  updateEmpty();
  save();
}

// Re-label every case by its visual position (1..n)
function renumber() {
  document.querySelectorAll('.case').forEach((el, i) => {
    const label = el.querySelector('.case-id');
    if (label) { label.textContent = 'case ' + String(i + 1).padStart(2, '0'); }
  });
}

function sync(id) {
  const el = document.getElementById('case-' + id);
  const t = tests.find(t => t.id === id);
  if (t && el) {
    t.input    = el.querySelector('.inp').value;
    t.expected = el.querySelector('.exp').value;
  }
}

function runOne(id) {
  sync(id); save();
  const t = tests.find(t => t.id === id);
  if (!t) { return; }
  setStatus(id, 'running', 'running');
  vscode.postMessage({ type: 'runOne', test: t });
}

function runAll() {
  tests.forEach(t => { sync(t.id); setStatus(t.id, 'running', 'running'); });
  save();
  vscode.postMessage({ type: 'runAll', tests: [...tests] });
}

function setStatus(id, cls, text) {
  const el = document.getElementById('case-' + id);
  if (!el) { return; }
  const s = el.querySelector('.status');
  s.className = 'status ' + cls;
  s.textContent = text;
  el.classList.remove('pass', 'fail', 'running');
  el.classList.add(cls);
}

function showActual(id, actual, ok, err) {
  const el = document.getElementById('case-' + id);
  if (!el) { return; }
  const rows = el.querySelector('.io-rows');
  el.querySelectorAll('.actual-row, .err-row').forEach(n => n.remove());

  const row = document.createElement('div');
  row.className = 'field actual-row';
  const lblClass = 'field-label lbl-output' + (ok ? '' : ' bad');
  row.innerHTML =
    '<div class="' + lblClass + '">output</div>' +
    '<div class="out-box ' + (ok ? 'ok' : 'bad') + '">' + esc(actual || '') + '</div>';
  rows.appendChild(row);

  if (err) {
    const errRow = document.createElement('div');
    errRow.className = 'err-row';
    errRow.innerHTML = '<div class="err-strip">' + esc(err) + '</div>';
    rows.appendChild(errRow);
  }
}

function renderCase(t) {
  const wrap = document.createElement('div');
  wrap.id = 'case-' + t.id;
  wrap.className = 'case';
  wrap.innerHTML =
    '<div class="case-head">' +
      '<span class="case-id"></span>' +
      '<span class="status"></span>' +
      '<div class="case-btns">' +
        '<button class="cbtn run" data-action="run">run</button>' +
        '<button class="cbtn del" data-action="del">del</button>' +
      '</div>' +
    '</div>' +
    '<div class="io-rows">' +
      '<div class="field">' +
        '<div class="field-label lbl-input">input</div>' +
        '<textarea class="inp" placeholder="stdin...">' + esc(t.input) + '</textarea>' +
      '</div>' +
      '<div class="field">' +
        '<div class="field-label lbl-expected">expected</div>' +
        '<textarea class="exp" placeholder="expected output...">' + esc(t.expected) + '</textarea>' +
      '</div>' +
    '</div>';

  wrap.querySelector('.inp').addEventListener('input', () => sync(t.id));
  wrap.querySelector('.exp').addEventListener('input', () => sync(t.id));
  wrap.querySelector('[data-action="run"]').addEventListener('click', () => runOne(t.id));
  wrap.querySelector('[data-action="del"]').addEventListener('click', () => delCase(t.id));

  document.getElementById('cases').appendChild(wrap);
}

function updateEmpty() {
  const el = document.getElementById('empty-state');
  if (el) { el.style.display = tests.length ? 'none' : 'block'; }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.addEventListener('message', e => {
  const m = e.data;
  if (m.type !== 'result') { return; }
  if (m.pass) {
    setStatus(m.id, 'pass', 'pass');
  } else {
    setStatus(m.id, 'fail', 'fail');
    boom();
  }
  showActual(m.id, m.actual, m.pass, m.error);
});

function boom() {
  const f = document.createElement('div');
  f.className = 'flash';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1200);
  const a = document.getElementById('fail-snd');
  a.currentTime = 0;
  a.play().catch(() => {});
}

tests.forEach(t => renderCase(t));
renumber();
updateEmpty();
</script>
</body>
</html>`;
}
function getNonce() {
    const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 32; i++) {
        s += C[Math.floor(Math.random() * C.length)];
    }
    return s;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map