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
    var confirm = el('button', 'confirm', '確認執行（尚未開放）');
    confirm.setAttribute('disabled', 'disabled');
    confirm.setAttribute('type', 'button');
    card.appendChild(confirm);
    log.appendChild(card); scroll();
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
