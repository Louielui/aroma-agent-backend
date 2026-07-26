'use strict'

// demoHtml — ONE self-contained, same-origin HTML page for the B2-2 demo.
// Security invariants (asserted by demoRouter.test.js):
//   * no external URL / CDN / font / analytics; same-origin fetch to /api/v1/demo/intake only
//   * no localStorage / sessionStorage / cookie / service worker
//   * all model/user text rendered via textContent / createElement — never innerHTML/eval
//   * Enter sends, Shift+Enter = newline; send disabled while pending; no auto-retry
//   * conversation history kept in-memory only (page refresh clears it)
//   * three EXPLICIT mode controls (no intent guessing)
// NOTE: the browser <script> below deliberately avoids backticks and ${...} so this
//       module-level template string stays literal.

const DEMO_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>香香 Conversation Demo</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 18px; }
  #log { border: 1px solid #ccc; border-radius: 8px; padding: 12px; min-height: 320px; margin-bottom: 12px; overflow-y: auto; }
  .bubble { padding: 8px 12px; border-radius: 10px; margin: 6px 0; white-space: pre-wrap; }
  .user { background: #e8f0fe; }
  .bot { background: #f1f1f1; }
  .err { background: #fdecea; color: #7a1c12; }
  .card { border: 1px solid #ddd; border-radius: 10px; padding: 10px; margin: 6px 0; }
  .label { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 6px; background: #eee; margin-right: 6px; }
  .k { color: #666; font-size: 12px; }
  #modes button { margin-right: 6px; padding: 6px 10px; border-radius: 8px; border: 1px solid #bbb; cursor: pointer; background: #fff; }
  #modes button.active { background: #D97757; color: #fff; border-color: #D97757; }
  #composer { display: flex; gap: 8px; margin-top: 8px; }
  textarea { flex: 1; min-height: 56px; font: inherit; padding: 8px; border-radius: 8px; border: 1px solid #bbb; }
  #send { padding: 8px 16px; border-radius: 8px; border: none; background: #D97757; color: #fff; cursor: pointer; }
  #send[disabled] { opacity: .5; cursor: default; }
  button[disabled].confirm { opacity: .5; cursor: default; }
  .order { border: 2px solid #D97757; border-radius: 10px; padding: 14px 16px; margin: 8px 0; line-height: 1.7; }
  .order-h { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
  .sec-t { font-size: 12px; color: #6b665d; margin-top: 10px; }
  .sec-b { white-space: pre-wrap; }
  .order details { margin-top: 12px; }
  .order summary { font-size: 12px; color: #6b665d; cursor: pointer; }
  .order pre { white-space: pre-wrap; font: 12px/1.6 ui-monospace, monospace; margin: 8px 0 0; }
  .act { margin-top: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .result { margin-top: 14px; border-top: 1px solid #ece6da; padding-top: 10px; }
  button.reject { padding: 6px 12px; border-radius: 8px; border: 1px solid #bbb; background: #fff; cursor: pointer; }
  button[disabled].reject { opacity: .5; cursor: default; }
  .hash { font: 11px ui-monospace, monospace; color: #666; word-break: break-all; }
  .typed { font: inherit; padding: 6px; border-radius: 6px; border: 1px solid #bbb; width: 14em; }
</style>
</head>
<body>
  <h1>香香 Conversation Demo（本機示範）</h1>
  <div id="log" aria-live="polite"></div>
  <div id="modes">
    <button type="button" data-mode="chat" class="active">聊天</button>
    <button type="button" data-mode="email_draft">寫 Email</button>
    <button type="button" data-mode="proposal">建立提案</button>
  </div>
  <div id="composer">
    <textarea id="msg" placeholder="輸入訊息，Enter 送出，Shift+Enter 換行"></textarea>
    <button id="send" type="button">送出</button>
  </div>
<script>
(function () {
  'use strict';
  var log = document.getElementById('log');
  var msg = document.getElementById('msg');
  var send = document.getElementById('send');
  var modeButtons = document.querySelectorAll('#modes button');
  var currentMode = 'chat';
  var history = []; // in-memory only; refresh clears
  var pending = false;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function scroll() { log.scrollTop = log.scrollHeight; }
  function addBubble(cls, text) { var b = el('div', 'bubble ' + cls, text); log.appendChild(b); scroll(); return b; }
  // DEFECT (b): a red error from an earlier failed attempt used to stay on screen after a
  // later success, so the Owner could not tell which message was current. Any new card
  // clears the previous errors first.
  function clearErrors() {
    var olds = log.querySelectorAll('.bubble.err');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
  }
  function labels(card, arr) { var row = el('div'); for (var i = 0; i < arr.length; i++) row.appendChild(el('span', 'label', arr[i])); card.appendChild(row); }
  function kv(card, key, val) { var p = el('div'); p.appendChild(el('span', 'k', key + '：')); p.appendChild(el('span', null, (val === null || val === undefined || val === '') ? '（無）' : val)); card.appendChild(p); }

  for (var i = 0; i < modeButtons.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        currentMode = btn.getAttribute('data-mode');
        for (var j = 0; j < modeButtons.length; j++) modeButtons[j].classList.remove('active');
        btn.classList.add('active');
      });
    })(modeButtons[i]);
  }

  function renderU1(res) {
    var card = el('div', 'card');
    labels(card, ['SHADOW_ONLY', '未寄出', '未寫入記憶']);
    var u = res.understanding || {};
    var r = u.recipient || {};
    if (res.mode === 'ask') {
      card.appendChild(el('div', null, '需要更多資訊：'));
      card.appendChild(el('div', 'bubble bot', res.clarifyingQuestion || '（未提供問題）'));
    } else {
      kv(card, '收件人', r.name);
      kv(card, 'Email', r.email); // stays null when not grounded
      kv(card, '目的', u.purpose && u.purpose.value);
      kv(card, '理解', res.restatement);
      var d = res.draft || {};
      kv(card, '主旨', d.subject);
      var body = el('div'); body.appendChild(el('span', 'k', '內文：')); body.appendChild(el('div', 'bubble bot', d.body || '（無）')); card.appendChild(body);
      kv(card, '語氣', d.tone);
    }
    log.appendChild(card); scroll();
  }

  function renderProposal(res) {
    var card = el('div', 'card');
    if (res.reply) card.appendChild(el('div', 'bubble bot', res.reply));
    var proposals = Array.isArray(res.proposals) ? res.proposals : [];
    if (proposals.length && proposals[0] && proposals[0].id) {
      kv(card, '提案編號', proposals[0].id);
      kv(card, '狀態', proposals[0].status || 'pending');
    } else if (res.demoOutcome === 'clarification') {
      card.appendChild(el('div', 'k', '尚未建立任何提案（需澄清）。'));
    }
    labels(card, ['Proposal only — not run']);

    // The chat lane REMAINS propose-only: it can never execute and never seals a Work
    // Order by itself. This button only ASKS the server to build + seal one for review;
    // execution still needs the sealed card, the typed confirmation and the nonce below.
    if (proposals.length && proposals[0] && proposals[0].id) {
      var pid = proposals[0].id;
      var goal = proposals[0].task || res.reply || '';
      var fileRow = el('div');
      var fileIn = el('input', 'typed'); fileIn.setAttribute('type', 'text');
      // DEFECT (a): the placeholder used to BE the required value, so an empty field
      // looked filled. It is now an instruction, and the button stays disabled until the
      // field genuinely holds something.
      fileIn.setAttribute('placeholder', '請輸入要改的檔案路徑');
      fileIn.setAttribute('aria-label', '要改的單一檔案路徑');
      var intentIn = el('input', 'typed'); intentIn.setAttribute('type', 'text');
      intentIn.setAttribute('placeholder', '請輸入你想改成甚麼（可留空）');
      intentIn.setAttribute('aria-label', '香香打算改成甚麼');
      var mk = el('button', 'confirm', '產生工作單（仍需你批准）');
      mk.setAttribute('type', 'button');
      mk.disabled = true;
      fileIn.addEventListener('input', function () { mk.disabled = fileIn.value.trim() === ''; });
      fileRow.appendChild(fileIn); fileRow.appendChild(intentIn); fileRow.appendChild(mk);
      card.appendChild(fileRow);
      mk.addEventListener('click', function () {
        if (mk.disabled) return;
        requestWorkOrder(goal, fileIn.value.trim(), null, pid, intentIn.value.trim());
      });
    }
    log.appendChild(card); scroll();
  }

  // ── OWNER APPROVAL CARD ────────────────────────────────────────────────────
  // The card is a VIEWER plus four fields of INTENT. It never builds, edits or stores a
  // Work Order: everything shown comes from the server's sealed record (res.lines), and
  // approving posts exactly approvalId + workOrderHash + nonce + typedConfirmation. The
  // page holds no token; nothing here can widen what will run.
  function renderApprovalCard(sealed) {
    clearErrors(); // DEFECT (b): a stale red error must not sit above a fresh card
    var c = sealed.card || { heading: '', sections: [], actions: ['批准測試', '拒絕'], technicalTitle: '技術細節' };
    var card = el('div', 'order');
    card.appendChild(el('div', 'order-h', c.heading));

    var secs = Array.isArray(c.sections) ? c.sections : [];
    for (var i = 0; i < secs.length; i++) {
      card.appendChild(el('div', 'sec-t', secs[i].title));
      card.appendChild(el('div', 'sec-b', secs[i].body));
    }

    // ▸ 技術細節 — collapsed by default. Collapsing is PRESENTATION ONLY: the same sealed
    // values, hidden or shown, and nothing here travels back to the server.
    var det = document.createElement('details');
    var sum = document.createElement('summary');
    sum.textContent = c.technicalTitle || '技術細節';
    det.appendChild(sum);
    var tech = el('pre'); tech.textContent = (sealed.technicalLines || []).join('\\n');
    det.appendChild(tech);
    card.appendChild(det);

    var row = el('div', 'act');
    var typed = el('input', 'typed'); typed.setAttribute('type', 'text');
    // DEFECT (a): instruction, never the required value itself.
    typed.setAttribute('placeholder', '請輸入 ' + sealed.typedConfirmationRequired + ' 以確認');
    typed.setAttribute('aria-label', '請輸入 ' + sealed.typedConfirmationRequired + ' 以確認');
    var go = el('button', 'confirm', (c.actions && c.actions[0]) || '批准測試');
    go.setAttribute('type', 'button');
    go.disabled = true; // enabled only on an EXACT match — no accidental approval
    var no = el('button', 'reject', (c.actions && c.actions[1]) || '拒絕');
    no.setAttribute('type', 'button');
    var out = el('div', 'k');
    typed.addEventListener('input', function () {
      go.disabled = (typed.value !== sealed.typedConfirmationRequired);
    });
    row.appendChild(typed); row.appendChild(go); row.appendChild(no);
    card.appendChild(row); card.appendChild(out);
    log.appendChild(card); scroll();

    no.addEventListener('click', function () {
      go.disabled = true; typed.disabled = true; no.disabled = true;
      out.textContent = '你拒絕了這張工作單。甚麼都沒有執行。';
    });

    go.addEventListener('click', function () {
      if (go.disabled) return;
      go.disabled = true; // one click only; the nonce is single-use server-side anyway
      fetch('/api/v1/owner/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          approvalId: sealed.approvalId,
          workOrderHash: sealed.workOrderHash,
          nonce: sealed.nonce,
          typedConfirmation: typed.value
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
      }).then(function (o) {
        typed.disabled = true; no.disabled = true;
        if (o.status === 201) {
          out.textContent = (o.body.dispatchStatus === 'agent_execute_accepted')
            ? '已批准，香香開始在丟棄式副本內嘗試。'
            : '已批准（提案已確認），但執行通道未開啟，所以甚麼都沒有跑。';
          requestResult(sealed.approvalId, card);
          return;
        }
        out.textContent = '被拒絕：' + (o.body.reason || o.body.error || '未知原因') + '（這張單已作廢，請重新產生）';
      }).catch(function () { out.textContent = '連線失敗（這張單已作廢，請重新產生）'; });
    });
  }

  // ── LAYER 2: the result view (read-only) ───────────────────────────────────
  // Asks the server what actually happened. Purely a read: it approves nothing, and
  // adopting a result is NOT a thing this page can do.
  function requestResult(approvalId, host) {
    fetch('/api/v1/owner/results/' + encodeURIComponent(approvalId), { credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
      }).then(function (o) {
        var box = el('div', 'result');
        if (o.status !== 200) {
          box.appendChild(el('div', 'k', '尚未有執行結果可看。'));
        } else {
          box.appendChild(el('div', 'sec-t', '執行結果'));
          var s = Array.isArray(o.body.sections) ? o.body.sections : [];
          for (var i = 0; i < s.length; i++) {
            box.appendChild(el('div', 'sec-t', s[i].title));
            box.appendChild(el('div', 'sec-b', s[i].body));
          }
        }
        host.appendChild(box); scroll();
      }).catch(function () { /* a missing result view is never an error the Owner must act on */ });
  }

  // Ask the SERVER to build + seal a Work Order from what the conversation proposed. The
  // server validates it, reads the file's CURRENT content, assigns approvalId/branch/caps,
  // and returns the card + hash. It refuses outright if the file does not exist.
  function requestWorkOrder(goal, candidateFile, testCommand, proposalId, intendedChange) {
    clearErrors(); // DEFECT (b)
    fetch('/api/v1/owner/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ goal: goal, candidateFile: candidateFile, allowedTestCommand: testCommand, proposalId: proposalId, intendedChange: intendedChange, conversation: historyText() })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
    }).then(function (o) {
      if (o.status === 201) { renderApprovalCard(o.body); return; }
      // DEFECT (c): reasonForOwner already opens with 未能建立工作單 — never prefix it again.
      addBubble('err', o.body.reasonForOwner || ('未能建立工作單：' + (o.body.reason || o.body.error || '未知原因')));
    }).catch(function () { addBubble('err', '連線失敗（未建立任何工作單）。'); });
  }

  function historyText() {
    var out = [];
    for (var i = 0; i < history.length; i++) out.push(String(history[i].text || ''));
    return out;
  }

  function render(status, res) {
    res = res || {};
    if (status === 403) { addBubble('err', '示範功能未啟用（demo_disabled）。'); return; }
    if (status === 400) { addBubble('err', '輸入無效，請檢查訊息或模式。'); return; }
    if (status >= 500 || (res.error && !res.blocked)) {
      var m = (res.error && res.error.message) ? res.error.message : '系統暫時無法處理這個請求。';
      addBubble('err', m + '（可重新送出）'); return;
    }
    // explicit-field discrimination (no keyword matching)
    if (res.blocked === true) { addBubble('bot', res.reply || ''); addBubble('bot', '（未送外部模型，未執行任何動作）'); return; }
    if (res.stage === 'SHADOW_ONLY') { renderU1(res); return; }
    if (res.demoOutcome === 'execution_proposal' || res.demoOutcome === 'clarification') { renderProposal(res); return; }
    if (res.talkOnly === true) { addBubble('bot', res.reply || ''); return; }
    if (res.mode === 'chat' || res.mode === 'ask' || res.mode === 'recommend') { addBubble('bot', res.reply || ''); return; }
    // unknown shape → safe fallback (requestId only)
    addBubble('err', '收到回應但格式未知。requestId: ' + (res.requestId || '（無）'));
  }

  function setPending(p) { pending = p; send.disabled = p; msg.disabled = p; }

  function submit() {
    if (pending) return;
    var text = msg.value.trim();
    if (!text) return;
    addBubble('user', text);
    history.push({ role: 'user', text: text });
    msg.value = '';
    setPending(true);
    fetch('/api/v1/demo/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, interactionMode: currentMode, history: history })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
    }).then(function (o) {
      render(o.status, o.body);
      if (o.body && o.body.reply) history.push({ role: 'assistant', text: o.body.reply });
    }).catch(function () {
      addBubble('err', '連線失敗（可重新送出）。'); // no auto-retry
    }).then(function () { setPending(false); });
  }

  send.addEventListener('click', submit);
  msg.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
})();
</script>
</body>
</html>`

module.exports = { DEMO_HTML }
