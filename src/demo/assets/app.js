/* 香香 UI — Stage A client.
 *
 * SECURITY INVARIANTS (asserted by demoRouter.test.js — do not weaken).
 * The test scans this file as raw text for the forbidden APIs, so the rules below are
 * described rather than spelled out; writing the literal names here would trip its own
 * guard. Any wording change must keep the guard passing.
 *   - markup is never assembled from strings and code is never evaluated from strings;
 *     every node is built with createElement + textContent, so nothing a model or a
 *     read-lane document says can become markup
 *   - no external URL, CDN, font or image; same-origin fetch only
 *   - no browser-side persistence of any kind; conversations live in memory and a
 *     refresh clears them (the safe direction)
 *   - the approval POST carries EXACTLY four fields; no Work Order field ever travels
 *     from the browser, and the collapsed technical section is presentation only
 *   - progress comes from the server's fixed phase vocabulary — raw agent output is
 *     never requested, received or rendered
 */
(function () {
  'use strict'

  var log = document.getElementById('log')
  var msg = document.getElementById('msg')
  var send = document.getElementById('send')
  var convsEl = document.getElementById('convs')
  var titleEl = document.getElementById('conv-title')
  var sidebar = document.getElementById('sidebar')
  var modeButtons = document.querySelectorAll('#modes button')
  var picker = document.getElementById('picker')
  var pickerLabel = document.getElementById('picker-label')
  var pickerMenu = document.getElementById('picker-menu')

  // THE PROVIDER PICK IS A HINT, NOT AUTHORITY. It is sent as one field; the server
  // validates it against its own closed allowlist and ignores anything else. The page
  // cannot select a lane, a model id, a context source or anything executable.
  //
  // The context asymmetry is stated ON THE OPTION, not hidden in a tooltip: by the
  // Owner's own v0 boundary the GPT prompt is captured BEFORE the read-context and
  // decision-recall blocks are prepended, so GPT is structurally blind to them. Unsaid,
  // a thinner GPT answer reads as "worse model" when it is "blinder by design".
  var PROVIDERS = [
    { id: 'claude', name: '香香（Claude）', note: '睇到 Drive／Gmail／日曆／GitHub 同過往決定', warn: false },
    { id: 'openai', name: '香香（GPT）', note: '睇唔到 Drive／Gmail／日曆／GitHub 同過往決定 —— 佢只收到你今次講嘅嘢', warn: true }
  ]
  var provider = 'claude'

  var pending = false
  var convs = []      // [{ id, title, mode, history: [{role,text}], thread: HTMLElement }]
  var active = null

  /* ── tiny DOM helpers ─────────────────────────────────────────────────── */
  function el (tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined && text !== null) n.textContent = String(text)
    return n
  }
  function clear (node) { while (node.firstChild) node.removeChild(node.firstChild) }
  function scroll () { log.scrollTop = log.scrollHeight }

  /* ── markdown → DOM ───────────────────────────────────────────────────────
   * A deliberately small subset (headings, fenced + inline code, bold, italic, lists,
   * blockquote, rule, paragraphs). It BUILDS NODES; it never produces a markup string,
   * so there is no injection surface even for hostile model output. Anything it does
   * not recognise stays literal text — the safe failure. */
  function inline (parent, text) {
    var re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g
    var last = 0
    var m
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)))
      var tok = m[0]
      if (tok.charAt(0) === '`') parent.appendChild(el('code', null, tok.slice(1, -1)))
      else if (tok.slice(0, 2) === '**') parent.appendChild(el('strong', null, tok.slice(2, -2)))
      else parent.appendChild(el('em', null, tok.slice(1, -1)))
      last = m.index + tok.length
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)))
  }

  function renderMarkdown (text) {
    var root = el('div', 'md')
    var lines = String(text == null ? '' : text).split('\n')
    var i = 0
    var list = null
    var para = null

    function flushPara () {
      if (para && para.childNodes.length) root.appendChild(para)
      para = null
    }
    function flushList () { if (list) { root.appendChild(list); list = null } }

    while (i < lines.length) {
      var line = lines[i]

      if (line.slice(0, 3) === '```') {                       // fenced code
        flushPara(); flushList()
        var buf = []
        i++
        while (i < lines.length && lines[i].slice(0, 3) !== '```') { buf.push(lines[i]); i++ }
        i++
        var pre = el('pre')
        pre.appendChild(el('code', null, buf.join('\n')))
        root.appendChild(pre)
        continue
      }

      var h = line.match(/^(#{1,3})\s+(.*)$/)
      if (h) {
        flushPara(); flushList()
        var head = el('h' + h[1].length)
        inline(head, h[2])
        root.appendChild(head)
        i++; continue
      }

      if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
        flushPara(); flushList(); root.appendChild(el('hr')); i++; continue
      }

      var q = line.match(/^>\s?(.*)$/)
      if (q) {
        flushPara(); flushList()
        var bq = el('blockquote')
        inline(bq, q[1])
        root.appendChild(bq)
        i++; continue
      }

      var li = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/)
      if (li) {
        flushPara()
        var ordered = li[1].length > 1
        if (!list || (list.tagName === 'OL') !== ordered) { flushList(); list = el(ordered ? 'ol' : 'ul') }
        var item = el('li')
        inline(item, li[2])
        list.appendChild(item)
        i++; continue
      }

      if (line.trim() === '') { flushPara(); flushList(); i++; continue }

      flushList()
      if (!para) para = el('p')
      else para.appendChild(document.createTextNode('\n'))
      inline(para, line)
      i++
    }
    flushPara(); flushList()
    if (!root.childNodes.length) root.appendChild(el('p', null, ''))
    return root
  }

  /* ── conversations ────────────────────────────────────────────────────── */
  function newConversation (focus) {
    var thread = el('div', 'thread')
    var c = { id: 'c' + (convs.length + 1), title: '新對話', mode: 'chat', history: [], thread: thread }
    convs.unshift(c)
    selectConversation(c)
    renderConvList()
    if (focus !== false) msg.focus()
    return c
  }
  // An EMPTY conversation is not history yet. Listing it produced the duplicate the Owner
  // saw — 「新對話」 as the header and 「新對話」 again as a list entry, naming the same
  // nothing twice. A conversation joins the list once it actually holds a turn.
  function isListed (c) { return c.history.length > 0 }
  function selectConversation (c) {
    active = c
    clear(log)
    log.appendChild(c.thread)
    titleEl.textContent = isListed(c) ? c.title : '香香'
    setMode(c.mode, false)
    renderConvList()
    scroll()
  }
  function renderConvList () {
    clear(convsEl)
    for (var i = 0; i < convs.length; i++) {
      if (!isListed(convs[i])) continue
      (function (c) {
        var b = el('button', 'conv' + (c === active ? ' active' : ''), c.title)
        b.setAttribute('type', 'button')
        b.addEventListener('click', function () { selectConversation(c) })
        convsEl.appendChild(b)
      })(convs[i])
    }
  }
  function titleFrom (text) {
    var t = String(text).replace(/\s+/g, ' ').trim()
    return t.length > 24 ? t.slice(0, 24) + '…' : (t || '新對話')
  }

  /* ── message rendering ────────────────────────────────────────────────── */
  function turn (who) {
    var t = el('div', 'turn ' + who)
    if (who === 'bot') t.appendChild(el('div', 'avatar', '香'))
    var body = el('div', 'body')
    t.appendChild(body)
    active.thread.appendChild(t)
    scroll()
    return { root: t, body: body }
  }
  function addUser (text) {
    var t = turn('user')
    t.body.appendChild(el('div', null, text))
    return t
  }
  function addBot (text) {
    var t = turn('bot')
    t.body.appendChild(renderMarkdown(text))
    return t
  }
  function addError (text) {
    var t = turn('bot')
    t.body.appendChild(el('div', 'err-note', text))
    return t
  }
  function addMeta (host, text) { host.appendChild(el('div', 'meta', text)) }

  // A typing indicator the moment a message is sent — never a silent wait.
  function addTyping () {
    var t = turn('bot')
    var dots = el('div', 'typing')
    dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'))
    t.body.appendChild(dots)
    return t
  }
  // Stale red errors used to sit above fresh content, so the Owner could not tell which
  // message was current. Any new render clears them first.
  function clearErrors () {
    var olds = active.thread.querySelectorAll('.err-note')
    for (var i = 0; i < olds.length; i++) {
      var t = olds[i].parentNode && olds[i].parentNode.parentNode
      if (t && t.parentNode) t.parentNode.removeChild(t)
    }
  }

  /* ── modes ────────────────────────────────────────────────────────────── */
  function setMode (mode, store) {
    for (var i = 0; i < modeButtons.length; i++) {
      var b = modeButtons[i]
      if (b.getAttribute('data-mode') === mode) b.className = 'active'
      else b.className = ''
    }
    if (store !== false && active) active.mode = mode
  }
  for (var mi = 0; mi < modeButtons.length; mi++) {
    (function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode'), true) })
    })(modeButtons[mi])
  }

  /* ── send ─────────────────────────────────────────────────────────────── */
  function setPending (p) {
    pending = p
    msg.disabled = p
    // Send stays disabled while busy AND while the box is empty, so the button never
    // invites a click that would do nothing.
    send.disabled = p || msg.value.trim() === ''
    if (picker) picker.disabled = p
  }

  function submit () {
    if (pending) return
    var text = msg.value.trim()
    if (!text) return
    clearErrors()
    if (active.history.length === 0) {
      active.title = titleFrom(text)
      titleEl.textContent = active.title
      renderConvList()
    }
    addUser(text)
    active.history.push({ role: 'user', text: text })
    msg.value = ''
    autoGrow()
    setPending(true)
    var typing = addTyping()
    var conv = active

    fetch('/api/v1/demo/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ message: text, interactionMode: conv.mode, history: conv.history, providerHint: provider })
    }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } })
    }).then(function (o) {
      if (typing.root.parentNode) typing.root.parentNode.removeChild(typing.root)
      labelServedBy(render(o.status, o.body, conv), o.body)
      if (o.body && o.body.reply) conv.history.push({ role: 'assistant', text: o.body.reply })
      renderConvList() // the conversation has content now, so it enters the list
    }).catch(function () {
      if (typing.root.parentNode) typing.root.parentNode.removeChild(typing.root)
      addError('連線失敗，可以重新送出。')
    }).then(function () { setPending(false); scroll() })
  }

  function render (status, res, conv) {
    res = res || {}
    if (status === 403) return addError('示範功能未啟用（demo_disabled）。')
    if (status === 400) return addError('輸入無效，請檢查訊息或模式。')
    if (status >= 500 || (res.error && !res.blocked)) {
      return addError((res.error && res.error.message ? res.error.message : '系統暫時無法處理這個請求。') + '（可重新送出）')
    }
    if (res.blocked === true) {
      var b = addBot(res.reply || '')
      addMeta(b.body, '未送外部模型，未執行任何動作')
      return b
    }
    if (res.stage === 'SHADOW_ONLY') return renderDraft(res)
    if (res.demoOutcome === 'execution_proposal' || res.demoOutcome === 'clarification') return renderProposal(res, conv)
    if (res.talkOnly === true || res.mode === 'chat' || res.mode === 'ask' || res.mode === 'recommend') return addBot(res.reply || '')
    return addError('收到回應但格式未知。requestId: ' + (res.requestId || '（無）'))
  }

  // A pick is not a promise: if the chosen provider fails, the orchestrator falls back to
  // Claude, so the reply may not come from whoever the Owner selected. The label reads the
  // SERVER's report of what actually answered — never the local pick.
  function labelServedBy (t, res) {
    if (!t || !t.body || !res || typeof res.servedBy !== 'string') return
    var name = res.servedBy === 'openai' ? '香香（GPT）' : '香香（Claude）'
    t.body.appendChild(el('div', 'served' + (res.fallbackUsed ? ' fallback' : ''),
      res.fallbackUsed ? ('由 ' + name + ' 回答（你揀嘅嗰個失敗咗，已自動改用佢）') : ('由 ' + name + ' 回答')))
  }

  function renderDraft (res) {
    var t = turn('bot')
    var d = res.draft || {}
    t.body.appendChild(el('div', 'sec-t', '草稿（未寄出）'))
    if (d.subject) t.body.appendChild(el('div', 'sec-b', '主旨：' + d.subject))
    t.body.appendChild(renderMarkdown(d.body || '（無內文）'))
    addMeta(t.body, 'SHADOW_ONLY · 未寄出 · 未寫入記憶')
  }

  function renderProposal (res, conv) {
    var t = turn('bot')
    if (res.reply) t.body.appendChild(renderMarkdown(res.reply))
    var proposals = Array.isArray(res.proposals) ? res.proposals : []
    if (!proposals.length || !proposals[0] || !proposals[0].id) {
      addMeta(t.body, '尚未建立任何提案')
      return
    }
    var pid = proposals[0].id
    var goal = proposals[0].task || res.reply || ''
    addMeta(t.body, '提案 ' + pid + ' · 只是提案，未執行')

    var row = el('div', 'act')
    var fileIn = el('input', 'typed')
    fileIn.setAttribute('type', 'text')
    fileIn.setAttribute('placeholder', '請輸入要改的檔案路徑')
    fileIn.setAttribute('aria-label', '要改的單一檔案路徑')
    var intentIn = el('input', 'typed')
    intentIn.setAttribute('type', 'text')
    intentIn.setAttribute('placeholder', '想改成甚麼（可留空）')
    intentIn.setAttribute('aria-label', '打算改成甚麼')
    var mk = el('button', 'primary', '產生工作單')
    mk.setAttribute('type', 'button')
    mk.disabled = true
    fileIn.addEventListener('input', function () { mk.disabled = fileIn.value.trim() === '' })
    row.appendChild(fileIn); row.appendChild(intentIn); row.appendChild(mk)
    t.body.appendChild(row)

    mk.addEventListener('click', function () {
      if (mk.disabled) return
      mk.disabled = true
      requestWorkOrder(goal, fileIn.value.trim(), null, pid, intentIn.value.trim(), conv)
    })
  }

  /* ── the Owner decision card ──────────────────────────────────────────── */
  function requestWorkOrder (goal, candidateFile, testCommand, proposalId, intendedChange, conv) {
    clearErrors()
    fetch('/api/v1/owner/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        goal: goal, candidateFile: candidateFile, allowedTestCommand: testCommand,
        proposalId: proposalId, intendedChange: intendedChange, conversation: historyText(conv)
      })
    }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } })
    }).then(function (o) {
      if (o.status === 201) { renderCard(o.body) ; return }
      // reasonForOwner already opens with 未能建立工作單 — never prefix it again.
      addError(o.body.reasonForOwner || ('未能建立工作單：' + (o.body.reason || o.body.error || '未知原因')))
    }).catch(function () { addError('連線失敗（未建立任何工作單）。') })
  }

  function historyText (conv) {
    var out = []
    for (var i = 0; i < conv.history.length; i++) out.push(String(conv.history[i].text || ''))
    return out
  }

  function renderCard (sealed) {
    clearErrors()
    var c = sealed.card || { heading: '', sections: [], actions: ['批准測試', '拒絕'], technicalTitle: '技術細節' }
    var t = turn('bot')
    var card = el('div', 'order')
    card.appendChild(el('h2', null, c.heading))

    var secs = Array.isArray(c.sections) ? c.sections : []
    for (var i = 0; i < secs.length; i++) {
      var s = el('div', 'sec')
      s.appendChild(el('div', 'sec-t', secs[i].title))
      var isExcerpt = secs[i].title.indexOf('現時內容') === 0
      s.appendChild(el('div', 'sec-b' + (isExcerpt ? ' mono' : ''), secs[i].body))
      card.appendChild(s)
    }

    // ▸ 技術細節 — collapsed by default. Presentation only: the same sealed values,
    // hidden or shown, and nothing here travels back to the server.
    var det = document.createElement('details')
    det.className = 'tech'
    var sum = document.createElement('summary')
    sum.textContent = c.technicalTitle || '技術細節'
    det.appendChild(sum)
    det.appendChild(el('pre', null, (sealed.technicalLines || []).join('\n')))
    card.appendChild(det)

    var act = el('div', 'act')
    var typed = el('input', 'typed')
    typed.setAttribute('type', 'text')
    typed.setAttribute('placeholder', '請輸入 ' + sealed.typedConfirmationRequired + ' 以確認')
    typed.setAttribute('aria-label', '請輸入 ' + sealed.typedConfirmationRequired + ' 以確認')
    var go = el('button', 'primary', (c.actions && c.actions[0]) || '批准測試')
    go.setAttribute('type', 'button')
    go.disabled = true                                  // exact match only — no misclick
    var no = el('button', 'ghost', (c.actions && c.actions[1]) || '拒絕')
    no.setAttribute('type', 'button')
    var out = el('div', 'meta')
    typed.addEventListener('input', function () { go.disabled = (typed.value !== sealed.typedConfirmationRequired) })
    act.appendChild(typed); act.appendChild(go); act.appendChild(no)
    card.appendChild(act); card.appendChild(out)
    t.body.appendChild(card)
    scroll()

    no.addEventListener('click', function () {
      go.disabled = true; typed.disabled = true; no.disabled = true
      out.textContent = '你拒絕了這張工作單。甚麼都沒有執行。'
    })

    go.addEventListener('click', function () {
      if (go.disabled) return
      go.disabled = true
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
        return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } })
      }).then(function (o) {
        typed.disabled = true; no.disabled = true
        if (o.status === 201) {
          if (o.body.dispatchStatus === 'agent_execute_accepted') {
            out.textContent = '已批准。香香開始喺丟棄式副本入面做。'
            watchProgress(sealed.approvalId, card, sealed)
          } else {
            out.textContent = '已批准：工作單已確認，但執行通道未開啟，所以甚麼都冇跑過。'
          }
          return
        }
        out.textContent = '被拒絕：' + (o.body.reason || o.body.error || '未知原因') + '（這張單已作廢，請重新產生）'
      }).catch(function () { out.textContent = '連線失敗（這張單已作廢，請重新產生）' })
    })
  }

  /* ── live progress + result (the fix for "nothing seemed to happen") ─────
   * The page used to ask for the result ONCE, milliseconds after approving — before the
   * runner had even cloned — get a 404, and never ask again. Now it polls until the run
   * reaches a terminal state, showing the server's phase and elapsed-vs-cap meanwhile.
   * It only ever reads: no nonce, no approval, nothing re-triggered. */
  var POLL_MS = 1500
  var POLL_GRACE_MS = 20000

  function watchProgress (approvalId, card, sealed) {
    var box = el('div', 'progress')
    var row = el('div', 'phase-row')
    var spin = el('div', 'spin')
    var label = el('span', null, '正在開始…')
    row.appendChild(spin); row.appendChild(label)
    var bar = el('div', 'bar'); var fill = el('i'); bar.appendChild(fill)
    var elapsedEl = el('div', 'elapsed', '')
    box.appendChild(row); box.appendChild(bar); box.appendChild(elapsedEl)
    card.appendChild(box)
    scroll()

    var capMs = null
    var stopped = false

    function finish (state, body) {
      if (stopped) return
      stopped = true
      if (spin.parentNode) spin.parentNode.removeChild(spin)
      var mark = el('span', state === 'done' ? 'done-mark' : 'fail-mark', state === 'done' ? '✓' : '✕')
      row.insertBefore(mark, label)
      label.textContent = (body && body.headline) || (state === 'done' ? '完成' : '未成功')
      if (body && Array.isArray(body.sections)) renderResult(card, body)
      scroll()
    }

    function tick () {
      if (stopped) return
      fetch('/api/v1/owner/results/' + encodeURIComponent(approvalId), { credentials: 'same-origin' })
        .then(function (r) {
          return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } })
        })
        .then(function (o) {
          if (stopped) return
          if (o.status !== 200) { setTimeout(tick, POLL_MS); return }
          var b = o.body
          if (b.capSec && capMs === null) capMs = b.capSec * 1000
          var lbl = null
          if (Array.isArray(b.phases) && b.phases.length) lbl = b.phases[b.phases.length - 1].label
          if (lbl) label.textContent = lbl
          if (typeof b.elapsedMs === 'number') {
            var secs = Math.floor(b.elapsedMs / 1000)
            elapsedEl.textContent = capMs
              ? ('已用 ' + secs + ' 秒 / 上限 ' + Math.round(capMs / 1000) + ' 秒')
              : ('已用 ' + secs + ' 秒')
            if (capMs) fill.style.width = Math.min(100, (b.elapsedMs / capMs) * 100) + '%'
          }
          if (b.finished === true || b.status === 'done' || b.status === 'failed' ||
              b.status === 'timeout' || b.status === 'refused') {
            finish(b.status === 'done' ? 'done' : 'fail', b)
            return
          }
          if (capMs && typeof b.elapsedMs === 'number' && b.elapsedMs > capMs + POLL_GRACE_MS) {
            // Past the cap plus a grace window with no terminal state: stop asking and say
            // so, rather than spinning forever and implying something is still happening.
            stopped = true
            if (spin.parentNode) spin.parentNode.removeChild(spin)
            label.textContent = '超過時限仍未收到結果 —— 請查伺服器記錄'
            return
          }
          setTimeout(tick, POLL_MS)
        })
        .catch(function () { if (!stopped) setTimeout(tick, POLL_MS) })
    }
    setTimeout(tick, 400)
  }

  function renderResult (card, body) {
    var box = el('div', 'result')
    box.appendChild(el('div', 'sec-t', '執行結果'))
    var s = Array.isArray(body.sections) ? body.sections : []
    for (var i = 0; i < s.length; i++) {
      var sec = el('div', 'sec')
      sec.appendChild(el('div', 'sec-t', s[i].title))
      var isDiff = s[i].title.indexOf('diff') >= 0 || s[i].title.indexOf('改動') === 0
      sec.appendChild(el('div', 'sec-b' + (isDiff ? ' mono' : ''), s[i].body))
      box.appendChild(sec)
    }
    card.appendChild(box)
  }

  /* ── provider picker ──────────────────────────────────────────────────── */
  function currentProvider () {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === provider) return PROVIDERS[i]
    return PROVIDERS[0]
  }
  function renderPicker () {
    pickerLabel.textContent = currentProvider().name
    clear(pickerMenu)
    for (var i = 0; i < PROVIDERS.length; i++) {
      (function (pv) {
        var b = el('button', 'opt' + (pv.id === provider ? ' active' : ''))
        b.setAttribute('type', 'button')
        b.setAttribute('role', 'option')
        b.setAttribute('aria-selected', pv.id === provider ? 'true' : 'false')
        b.appendChild(el('div', 'opt-name', pv.name + (pv.id === provider ? ' ✓' : '')))
        b.appendChild(el('div', 'opt-note' + (pv.warn ? ' warn' : ''), pv.note))
        b.addEventListener('click', function () {
          provider = pv.id
          closePicker()
          renderPicker()
        })
        pickerMenu.appendChild(b)
      })(PROVIDERS[i])
    }
  }
  function openPicker () { pickerMenu.className = ''; picker.setAttribute('aria-expanded', 'true') }
  function closePicker () { pickerMenu.className = 'hidden'; picker.setAttribute('aria-expanded', 'false') }
  picker.addEventListener('click', function (e) {
    e.stopPropagation()
    if (pickerMenu.className === 'hidden') openPicker(); else closePicker()
  })
  document.addEventListener('click', function () { closePicker() })
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePicker() })
  renderPicker()

  /* ── composer + sidebar chrome ────────────────────────────────────────── */
  function autoGrow () {
    msg.style.height = 'auto'
    msg.style.height = Math.min(msg.scrollHeight, 200) + 'px'
  }
  msg.addEventListener('input', function () {
    autoGrow()
    send.disabled = pending || msg.value.trim() === ''   // disabled until real input
  })
  send.addEventListener('click', submit)
  msg.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  })
  document.getElementById('new-chat').addEventListener('click', function () { newConversation(true) })
  document.getElementById('collapse').addEventListener('click', function () {
    sidebar.className = 'collapsed'
    document.getElementById('expand').className = 'icon-btn'
  })
  document.getElementById('expand').addEventListener('click', function () {
    sidebar.className = ''
    document.getElementById('expand').className = 'icon-btn hidden'
  })

  send.disabled = true
  autoGrow()
  newConversation(false)
  addBot('我係香香。有咩想傾，或者想我幫你做啲咩？\n\n想我改嘢就撳上面「建立提案」，我會出一張工作單畀你過目，**你批准咗我先會做**。')
})()
