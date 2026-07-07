/**
 * VIEWER shell — the interactive HTML experience wrapped around a rendered
 * communication document. Serves the accessibility-first chrome (skip link,
 * assistant panel, action dialog) and the inline behavior layer; the
 * document itself is injected as pre-rendered HTML.
 */
import { escapeHtml } from '../../kernel/values.js';

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'";

const SHELL_CSS = `
:root { --fg: #1a1a1a; --bg: #f2f2ef; --chrome-bg: #ffffff; --border: #c8c8c2; --accent: #14532d; --focus: #1d4ed8; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #ececec; --bg: #191b1e; --chrome-bg: #24272b; --border: #43474d; --accent: #7fd8a4; --focus: #7aa2ff; }
}
* { box-sizing: border-box; }
body { margin: 0; font-family: Georgia, 'Times New Roman', serif; background: var(--bg); color: var(--fg); line-height: 1.5; }
button, input, textarea { font: inherit; }
button { min-height: 44px; min-width: 44px; padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 6px; background: var(--chrome-bg); color: var(--fg); cursor: pointer; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
@media (prefers-color-scheme: dark) { button.primary { color: #10241a; } }
a { color: var(--focus); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.skip-link { position: absolute; left: -9999px; top: 0; background: var(--chrome-bg); padding: 0.75rem 1rem; z-index: 20; }
.skip-link:focus { left: 0.5rem; top: 0.5rem; }
.shell-header { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: var(--chrome-bg); border-bottom: 1px solid var(--border); }
.shell-header h1 { font-size: 1.15rem; margin: 0; }
.shell-actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.shell-actions a.pdf-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 1rem; border: 1px solid var(--border); border-radius: 6px; text-decoration: none; background: var(--chrome-bg); color: var(--fg); }
/* The document region keeps a fixed light presentation regardless of theme —
   dark mode applies to the SHELL chrome only. */
main#doc { max-width: 46rem; margin: 1.25rem auto; padding: 1.5rem; background: #ffffff; color: #17201b; border: 1px solid var(--border); border-radius: 8px; }
main#doc section, main#doc details { margin: 1rem 0; }
main#doc summary { cursor: pointer; font-weight: bold; min-height: 44px; display: flex; align-items: center; }
main#doc .field-row { display: flex; justify-content: space-between; gap: 1rem; padding: 0.35rem 0; border-bottom: 1px dotted #b9c2bc; }
main#doc table { width: 100%; border-collapse: collapse; }
main#doc th, main#doc td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #d4d9d5; text-align: left; }
main#doc .explanation { font-style: italic; color: #40514a; }
main#doc .doc-action { margin: 0.35rem 0.35rem 0.35rem 0; background: #14532d; color: #fff; border-color: #14532d; }
#assistant { position: fixed; right: 0; top: 0; bottom: 0; width: min(24rem, 100%); background: var(--chrome-bg); border-left: 1px solid var(--border); padding: 1rem; overflow-y: auto; z-index: 10; }
#assistant h2 { margin-top: 0; font-size: 1.05rem; }
#assistant-log { min-height: 6rem; max-height: 55vh; overflow-y: auto; margin-bottom: 0.75rem; }
#assistant-log .q { font-weight: bold; }
#assistant-log .a { border-left: 4px solid var(--accent); padding: 0.25rem 0.6rem; margin: 0.5rem 0; }
#assistant-log .a.escalated { border-left-color: #b45309; background: rgba(217, 119, 6, 0.12); }
#assistant-log .sources, #assistant-log .ai-note { font-size: 0.82rem; color: #6b7280; }
@media (prefers-color-scheme: dark) { #assistant-log .sources, #assistant-log .ai-note { color: #a3a8ae; } }
#assistant form { display: flex; flex-direction: column; gap: 0.5rem; }
#assistant input { min-height: 44px; padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); }
#assistant .provenance { font-size: 0.82rem; color: #6b7280; }
@media (prefers-color-scheme: dark) { #assistant .provenance { color: #a3a8ae; } }
dialog#action-dialog { border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; max-width: 26rem; width: calc(100% - 2rem); background: var(--chrome-bg); color: var(--fg); }
dialog#action-dialog::backdrop { background: rgba(0, 0, 0, 0.5); }
dialog#action-dialog label { display: block; margin: 0.6rem 0; }
dialog#action-dialog input, dialog#action-dialog textarea { display: block; width: 100%; min-height: 44px; margin-top: 0.25rem; padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); }
dialog#action-dialog .dialog-buttons { display: flex; gap: 0.5rem; margin-top: 1rem; }
#toast { position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%); background: #7f1d1d; color: #fff; padding: 0.75rem 1.25rem; border-radius: 8px; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 30; }
#toast.show { opacity: 1; }
.error-card, .otp-card { max-width: 28rem; margin: 4rem auto; padding: 2rem; background: var(--chrome-bg); border: 1px solid var(--border); border-radius: 10px; }
.otp-card input { display: block; width: 100%; min-height: 44px; margin: 0.5rem 0 1rem; padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); font-size: 1.2rem; letter-spacing: 0.2em; }
.otp-error { color: #b91c1c; font-weight: bold; }
`;

function inlineScript(token: string): string {
  return (
    '(function () {\n' +
    "  'use strict';\n" +
    `  var TOKEN = ${JSON.stringify(token)};\n` +
    "  var API = '/api/view/' + encodeURIComponent(TOKEN);\n" +
    "  var PDF_HREF = '/view/' + encodeURIComponent(TOKEN) + '/pdf';\n" +
    '\n' +
    '  function toast(msg) {\n' +
    "    var t = document.getElementById('toast');\n" +
    '    if (!t) {\n' +
    "      t = document.createElement('div');\n" +
    "      t.id = 'toast';\n" +
    "      t.setAttribute('role', 'status');\n" +
    '      document.body.appendChild(t);\n' +
    '    }\n' +
    '    t.textContent = msg;\n' +
    "    t.classList.add('show');\n" +
    "    setTimeout(function () { t.classList.remove('show'); }, 4000);\n" +
    '  }\n' +
    '\n' +
    '  // (5) fetch wrapper with error toast\n' +
    '  function api(path, body) {\n' +
    '    return fetch(API + path, {\n' +
    "      method: 'POST',\n" +
    "      headers: { 'content-type': 'application/json' },\n" +
    '      body: JSON.stringify(body)\n' +
    '    }).then(function (res) {\n' +
    "      if (!res.ok) { throw new Error('request failed: ' + res.status); }\n" +
    '      return res.json();\n' +
    '    }).catch(function (err) {\n' +
    "      toast('Something went wrong. Please try again.');\n" +
    '      throw err;\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  // (1) section-viewed once per section at 50% visibility\n' +
    '  var seen = {};\n' +
    "  if ('IntersectionObserver' in window) {\n" +
    '    var observer = new IntersectionObserver(function (entries) {\n' +
    '      entries.forEach(function (entry) {\n' +
    '        if (!entry.isIntersecting) { return; }\n' +
    "        var id = entry.target.getAttribute('data-section-id');\n" +
    '        if (!id || seen[id]) { return; }\n' +
    '        seen[id] = true;\n' +
    "        api('/interactions', { kind: 'section-viewed', detail: id }).catch(function () {});\n" +
    '      });\n' +
    '    }, { threshold: 0.5 });\n' +
    "    document.querySelectorAll('[data-section-id]').forEach(function (el) { observer.observe(el); });\n" +
    '  }\n' +
    '\n' +
    '  // (2) collapsible sections report expansion\n' +
    "  document.querySelectorAll('details[data-section-id]').forEach(function (el) {\n" +
    "    el.addEventListener('toggle', function () {\n" +
    '      if (el.open) {\n' +
    "        api('/interactions', { kind: 'section-expanded', detail: el.getAttribute('data-section-id') }).catch(function () {});\n" +
    '      }\n' +
    '    });\n' +
    '  });\n' +
    '\n' +
    '  // (3) action buttons open the native dialog\n' +
    "  var dialog = document.getElementById('action-dialog');\n" +
    "  var dialogBody = document.getElementById('action-dialog-body');\n" +
    '\n' +
    '  function fieldsFor(action) {\n' +
    "    if (action === 'pay') { return '<label>Amount<input type=\"number\" name=\"amount\" min=\"0\" step=\"0.01\" required></label>'; }\n" +
    "    if (action === 'dispute') { return '<label>Reason<textarea name=\"reason\" rows=\"3\" required></textarea></label>'; }\n" +
    "    if (action === 'update-details') { return '<label>Email<input type=\"email\" name=\"email\"></label><label>Phone<input type=\"tel\" name=\"phone\"></label>'; }\n" +
    "    if (action === 'contact') { return '<label>Message<textarea name=\"message\" rows=\"3\" required></textarea></label>'; }\n" +
    "    return '';\n" +
    '  }\n' +
    '\n' +
    '  function openActionDialog(action, label) {\n' +
    '    if (!dialog || !dialogBody) { return; }\n' +
    '    dialogBody.innerHTML =\n' +
    "      '<h2 id=\"action-dialog-title\"></h2>' +\n" +
    "      '<form id=\"action-form\">' + fieldsFor(action) +\n" +
    "      '<div class=\"dialog-buttons\">' +\n" +
    "      '<button type=\"submit\" class=\"primary\">Confirm</button>' +\n" +
    "      '<button type=\"button\" id=\"action-cancel\">Cancel</button>' +\n" +
    "      '</div></form>';\n" +
    "    dialogBody.querySelector('#action-dialog-title').textContent = label;\n" +
    '    dialog.showModal();\n' +
    "    var cancel = document.getElementById('action-cancel');\n" +
    "    if (cancel) { cancel.addEventListener('click', function () { dialog.close(); }); }\n" +
    "    var form = document.getElementById('action-form');\n" +
    "    form.addEventListener('submit', function (ev) {\n" +
    '      ev.preventDefault();\n' +
    '      var payload = {};\n' +
    '      new FormData(form).forEach(function (value, key) { payload[key] = value; });\n' +
    "      api('/actions', { action: action, payload: payload }).then(function (txn) {\n" +
    '        dialogBody.innerHTML =\n' +
    "          '<h2 id=\"action-dialog-title\">Thank you</h2>' +\n" +
    "          '<p>Your request was completed successfully.</p>' +\n" +
    "          '<p class=\"txn\">Transaction id: <code></code></p>' +\n" +
    "          '<button type=\"button\" id=\"action-done\" class=\"primary\">Close</button>';\n" +
    "        dialogBody.querySelector('.txn code').textContent = txn.id;\n" +
    "        var done = document.getElementById('action-done');\n" +
    "        done.addEventListener('click', function () { dialog.close(); });\n" +
    '        done.focus();\n' +
    '      }).catch(function () {});\n' +
    '    });\n' +
    "    var first = dialogBody.querySelector('input, textarea, button');\n" +
    '    if (first) { first.focus(); }\n' +
    '  }\n' +
    '\n' +
    "  document.querySelectorAll('.doc-action').forEach(function (btn) {\n" +
    "    btn.addEventListener('click', function () {\n" +
    "      var action = btn.getAttribute('data-action');\n" +
    "      if (action === 'download') { window.location.href = PDF_HREF; return; }\n" +
    "      openActionDialog(action, (btn.textContent || action).trim());\n" +
    '    });\n' +
    '  });\n' +
    '\n' +
    '  // (4) assistant panel\n' +
    "  var toggle = document.getElementById('assistant-toggle');\n" +
    "  var aside = document.getElementById('assistant');\n" +
    '  if (toggle && aside) {\n' +
    "    toggle.addEventListener('click', function () {\n" +
    "      var opening = aside.hasAttribute('hidden');\n" +
    "      if (opening) { aside.removeAttribute('hidden'); } else { aside.setAttribute('hidden', ''); }\n" +
    "      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');\n" +
    "      if (opening) { var q = document.getElementById('q'); if (q) { q.focus(); } }\n" +
    '    });\n' +
    '  }\n' +
    "  var log = document.getElementById('assistant-log');\n" +
    "  var assistantForm = document.getElementById('assistant-form');\n" +
    '  if (assistantForm && log) {\n' +
    "    assistantForm.addEventListener('submit', function (ev) {\n" +
    '      ev.preventDefault();\n' +
    "      var input = document.getElementById('q');\n" +
    "      var question = input && input.value ? input.value.trim() : '';\n" +
    '      if (!question) { return; }\n' +
    "      var qEl = document.createElement('p');\n" +
    "      qEl.className = 'q';\n" +
    "      qEl.textContent = 'You: ' + question;\n" +
    '      log.appendChild(qEl);\n' +
    "      input.value = '';\n" +
    "      api('/ask', { question: question }).then(function (answer) {\n" +
    "        var aEl = document.createElement('div');\n" +
    "        aEl.className = 'a' + (answer.escalated ? ' escalated' : '');\n" +
    "        var text = document.createElement('p');\n" +
    '        text.textContent = answer.answer;\n' +
    '        aEl.appendChild(text);\n' +
    '        if (answer.citations && answer.citations.length) {\n' +
    "          var src = document.createElement('p');\n" +
    "          src.className = 'sources';\n" +
    "          src.textContent = 'Sources: ' + answer.citations.map(function (c) { return c.title; }).join(', ');\n" +
    '          aEl.appendChild(src);\n' +
    '        }\n' +
    "        var note = document.createElement('p');\n" +
    "        note.className = 'ai-note';\n" +
    "        note.textContent = 'AI-generated from your document \\u2014 verify important details.';\n" +
    '        aEl.appendChild(note);\n' +
    '        if (answer.escalated) {\n' +
    "          var contactBtn = document.createElement('button');\n" +
    "          contactBtn.type = 'button';\n" +
    "          contactBtn.textContent = 'Contact a specialist';\n" +
    "          contactBtn.addEventListener('click', function () { openActionDialog('contact', 'Contact a specialist'); });\n" +
    '          aEl.appendChild(contactBtn);\n' +
    '        }\n' +
    '        log.appendChild(aEl);\n' +
    '        log.scrollTop = log.scrollHeight;\n' +
    '      }).catch(function () {});\n' +
    '    });\n' +
    '  }\n' +
    '})();\n'
  );
}

function page(args: { title: string; body: string; script?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${escapeHtml(args.title)}</title>
<style>${SHELL_CSS}</style>
</head>
<body>
${args.body}
${args.script ?? ''}
</body>
</html>`;
}

/** Full interactive shell around a rendered document. */
export function shellPage(args: {
  docHtml: string;
  title: string;
  token: string;
  hasPdf: boolean;
}): string {
  const pdfHref = `/view/${encodeURIComponent(args.token)}/pdf`;
  const body = `<a class="skip-link" href="#doc">Skip to document</a>
<header class="shell-header">
  <h1>${escapeHtml(args.title)}</h1>
  <nav class="shell-actions" aria-label="Document tools">
    ${args.hasPdf ? `<a class="pdf-link" href="${pdfHref}">Download PDF</a>` : ''}
    <button id="assistant-toggle" type="button" aria-expanded="false" aria-controls="assistant">Ask about this document</button>
  </nav>
</header>
<main id="doc" tabindex="-1">
${args.docHtml}
</main>
<aside id="assistant" hidden role="complementary" aria-label="Document assistant">
  <h2>Document assistant</h2>
  <div id="assistant-log" aria-live="polite"></div>
  <form id="assistant-form">
    <label for="q">Ask a question about this document</label>
    <input id="q" name="q" type="text" maxlength="500" autocomplete="off" required>
    <button type="submit" class="primary">Ask</button>
  </form>
  <p class="provenance">Answers are generated only from this document's approved content.</p>
</aside>
<dialog id="action-dialog" aria-labelledby="action-dialog-title"><div id="action-dialog-body"></div></dialog>
<div id="toast" role="status"></div>
<script>${inlineScript(args.token)}</script>
<script src="/viewer-assets/acorn-access.min.js" defer></script>`;
  return page({ title: args.title, body });
}

/** Styled error page (link not found / expired / revoked). */
export function errorPage(args: { title: string; message: string }): string {
  const body = `<main class="error-card">
  <h1>${escapeHtml(args.title)}</h1>
  <p>${escapeHtml(args.message)}</p>
  <p>If you believe this is a mistake, please contact the sender for a fresh secure link.</p>
</main>`;
  return page({ title: args.title, body });
}

/** One-time-code challenge page; posts the otp field back to the same URL. */
export function otpPage(args: { token: string; error?: string }): string {
  const action = `/view/${encodeURIComponent(args.token)}`;
  const body = `<main class="otp-card">
  <h1>Verify it's you</h1>
  <p>This document is protected. Enter the one-time code that was sent to you.</p>
  ${args.error ? `<p class="otp-error" role="alert">${escapeHtml(args.error)}</p>` : ''}
  <form method="post" action="${action}">
    <label for="otp">One-time code</label>
    <input id="otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" required>
    <button type="submit" class="primary">View document</button>
  </form>
</main>`;
  return page({ title: 'Verify it\'s you', body });
}
