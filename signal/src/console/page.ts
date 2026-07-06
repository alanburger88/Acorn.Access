/**
 * The demo console served at GET / by the API server.
 *
 * A single self-contained page (no external assets) that drives the real
 * API: bootstrap demo actors, ingest communications, inspect signed Outcome
 * Packets as different principals, complete actions, verify, and audit the
 * chain. The embedded script avoids backticks and dollar-brace so it can sit
 * safely inside this template literal.
 */
export const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acorn.Signal — Demo Console</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%232f6fed'/%3E%3C/svg%3E">
<style>
  :root {
    --bg: #f6f7f9; --panel: #ffffff; --ink: #1a2233; --muted: #5c6778;
    --line: #e3e7ee; --accent: #2f6fed; --accent-ink: #ffffff;
    --ok: #1a7f4b; --ok-bg: #e6f4ec; --warn: #9a6700; --warn-bg: #fff3d6;
    --bad: #b42318; --bad-bg: #fdecea; --chip: #eef1f6; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1116; --panel: #161b23; --ink: #e6e9ef; --muted: #98a2b3;
      --line: #262d38; --accent: #5b8def; --accent-ink: #0e1116;
      --ok: #4ade80; --ok-bg: #12291c; --warn: #fbbf24; --warn-bg: #2b2412;
      --bad: #f87171; --bad-bg: #2d1615; --chip: #1f2632;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    padding: 18px 24px; border-bottom: 1px solid var(--line); background: var(--panel); }
  header h1 { font-size: 18px; margin: 0; letter-spacing: .2px; }
  header h1 .dot { color: var(--accent); }
  header .sub { color: var(--muted); font-size: 13px; }
  header .health { margin-left: auto; font-family: var(--mono); font-size: 12px; color: var(--muted); }
  main { max-width: 1200px; margin: 0 auto; padding: 20px 24px 60px;
    display: grid; grid-template-columns: minmax(320px, 5fr) minmax(380px, 7fr); gap: 20px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px 18px; margin-bottom: 20px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .8px;
    color: var(--muted); margin: 0 0 12px; }
  .step { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
    border-radius: 50%; background: var(--accent); color: var(--accent-ink); font-size: 12px;
    font-weight: 700; margin-right: 8px; vertical-align: -4px; }
  label { display: block; font-size: 12px; color: var(--muted); margin: 10px 0 4px; }
  input, select, textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--line);
    border-radius: 7px; background: var(--bg); color: var(--ink); font: inherit; }
  textarea { min-height: 96px; resize: vertical; }
  button { padding: 8px 14px; border: 1px solid var(--line); border-radius: 7px; cursor: pointer;
    background: var(--panel); color: var(--ink); font: inherit; font-weight: 600; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.mini { padding: 3px 10px; font-size: 12px; font-weight: 500; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .row > div { flex: 1; min-width: 130px; }
  .samples { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
  .samples button { font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: 999px; }
  .chip { display: inline-block; padding: 2px 10px; border-radius: 999px; background: var(--chip);
    font-size: 12px; font-weight: 600; }
  .chip.ok { background: var(--ok-bg); color: var(--ok); }
  .chip.warn { background: var(--warn-bg); color: var(--warn); }
  .chip.bad { background: var(--bad-bg); color: var(--bad); }
  .status { font-size: 13px; margin-top: 10px; color: var(--muted); min-height: 20px; }
  .status.err { color: var(--bad); }
  .kv { font-family: var(--mono); font-size: 12px; color: var(--muted); word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
    color: var(--muted); padding: 6px 8px; border-bottom: 1px solid var(--line); }
  td { padding: 7px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  .checks span { margin-right: 12px; font-size: 13px; }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px;
    font-size: 12px; overflow: auto; max-height: 420px; }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; font-size: 13px; }
  .seg button.on { background: var(--accent); color: var(--accent-ink); }
  .chain-item { display: flex; gap: 10px; align-items: center; padding: 8px 4px;
    border-bottom: 1px solid var(--line); font-size: 13px; flex-wrap: wrap; }
  .chain-item:last-child { border-bottom: 0; }
  .chain-item .seq { font-family: var(--mono); color: var(--muted); width: 34px; }
  .chain-item .hash { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .chain-item a { color: var(--accent); cursor: pointer; text-decoration: none; }
  .hidden { display: none; }
  .note { font-size: 12px; color: var(--muted); margin-top: 8px; }
</style>
</head>
<body>
<header>
  <h1>Acorn<span class="dot">.</span>Signal</h1>
  <span class="sub">Demo Console — every communication becomes a signed, verifiable Outcome Packet</span>
  <span class="health" id="health">connecting…</span>
</header>
<main>
<section>
  <div class="card">
    <h2><span class="step">1</span>Connect &amp; bootstrap demo actors</h2>
    <label for="adminKey">Admin key (from ACORN_SIGNAL_ADMIN_KEY)</label>
    <div class="row">
      <div><input id="adminKey" value="dev-admin" autocomplete="off"></div>
      <button class="primary" id="bootstrapBtn">Bootstrap</button>
    </div>
    <div class="status" id="bootStatus">Registers tenant “demo” actors: an ingest connector,
      a category-confined AI triage bot (complaints only, no PII), and a human operator (full access).</div>
  </div>

  <div class="card">
    <h2><span class="step">2</span>Ingest a customer communication</h2>
    <div class="samples" id="samples"></div>
    <div class="row">
      <div><label>Channel</label>
        <select id="channel">
          <option>email</option><option>sms</option><option>chat</option>
          <option>voice</option><option>letter</option><option>portal</option>
        </select></div>
      <div><label>Direction</label>
        <select id="direction"><option>inbound</option><option>outbound</option></select></div>
    </div>
    <label>Subject</label>
    <input id="subject" value="">
    <label>Message content</label>
    <textarea id="content"></textarea>
    <div class="row" style="margin-top:12px">
      <button class="primary" id="ingestBtn" disabled>Ingest &rarr; seal Outcome Packet</button>
    </div>
    <div class="status" id="ingestStatus"></div>
  </div>

  <div class="card">
    <h2>Chain — tenant “demo”</h2>
    <div class="row" style="margin-bottom:8px">
      <button class="mini" id="auditBtn" disabled>Run chain audit</button>
      <span id="auditResult"></span>
    </div>
    <div id="chain" class="note">Nothing sealed yet.</div>
  </div>
</section>

<section>
  <div class="card">
    <h2><span class="step">3</span>Inspect the Outcome Packet</h2>
    <div class="row" style="justify-content:space-between">
      <div style="flex:0 0 auto">
        <span class="note">Viewing as&nbsp;</span>
        <span class="seg">
          <button id="asOperator" class="on">Human operator</button>
          <button id="asBot">AI triage bot</button>
        </span>
      </div>
      <div style="flex:0 0 auto" class="row">
        <button class="mini" id="verifyBtn" disabled>Verify integrity</button>
        <button class="mini" id="jsonBtn" disabled>Raw JSON</button>
      </div>
    </div>
    <div class="status" id="packetStatus">Ingest a communication to see its packet here.</div>
    <div id="packet" class="hidden">
      <div class="row" style="margin:10px 0 6px">
        <span class="chip" id="pCategory"></span>
        <span class="chip" id="pStatus"></span>
        <span class="chip" id="pRedacted"></span>
      </div>
      <div class="kv" id="pIds"></div>
      <h2 style="margin-top:16px">Parties</h2>
      <table id="pParties"></table>
      <h2 style="margin-top:16px">Obligations (regulatory clock)</h2>
      <table id="pObligations"></table>
      <h2 style="margin-top:16px">Outcome actions</h2>
      <table id="pActions"></table>
      <h2 style="margin-top:16px">Integrity seal</h2>
      <div class="kv" id="pIntegrity"></div>
      <div class="checks" id="pChecks" style="margin-top:8px"></div>
      <pre id="pJson" class="hidden"></pre>
    </div>
  </div>
</section>
</main>
<script>
(function () {
  'use strict';
  var TENANT = 'demo';
  var state = { tokens: null, packetId: null, viewAs: 'operator', showJson: false };

  var SAMPLES = [
    { name: 'Complaint', subject: 'Formal complaint about my account',
      text: 'I wish to complain about the advice I was given last month. This is a formal grievance and I expect a full response.' },
    { name: 'Fraud report', subject: 'Unauthorised transaction',
      text: 'There is an unauthorised transaction of 450 on my card from yesterday. I think I have been scammed.' },
    { name: 'Data request', subject: 'GDPR request',
      text: 'Under GDPR I am making a subject access request. Please also delete all my data you no longer need.' },
    { name: 'Hardship', subject: 'Payment difficulties',
      text: 'I lost my job and I am struggling to pay this month. Could I get a payment plan or payment holiday?' },
    { name: 'Billing dispute', subject: 'Incorrect invoice',
      text: 'I was double-charged on my last invoice and I dispute this charge. Please issue a refund request.' },
    { name: 'Cancellation', subject: 'Cancel my subscription',
      text: 'Please cancel my subscription effective at the end of the billing period and close my account.' },
    { name: 'General', subject: 'Thanks',
      text: 'Just wanted to say thanks for the great service last week!' }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function short(h) { return h ? String(h).slice(0, 12) + '\\u2026' : '\\u2205'; }

  function api(method, path, body, auth) {
    var headers = { 'content-type': 'application/json' };
    if (auth && auth.admin) headers['x-admin-key'] = auth.admin;
    if (auth && auth.token) headers['authorization'] = 'Bearer ' + auth.token;
    return fetch(path, {
      method: method, headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) { var e = new Error(json.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
        return json;
      });
    });
  }

  function currentToken() {
    return state.viewAs === 'bot' ? state.tokens.bot : state.tokens.operator;
  }

  // --- health ---
  api('GET', '/v1/health').then(function (h) {
    $('health').textContent = h.pipeline;
  }).catch(function () { $('health').textContent = 'API unreachable'; });

  // --- samples ---
  SAMPLES.forEach(function (s, i) {
    var b = document.createElement('button');
    b.textContent = s.name;
    b.onclick = function () { $('subject').value = s.subject; $('content').value = s.text; };
    $('samples').appendChild(b);
    if (i === 0) b.onclick();
  });

  // --- bootstrap ---
  $('bootstrapBtn').onclick = function () {
    var admin = $('adminKey').value.trim();
    var st = $('bootStatus');
    st.className = 'status'; st.textContent = 'Registering actors\\u2026';
    var actors = [
      { id: 'demo-connector', name: 'Email connector', kind: 'service',
        scopes: ['communications:ingest'], allowedCategories: [], ownerId: 'ops' },
      { id: 'demo-triage-bot', name: 'Complaint triage agent', kind: 'ai_agent',
        scopes: ['packets:read', 'packets:verify', 'outcomes:act'],
        allowedCategories: ['complaint'], ownerId: 'ops-lead' },
      { id: 'demo-operator', name: 'Case operator', kind: 'human',
        scopes: ['packets:read', 'packets:verify', 'outcomes:act', 'pii:read'],
        allowedCategories: [], ownerId: 'demo-operator' }
    ];
    var chain = Promise.resolve();
    actors.forEach(function (a) {
      chain = chain.then(function () {
        a.tenantId = TENANT;
        return api('POST', '/v1/agents', a, { admin: admin }).catch(function (e) {
          if (String(e.message).indexOf('already registered') === -1) throw e;
        });
      });
    });
    chain.then(function () {
      return Promise.all([
        api('POST', '/v1/agents/demo-connector/tokens', { scopes: ['communications:ingest'] }, { admin: admin }),
        api('POST', '/v1/agents/demo-triage-bot/tokens', { scopes: ['packets:read', 'packets:verify', 'outcomes:act'] }, { admin: admin }),
        api('POST', '/v1/agents/demo-operator/tokens', { scopes: ['packets:read', 'packets:verify', 'outcomes:act', 'pii:read'] }, { admin: admin })
      ]);
    }).then(function (t) {
      state.tokens = { connector: t[0].token, bot: t[1].token, operator: t[2].token };
      st.textContent = 'Ready. Three actors registered for tenant \\u201cdemo\\u201d; scoped tokens issued.';
      $('ingestBtn').disabled = false; $('auditBtn').disabled = false;
      refreshChain();
    }).catch(function (e) {
      st.className = 'status err'; st.textContent = 'Bootstrap failed: ' + e.message;
    });
  };

  // --- ingest ---
  $('ingestBtn').onclick = function () {
    var st = $('ingestStatus');
    st.className = 'status'; st.textContent = 'Running pipeline\\u2026';
    api('POST', '/v1/communications', {
      tenantId: TENANT,
      channel: $('channel').value,
      direction: $('direction').value,
      parties: [
        { id: 'cust-42', role: 'customer', name: 'Jamie Doe', address: 'jamie@example.com' },
        { id: 'demo-co', role: 'institution' }
      ],
      subject: $('subject').value,
      content: $('content').value,
      metadata: { source: 'demo-console' }
    }, { token: state.tokens.connector }).then(function (r) {
      state.packetId = r.packet.payload.id;
      st.textContent = 'Sealed packet ' + r.packet.payload.id + ' at chain position ' + r.packet.integrity.sequence + '.';
      loadPacket(); refreshChain();
    }).catch(function (e) {
      st.className = 'status err'; st.textContent = e.message;
    });
  };

  // --- packet view ---
  $('asOperator').onclick = function () { setView('operator'); };
  $('asBot').onclick = function () { setView('bot'); };
  function setView(v) {
    state.viewAs = v;
    $('asOperator').className = v === 'operator' ? 'on' : '';
    $('asBot').className = v === 'bot' ? 'on' : '';
    if (state.packetId) loadPacket();
  }

  $('jsonBtn').onclick = function () {
    state.showJson = !state.showJson;
    $('pJson').className = state.showJson ? '' : 'hidden';
  };

  function loadPacket() {
    var st = $('packetStatus');
    st.className = 'status'; st.textContent = '';
    $('pChecks').innerHTML = '';
    api('GET', '/v1/tenants/' + TENANT + '/packets/' + state.packetId, undefined, { token: currentToken() })
      .then(function (r) { renderPacket(r.packet, r.redacted); })
      .catch(function (e) {
        $('packet').className = 'hidden';
        st.className = 'status err';
        st.textContent = (state.viewAs === 'bot' ? 'Denied for the AI triage bot: ' : 'Denied: ') + e.message +
          (e.status === 403 ? ' \\u2014 category confinement and scopes are enforced server-side.' : '');
      });
  }

  function renderPacket(p, redacted) {
    $('packet').className = '';
    $('verifyBtn').disabled = false; $('jsonBtn').disabled = false;
    var pay = p.payload;
    $('pCategory').textContent = pay.classification.category;
    var sChip = $('pStatus');
    sChip.textContent = pay.outcome.status;
    sChip.className = 'chip ' + (pay.outcome.status === 'resolved' ? 'ok'
      : pay.outcome.status === 'escalated' ? 'bad'
      : pay.outcome.status === 'action_required' ? 'warn' : '');
    $('pRedacted').textContent = redacted ? 'PII redacted' : 'full view';
    $('pRedacted').className = 'chip ' + (redacted ? 'warn' : 'ok');
    $('pIds').innerHTML = 'packet ' + esc(pay.id) +
      (pay.amends ? ' &middot; amends ' + esc(pay.amends) : '') +
      '<br>decided by ' + esc(pay.classification.decidedBy.join(', ')) +
      ' &middot; ' + esc(pay.outcome.determinedBy);

    var rows = '<tr><th>id</th><th>role</th><th>name</th><th>address</th></tr>';
    pay.communication.parties.forEach(function (x) {
      rows += '<tr><td>' + esc(x.id) + '</td><td>' + esc(x.role) + '</td><td>' +
        esc(x.name || '\\u2014') + '</td><td>' + esc(x.address || '\\u2014') + '</td></tr>';
    });
    $('pParties').innerHTML = rows;

    rows = '<tr><th>type</th><th>description</th><th>deadline</th></tr>';
    if (!pay.obligations.length) rows += '<tr><td colspan="3">none \\u2014 not a regulated category</td></tr>';
    pay.obligations.forEach(function (o) {
      rows += '<tr><td>' + esc(o.type) + '</td><td>' + esc(o.description) + '</td><td>' +
        esc(o.deadline ? o.deadline.slice(0, 16).replace('T', ' ') : 'no clock') + '</td></tr>';
    });
    $('pObligations').innerHTML = rows;

    rows = '<tr><th>action</th><th>status</th><th>completed by</th><th></th></tr>';
    if (!pay.outcome.actions.length) rows += '<tr><td colspan="4">no actions required</td></tr>';
    pay.outcome.actions.forEach(function (a, i) {
      rows += '<tr><td>' + esc(a.action) + '</td><td>' +
        (a.status === 'done' ? '<span class="chip ok">done</span>' : '<span class="chip warn">pending</span>') +
        '</td><td>' + esc(a.completedBy || '\\u2014') + '</td><td>' +
        (a.status === 'pending' ? '<button class="mini" data-idx="' + i + '">Complete</button>' : '') +
        '</td></tr>';
    });
    $('pActions').innerHTML = rows;
    Array.prototype.forEach.call($('pActions').querySelectorAll('button'), function (b) {
      b.onclick = function () { completeAction(parseInt(b.getAttribute('data-idx'), 10)); };
    });

    $('pIntegrity').innerHTML =
      'seq ' + p.integrity.sequence +
      ' &middot; payloadHash ' + esc(short(p.integrity.payloadHash)) +
      ' &middot; prev ' + esc(short(p.integrity.previousPacketHash)) +
      '<br>' + esc(p.integrity.signature.alg) + ' key ' + esc(short(p.integrity.signature.keyId)) +
      ' &middot; sig ' + esc(short(p.integrity.signature.value)) +
      (redacted ? '<br><em>redacted view \\u2014 will not byte-verify; the stored packet does</em>' : '');
    $('pJson').textContent = JSON.stringify(p, null, 2);
  }

  function completeAction(idx) {
    api('POST', '/v1/tenants/' + TENANT + '/packets/' + state.packetId + '/actions/' + idx + '/complete',
      {}, { token: currentToken() })
      .then(function () { loadPacket(); refreshChain(); })
      .catch(function (e) {
        $('packetStatus').className = 'status err';
        $('packetStatus').textContent = 'Complete failed: ' + e.message;
      });
  }

  $('verifyBtn').onclick = function () {
    api('GET', '/v1/tenants/' + TENANT + '/packets/' + state.packetId + '/verify',
      undefined, { token: currentToken() })
      .then(function (r) {
        var c = r.verification.checks;
        function mark(ok, label) {
          return '<span class="' + (ok ? '' : 'err') + '">' + (ok ? '\\u2713' : '\\u2717') + ' ' + label + '</span>';
        }
        $('pChecks').innerHTML =
          '<span class="chip ' + (r.verification.valid ? 'ok' : 'bad') + '">' +
          (r.verification.valid ? 'packet verifies' : 'verification FAILED') + '</span> ' +
          mark(c.payloadHash, 'payload hash') + mark(c.signature, 'Ed25519 signature') + mark(c.chainLink, 'chain link');
      })
      .catch(function (e) {
        $('pChecks').innerHTML = '<span class="chip bad">' + esc(e.message) + '</span>';
      });
  };

  // --- chain ---
  function refreshChain() {
    api('GET', '/v1/tenants/' + TENANT + '/packets', undefined, { token: state.tokens.operator })
      .then(function (r) {
        if (!r.packets.length) { $('chain').textContent = 'Nothing sealed yet.'; return; }
        var html = '';
        r.packets.forEach(function (s) {
          html += '<div class="chain-item">' +
            '<span class="seq">#' + s.sequence + '</span>' +
            '<a data-id="' + esc(s.id) + '">' + esc(s.id.slice(0, 14)) + '\\u2026</a>' +
            '<span class="chip">' + esc(s.category) + '</span>' +
            '<span class="chip ' + (s.status === 'resolved' ? 'ok' : s.status === 'escalated' ? 'bad'
              : s.status === 'action_required' ? 'warn' : '') + '">' + esc(s.status) + '</span>' +
            (s.amends ? '<span class="note">amends ' + esc(s.amends.slice(0, 14)) + '\\u2026</span>' : '') +
            '<span class="hash">' + esc(short(s.previousPacketHash)) + ' \\u2192 ' + esc(short(s.payloadHash)) + '</span>' +
            '</div>';
        });
        $('chain').innerHTML = html;
        Array.prototype.forEach.call($('chain').querySelectorAll('a'), function (a) {
          a.onclick = function () { state.packetId = a.getAttribute('data-id'); loadPacket(); };
        });
      })
      .catch(function (e) { $('chain').textContent = 'Chain unavailable: ' + e.message; });
  }

  $('auditBtn').onclick = function () {
    api('GET', '/v1/tenants/' + TENANT + '/audit', undefined, { token: state.tokens.operator })
      .then(function (r) {
        $('auditResult').innerHTML = r.audit.valid
          ? '<span class="chip ok">chain valid \\u00b7 ' + r.audit.packetCount + ' packets</span>'
          : '<span class="chip bad">BROKEN at ' + esc(r.audit.brokenAt.join(', ')) + '</span>';
      })
      .catch(function (e) {
        $('auditResult').innerHTML = '<span class="chip bad">' + esc(e.message) + '</span>';
      });
  };
})();
</script>
</body>
</html>
`;
