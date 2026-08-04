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
 *   - no browser-side persistence of any kind: no storage API is touched in this file.
 *     Since 2026-08-04 conversations DO survive a refresh, but they are held SERVER-side,
 *     behind the same owner session as this page — the browser itself still stores nothing
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
  var plus = document.getElementById('plus')
  var plusMenu = document.getElementById('plus-menu')
  var laneHint = document.getElementById('lane-hint')
  var picker = document.getElementById('picker')
  var pickerLabel = document.getElementById('picker-label')
  var pickerMenu = document.getElementById('picker-menu')

  // THE PROVIDER PICK IS A HINT, NOT AUTHORITY. It is sent as one field; the server
  // validates it against its own closed allowlist and ignores anything else. The page
  // cannot select a lane, a model id, a context source or anything executable.
  //
  // WHAT THE OPTION SAYS MUST BE TRUE. Until the Owner's second GO, GPT was denied the
  // read-context and decision-recall blocks and this note said so. That claim is now
  // FALSE — both providers receive the same context — and a stale claim about where his
  // data goes is worse than no claim at all. The note now states the thing that actually
  // matters when choosing: the same data, but a second vendor receives it.
  // contextAsymmetry.test.js pins that this stays true.
  // THE SOURCE NAMES ARE GENERATED, NOT TYPED. Injected at build time from the same
  // ALL_SOURCES the read layer uses (see demoHtml.js). The note used to list four by hand
  // and had gone stale: aroma_system — the restaurant's own system, the one he reads most —
  // was missing from a sentence whose whole job is to say where his data goes.
  var READ_SOURCES = /*READ_SOURCE_LABELS*/
  var SOURCE_TEXT = READ_SOURCES.join('／') + '同過往決定'

  var PROVIDERS = [
    { id: 'claude', name: '香香（Claude）', note: '睇到 ' + SOURCE_TEXT, warn: false },
    { id: 'openai', name: '香香（GPT）', note: '一樣睇到 ' + SOURCE_TEXT + ' —— 但呢啲資料會送去 OpenAI', warn: true }
  ]
  var provider = 'claude'
  // The lane of the turn just rendered. Sent back so a short reply like 「1」 continues
  // what was happening instead of arriving as a fresh, contentless input. It is a lane
  // NAME only; the server re-validates it and refuses to continue into the proposal lane.
  var previousLane = null

  var pending = false
  var convs = []      // [{ id, title, history: [{role,text}], thread: HTMLElement }]
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

      // A blank line ends a PARAGRAPH, but it does not necessarily end a list: models
      // routinely put a blank line between list items. Flushing the list here started a
      // NEW <ol> for every item, and every <ol> restarts at 1 — which is why every
      // numbered item rendered as "1.". Only flush the list when what follows is not
      // another item of the same list.
      if (line.trim() === '') {
        flushPara()
        var j = i + 1
        while (j < lines.length && lines[j].trim() === '') j++
        var next = j < lines.length ? lines[j].match(/^\s*([-*]|\d+\.)\s+/) : null
        if (!next || (list && (list.tagName === 'OL') !== (next[1].length > 1))) flushList()
        i++; continue
      }

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
    // A STABLE id for this conversation, for the Xiangxiang Lab archive.
    // 'c1'/'c2' is a counter that restarts at 1 on every page load, so two different
    // conversations on two different days would collide. This one does not collide, and it
    // is the ONLY thing the archive can use to group turns - the server sees nothing else.
    var cid = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : 'conv-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10)
    var c = { id: 'c' + (convs.length + 1), cid: cid, title: '新對話', history: [], thread: thread }
    convs.unshift(c)
    selectConversation(c)
    renderConvList()
    if (focus !== false) msg.focus()
    return c
  }
  // An EMPTY conversation is not history yet. Listing it produced the duplicate the Owner
  // saw — 「新對話」 as the header and 「新對話」 again as a list entry, naming the same
  // nothing twice. A conversation joins the list once it actually holds a turn.
  // A conversation joins the list once it holds a turn — or once the server says it has
  // one. An EMPTY new conversation is still not history: listing it produced the duplicate
  // the Owner saw, 「新對話」 as the header and 「新對話」 again as a list entry.
  function isListed (c) { return c.stored === true || c.history.length > 0 }
  function selectConversation (c) {
    active = c
    clear(log)
    log.appendChild(c.thread)
    titleEl.textContent = isListed(c) ? c.title : '香香'
    renderConvList()
    // A stored conversation is a title until it is opened; the transcript arrives here.
    if (c.stored && !c.loaded) loadConversation(c)
    scroll()
  }
  function renderConvList () {
    clear(convsEl)
    var lastGroup = null
    for (var i = 0; i < convs.length; i++) {
      if (!isListed(convs[i])) continue
      (function (c) {
        // 今日 / 尋日 / 更早 — a quiet label, only when the group changes.
        var g = groupLabel(convWhen(c))
        if (g !== lastGroup) {
          convsEl.appendChild(el('div', 'conv-group', g))
          lastGroup = g
        }

        var row = el('div', 'conv-row')

        // ALWAYS RENDERED, only the `on` class is conditional. A dot that appears and
        // disappears would shift every title sideways as replies come and go.
        var dot = el('span', 'conv-working' + (c.working ? ' on' : ''))
        dot.setAttribute('aria-hidden', 'true')
        row.appendChild(dot)

        var b = el('button', 'conv' + (c === active ? ' active' : ''), c.title)
        b.setAttribute('type', 'button')
        b.setAttribute('title', c.title)
        b.addEventListener('click', function () { selectConversation(c) })
        row.appendChild(b)

        var meta = el('div', 'conv-meta')
        var when = whenLabel(convWhen(c))
        if (when) meta.appendChild(el('span', null, when))
        var n = convCount(c)
        if (n > 0) meta.appendChild(el('span', null, String(n)))
        row.appendChild(meta)

        // DELETE, REVEALED ON HOVER OR KEYBOARD FOCUS. It used to sit inline in the list
        // looking like a list item of its own. It is still one confirm away from acting,
        // and it is focusable so it is reachable without a mouse.
        if (c.stored) {
          var d = el('button', 'icon-btn conv-del', '✕')
          d.setAttribute('type', 'button')
          d.setAttribute('aria-label', '刪除「' + c.title + '」')
          d.setAttribute('title', '刪除')
          d.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation()
            deleteConversation(c)
          })
          row.appendChild(d)
        }

        convsEl.appendChild(row)
      })(convs[i])
    }
  }
  function titleFrom (text) {
    var t = String(text).replace(/\s+/g, ' ').trim()
    return t.length > 30 ? t.slice(0, 30) + '…' : (t || '新對話')
  }

  /* ── history, from the server ─────────────────────────────────────────────
   * The sidebar had 「開新對話」 and nothing to go back to: a refresh or a new chat threw
   * the conversation away, because it only ever existed in this page. The transcripts now
   * live on the server (one file per conversation) and the page reads them.
   *
   * STILL NO BROWSER-SIDE PERSISTENCE. Nothing is written to the browser — no storage API
   * is touched anywhere in this file, and demoRouter.test.js scans for exactly that. The
   * durability is entirely server-side, behind the same owner session as this page. */
  function findConv (cid) {
    for (var i = 0; i < convs.length; i++) if (convs[i].cid === cid) return convs[i]
    return null
  }

  // A row in the list before its transcript has been fetched. `loaded` is what stops a
  // second click from appending the same transcript underneath the first.
  function stubFor (row) {
    return {
      id: 'h-' + row.id, cid: row.id, title: row.title || '新對話',
      updatedAt: row.updatedAt || row.createdAt || null,
      messageCount: row.messageCount || 0,
      history: [], thread: el('div', 'thread'), stored: true, loaded: false
    }
  }

  /* ── telling one conversation from another ────────────────────────────────
   * Two of the Owner's conversations had BYTE-IDENTICAL titles, because a title is just
   * the first message and he opened both the same way. The list showed three rows that
   * read the same, so "which one am I looking at" had no answer — and a transcript that
   * correctly showed him asking the same question twice looked like a duplication bug.
   * Time and turn count are what actually separate them. */
  function startOfDay (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }

  function whenLabel (iso) {
    if (!iso) return ''
    var d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    var days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
    if (days === 0) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    return (d.getMonth() + 1) + '月' + d.getDate() + '日'
  }

  function groupLabel (iso) {
    if (!iso) return '更早'
    var d = new Date(iso)
    if (isNaN(d.getTime())) return '更早'
    var days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
    return days === 0 ? '今日' : (days === 1 ? '尋日' : '更早')
  }

  /** The live conversation knows its own count; a stub is told by the server. */
  function convWhen (c) { return c.updatedAt || null }
  function convCount (c) { return c.history.length > 0 ? c.history.length : (c.messageCount || 0) }

  function bootHistory () {
    fetch('/api/v1/conversations', { credentials: 'same-origin' })
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (!j || !j.ok || !j.conversations) return
        for (var i = 0; i < j.conversations.length; i++) {
          var row = j.conversations[i]
          if (!row || !row.id || findConv(row.id)) continue
          // APPENDED, not unshifted: the server already sorted newest-first, and the empty
          // conversation the page opened with stays at the top where the Owner left it.
          convs.push(stubFor(row))
        }
        renderConvList()
      })
      .catch(function () { /* history is an addition; losing it must not break the page */ })
  }

  // `loaded` MEANS LOADED, and it used to mean "a fetch was started".
  //
  // It was set before the request, and the handler bailed out when the Owner had clicked
  // elsewhere — leaving that conversation marked loaded with an empty thread, so clicking
  // it again did nothing at all until a refresh. `inflight` is what stops a double fetch;
  // `loaded` is now set only once a transcript is actually in the thread.
  //
  // And the transcript is rendered whatever is on screen: it is THIS conversation's data
  // regardless of which pane the Owner is reading. Only the scroll is conditional, which
  // turn() already handles.
  function loadConversation (c) {
    if (c.loaded || c.inflight) return
    c.inflight = true
    fetch('/api/v1/conversations/' + encodeURIComponent(c.cid), { credentials: 'same-origin' })
      .then(function (r) { return r.json() })
      .then(function (j) {
        c.inflight = false
        if (!j || !j.ok || !j.conversation) {
          addError('讀唔到呢個對話，可以再撳一次。', c)
          return
        }
        var m = j.conversation.messages || []
        clear(c.thread)
        c.history = []
        for (var i = 0; i < m.length; i++) {
          var text = String(m[i] && m[i].content != null ? m[i].content : '')
          if (m[i] && m[i].role === 'user') {
            addUser(text, c)
            c.history.push({ role: 'user', text: text })
          } else {
            var t = addBot(text, c)
            // The same disclosure a live turn carries: who actually answered.
            if (m[i] && m[i].servedBy) labelServedBy(t, { servedBy: m[i].servedBy })
            c.history.push({ role: 'assistant', text: text })
          }
        }
        c.loaded = true
        if (c === active) scroll()
      })
      .catch(function () {
        c.inflight = false   // a failed load may be retried by clicking again
        addError('讀唔到呢個對話，可以再撳一次。', c)
      })
  }

  function deleteConversation (c) {
    // ASKS FIRST. A conversation is not deleted on a stray click, and there is no undo.
    if (!window.confirm('刪除「' + c.title + '」？呢個係永久嘅，冇得復原。')) return
    fetch('/api/v1/conversations/' + encodeURIComponent(c.cid), { method: 'DELETE', credentials: 'same-origin' })
      .then(function () {
        for (var i = 0; i < convs.length; i++) {
          if (convs[i] === c) { convs.splice(i, 1); break }
        }
        if (active === c) newConversation(false)
        else renderConvList()
      })
      .catch(function () { addError('刪唔到，可以再試一次。') })
  }

  /* ── message rendering ────────────────────────────────────────────────── */

  // The dot, cloned from the <template> in the document. No markup is built from a
  // string here — the artwork is real, parsed DOM, so it costs nothing per turn and the
  // page keeps its markup-from-strings guarantee intact.
  function avatar () {
    var box = el('div', 'avatar')
    var tpl = document.getElementById('tpl-avatar')
    if (tpl && tpl.content) box.appendChild(tpl.content.cloneNode(true))
    return box
  }

  // A TURN BELONGS TO A CONVERSATION, NOT TO WHATEVER IS ON SCREEN.
  //
  // This appended to the global `active`, while `render(status, body, conv)` received the
  // conversation and dropped it. Switch conversations while a reply is in flight and the
  // reply landed in whichever pane happened to be open — so the conversation that asked the
  // question showed the question and no answer, which is exactly what the Owner saw.
  //
  // `conv` defaults to active, so every existing call site behaves as before; the ones that
  // can outlive a click now pass it explicitly.
  function turn (who, conv) {
    var c = conv || active
    var t = el('div', 'turn ' + who)
    if (who === 'bot') t.appendChild(avatar())
    var body = el('div', 'body')
    t.appendChild(body)
    c.thread.appendChild(t)
    if (c === active) scroll()   // never yank the view to a conversation he is not reading
    return { root: t, body: body }
  }
  function addUser (text, conv) {
    var t = turn('user', conv)
    t.body.appendChild(el('div', null, text))
    return t
  }
  /* ── copy one message ─────────────────────────────────────────────────────
   * WHAT IT COPIES IS THE POINT. The Owner pastes her answers into invoices, notes and
   * messages to staff. A DOM-text copy arrives as one flat run — headings stop being
   * headings, item lines stop being items — so this copies the MARKDOWN SOURCE the
   * message was rendered from: the same string the server sent, structure intact.
   *
   * The attribution is NOT part of it. 「由 香香（Claude）回答」 is a fact about the turn,
   * not part of the answer, and it is a separate node in the footer rather than text
   * appended to the source, so it cannot travel to the clipboard by accident.
   *
   * 127.0.0.1 IS a secure context, so navigator.clipboard should be there — but "should
   * be" is not "is", and a write that quietly does nothing looks exactly like one that
   * worked. Both the missing-API case and the rejected-write case say so on the button.
   * The message text is never logged. */
  function copyButton (source) {
    var IDLE = '⧉'
    var b = el('button', 'icon-btn', IDLE)
    b.setAttribute('type', 'button')
    b.setAttribute('aria-label', '複製呢個回覆')
    b.setAttribute('title', '複製')
    var busy = false
    function flash (label) {
      b.textContent = label
      setTimeout(function () { b.textContent = IDLE; busy = false }, 2000)
    }
    b.addEventListener('click', function () {
      if (busy) return
      busy = true
      var clip = window.navigator && window.navigator.clipboard
      if (!clip || typeof clip.writeText !== 'function') { flash('複製唔到'); return }
      try {
        clip.writeText(source).then(function () { flash('已複製') }).catch(function () { flash('複製唔到') })
      } catch (e) { flash('複製唔到') }
    })
    return b
  }

  function addBot (text, conv) {
    var t = turn('bot', conv)
    t.body.appendChild(renderMarkdown(text))
    // ONE FOOTER ROW PER MESSAGE, built here so it rides on the message rather than on a
    // call site. The copy control is always in it; labelServedBy drops the attribution in
    // beside it when the server reported who answered. Both reuse styles app.css already
    // defines — this change adds no CSS.
    t.source = String(text == null ? '' : text)
    t.foot = el('div', 'served')
    t.foot.appendChild(copyButton(t.source))
    t.body.appendChild(t.foot)
    return t
  }
  function addError (text, conv) {
    var t = turn('bot', conv)
    t.body.appendChild(el('div', 'err-note', text))
    return t
  }
  function addMeta (host, text) { host.appendChild(el('div', 'meta', text)) }

  // A typing indicator the moment a message is sent — never a silent wait.
  function addTyping (conv) {
    var t = turn('bot', conv)
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

  /* ── the "+" shortcuts ────────────────────────────────────────────────────
   * ONE composer. 香香 routes internally, so there is no lane to pick before typing.
   * These two remain as SHORTCUTS for when the Owner wants to force a lane — never as a
   * required upfront choice. A shortcut applies to the NEXT message only and then clears
   * itself, so a forced lane can never quietly persist into later turns. */
  var SHORTCUTS = [
    { mode: 'email_draft', name: '寫 Email', note: '直接走 Email 草稿通道' },
    { mode: 'proposal', name: '建立提案', note: '直接出一張提案（唔會執行）' }
  ]
  var forcedMode = null

  function setForced (mode) {
    forcedMode = mode || null
    var s = null
    for (var i = 0; i < SHORTCUTS.length; i++) if (SHORTCUTS[i].mode === forcedMode) s = SHORTCUTS[i]
    laneHint.textContent = s ? ('下一句：' + s.name + '（撳一下取消）') : ''
    laneHint.className = 'lane-hint' + (s ? ' on' : '')
  }
  laneHint.addEventListener('click', function () { if (forcedMode) setForced(null) })

  function renderPlusMenu () {
    clear(plusMenu)
    for (var i = 0; i < SHORTCUTS.length; i++) {
      (function (s) {
        var b = el('button', 'opt' + (s.mode === forcedMode ? ' active' : ''))
        b.setAttribute('type', 'button')
        b.setAttribute('role', 'menuitem')
        b.appendChild(el('div', 'opt-name', s.name))
        b.appendChild(el('div', 'opt-note', s.note))
        b.addEventListener('click', function () {
          setForced(forcedMode === s.mode ? null : s.mode)
          closePlus()
          renderPlusMenu()
          msg.focus()
        })
        plusMenu.appendChild(b)
      })(SHORTCUTS[i])
    }
  }
  function openPlus () { plusMenu.className = ''; plus.setAttribute('aria-expanded', 'true') }
  function closePlus () { plusMenu.className = 'hidden'; plus.setAttribute('aria-expanded', 'false') }
  plus.addEventListener('click', function (e) {
    e.stopPropagation()
    if (plusMenu.className === 'hidden') openPlus(); else closePlus()
  })
  renderPlusMenu()

  /** What the server says the turn actually became — shown after the fact, never before. */
  var LANE_NAMES = { chat: '聊天', email_draft: 'Email 草稿', proposal: '提案' }

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
    var conv = active   // captured BEFORE anything renders: a click must not steal this turn
    addUser(text, conv)
    conv.history.push({ role: 'user', text: text })
    msg.value = ''
    autoGrow()
    setPending(true)
    // WHICH conversation is still working. Since a reply now lands in its own conversation
    // while the Owner reads another, nothing on screen said which one was still waiting.
    // It is a property of the CONVERSATION, not of the page: two can be in flight at once,
    // and a page-level flag would be a second source of truth that disagrees with this one.
    conv.working = true
    renderConvList()
    var typing = addTyping(conv)
    // ONE-SHOT: a shortcut applies to THIS message and is cleared immediately. A forced
    // lane that quietly persisted would be the old upfront mode choice returning by
    // stealth — worse than the buttons, because nothing on screen would say so.
    var forced = forcedMode
    setForced(null)

    fetch('/api/v1/demo/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      // No interactionMode unless a shortcut forced one — the SERVER routes. Sending a
      // lane the Owner never chose would put the old upfront decision back, invisibly.
      body: JSON.stringify(forced
        ? { message: text, interactionMode: forced, history: conv.history, providerHint: provider, previousLane: previousLane, conversationId: conv.cid }
        : { message: text, history: conv.history, providerHint: provider, previousLane: previousLane, conversationId: conv.cid })
    }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } })
    }).then(function (o) {
      if (typing.root.parentNode) typing.root.parentNode.removeChild(typing.root)
      // Remember what this turn became, so a short reply next time continues it rather
      // than arriving as a fresh, contentless input. Chat responses carry the lane
      // explicitly; the other two are identified by the shape they return.
      previousLane = (o.body && typeof o.body.lane === 'string') ? o.body.lane
        : (o.body && o.body.stage === 'SHADOW_ONLY') ? 'email_draft'
          : (o.body && (o.body.demoOutcome === 'execution_proposal' || o.body.demoOutcome === 'clarification')) ? 'proposal'
            : previousLane
      labelServedBy(render(o.status, o.body, conv), o.body)
      if (o.body && o.body.reply) conv.history.push({ role: 'assistant', text: o.body.reply })
      // The server has just written this turn, so the conversation is now history: it
      // survives a refresh and it can be deleted. `loaded` is set with it — the thread on
      // screen IS the transcript, so re-selecting this conversation must not re-fetch and
      // repaint what the Owner is already looking at.
      // updatedAt is set here too, so a live conversation sorts and groups beside the
      // stored ones instead of falling into 更早 with no time at all.
      if (o.status === 200) { conv.stored = true; conv.loaded = true; conv.updatedAt = new Date().toISOString() }
      renderConvList() // the conversation has content now, so it enters the list
    }).catch(function () {
      if (typing.root.parentNode) typing.root.parentNode.removeChild(typing.root)
      addError('連線失敗，可以重新送出。', conv)
    }).then(function () {
      // THE ONE PLACE THAT RUNS ON EVERY OUTCOME. Clearing this in the success handler and
      // again in the catch would work today and rot the first time someone adds a third
      // branch. A stuck indicator is worse than no indicator: it promises an answer that
      // is never coming.
      conv.working = false
      renderConvList()
      setPending(false)
      scroll()
    })
  }

  function render (status, res, conv) {
    res = res || {}
    if (status === 403) return addError('示範功能未啟用（demo_disabled）。', conv)
    if (status === 400) return addError('輸入無效，請檢查訊息或模式。', conv)
    if (status >= 500 || (res.error && !res.blocked)) {
      return addError((res.error && res.error.message ? res.error.message : '系統暫時無法處理這個請求。') + '（可重新送出）', conv)
    }
    if (res.blocked === true) {
      var b = addBot(res.reply || '', conv)
      addMeta(b.body, '未送外部模型，未執行任何動作')
      return b
    }
    if (res.stage === 'SHADOW_ONLY') return renderDraft(res)
    if (res.demoOutcome === 'execution_proposal' || res.demoOutcome === 'clarification') return renderProposal(res, conv)
    if (res.talkOnly === true || res.mode === 'chat' || res.mode === 'ask' || res.mode === 'recommend') return addBot(res.reply || '', conv)
    return addError('收到回應但格式未知。requestId: ' + (res.requestId || '（無）'), conv)
  }

  // A pick is not a promise: if the chosen provider fails, the orchestrator falls back to
  // Claude, so the reply may not come from whoever the Owner selected. The label reads the
  // SERVER's report of what actually answered — never the local pick.
  function labelServedBy (t, res) {
    if (!t || !t.body || !res || typeof res.servedBy !== 'string') return
    var name = res.servedBy === 'openai' ? '香香（GPT）' : '香香（Claude）'
    var text = res.fallbackUsed
      ? ('由 ' + name + ' 回答（你揀嘅嗰個失敗咗，已自動改用佢）')
      : ('由 ' + name + ' 回答')
    // INTO the message's own footer when it has one, so the attribution and the copy
    // control read as one row. A turn that is not a plain markdown message (a draft, a
    // proposal card) has no footer, and still gets its own line exactly as before.
    if (t.foot) {
      if (res.fallbackUsed) t.foot.className = 'served fallback'
      t.foot.appendChild(el('span', null, text))
      return
    }
    t.body.appendChild(el('div', 'served' + (res.fallbackUsed ? ' fallback' : ''), text))
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

    /* WHAT SHE READ OUT OF WHAT YOU ALREADY SAID.
     *
     * This used to be two empty text boxes asking for the file path and the intended
     * change — both of which the Owner had just typed in his message. Being asked to
     * retype what you just said is the interface admitting it was not listening.
     *
     * The server infers both (requestInference.js, sharing the Work Order producer's own
     * path extractor so the guess and the check cannot drift). What it read is SHOWN, so
     * a wrong reading is visible and can be corrected by typing another sentence — never
     * silently assumed. Only what is genuinely missing is asked for, in one line. */
    var inf = (res && res.inferred) || {}
    var missing = Array.isArray(inf.missing) ? inf.missing : ['file', 'intent']

    if (inf.file || inf.intent) {
      var read = el('div', 'inferred')
      if (inf.file) read.appendChild(el('div', null, '檔案：' + inf.file))
      if (inf.intent) read.appendChild(el('div', null, '改動：' + inf.intent))
      read.appendChild(el('div', 'inferred-note', '睇錯咗？直接打多句話講清楚就得，唔使填表。'))
      t.body.appendChild(read)
    }

    var row = el('div', 'act')
    var askIn = null

    if (missing.length) {
      // ONE question, about the one thing missing. Never two boxes, never a question
      // about something already answered.
      t.body.appendChild(el('p', 'ask', inf.question || '你想改邊個檔？'))
      askIn = el('input', 'typed')
      askIn.setAttribute('type', 'text')
      askIn.setAttribute('aria-label', missing.indexOf('file') >= 0 ? '要改的單一檔案路徑' : '打算改成甚麼')
      /* THE PLACEHOLDER IS AN INSTRUCTION, NEVER A PLAUSIBLE ANSWER. An earlier walkthrough
         cost two attempts and burned a nonce because an empty field LOOKED filled — the
         placeholder was the value. A sample path here would repeat exactly that. */
      askIn.setAttribute('placeholder', missing.indexOf('file') >= 0 ? '請輸入要改的檔案路徑' : '請輸入想改成甚麼')
      row.appendChild(askIn)
    }

    var mk = el('button', 'primary', '產生工作單')
    mk.setAttribute('type', 'button')
    mk.disabled = !!askIn
    if (askIn) askIn.addEventListener('input', function () { mk.disabled = askIn.value.trim() === '' })
    row.appendChild(mk)
    t.body.appendChild(row)

    mk.addEventListener('click', function () {
      if (mk.disabled) return
      mk.disabled = true
      var typedAnswer = askIn ? askIn.value.trim() : ''
      var file = inf.file || (missing.indexOf('file') >= 0 ? typedAnswer : '')
      var intent = inf.intent || (missing.indexOf('file') < 0 ? typedAnswer : '')
      requestWorkOrder(goal, file, null, pid, intent, conv)
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

    /* THE FACE: only what the decision needs — which file, what change, what is the worst
       case. A section with no title is one of those three and is rendered bare; eight
       labelled boxes to approve a one-line edit is a card nobody reads, and a card nobody
       reads is an approval that is not really being given. */
    var secs = Array.isArray(c.sections) ? c.sections : []
    for (var i = 0; i < secs.length; i++) {
      var s = el('div', 'sec' + (secs[i].title ? '' : ' bare'))
      if (secs[i].title) {
        s.appendChild(el('div', 'sec-t', secs[i].title))
        var isExcerpt = secs[i].title.indexOf('現時內容') === 0
        s.appendChild(el('div', 'sec-b' + (isExcerpt ? ' mono' : ''), secs[i].body))
      } else {
        s.appendChild(el('div', 'sec-b', secs[i].body))
      }
      card.appendChild(s)
    }

    /* ▸ 詳細 — everything that was on the old face. Collapsed, not deleted: the Owner can
       still read all of it, it just no longer stands between him and the decision. */
    var dets = Array.isArray(c.details) ? c.details : []
    if (dets.length) {
      var dd = document.createElement('details')
      dd.className = 'tech'
      var ds = document.createElement('summary')
      ds.textContent = c.detailsTitle || '詳細'
      dd.appendChild(ds)
      for (var j = 0; j < dets.length; j++) {
        var d = el('div', 'sec')
        d.appendChild(el('div', 'sec-t', dets[j].title))
        var mono = dets[j].title.indexOf('現時內容') === 0 || dets[j].title.indexOf('打算改成') >= 0
        d.appendChild(el('div', 'sec-b' + (mono ? ' mono' : ''), dets[j].body))
        dd.appendChild(d)
      }
      card.appendChild(dd)
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
  document.addEventListener('click', function () { closePicker(); closePlus() })
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePicker(); closePlus() } })
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

  /* ── SETTINGS SHEET ────────────────────────────────────────────────────────
   * The same three settings as /settings, opened in this window over the conversation.
   * Closing returns to the chat with nothing lost: the conversation was never unmounted.
   *
   * The switch rows are the only part built here, because they are data-driven; every node
   * is createElement + textContent, and the labels are literals in this file — no markup is
   * assembled from a string and nothing the server sends becomes markup.
   *
   * No browser-side persistence: values are read from the server on open and written back
   * on save. A refresh keeps nothing. */
  // THE MEMORY SWITCHES ARE NAMED HERE; THE SOURCE SWITCHES COME FROM THE SERVER.
  // This map used to hold four sources by hand, so aroma_system had no row on the page at
  // all — the switch existed nowhere and the Owner could not turn it off. The server sends
  // `flagLabels`, derived from the registered source list, and any flag it reports that is
  // not named here is rendered with that label.
  var SET_LABELS = {
    CONVERSATION_RECALL: '對話記憶',
    DECISION_RECALL: '決定記憶'
  }
  var SET_READ_SOURCES = []

  var setOverlay = document.getElementById('settings-overlay')
  var setOpenBtn = document.getElementById('open-settings')
  var setStyle = document.getElementById('set-style')
  var setPrefs = document.getElementById('set-prefs')
  var setMsg = document.getElementById('set-msg')
  var setState = { flags: {}, flagLabels: {}, caps: {}, readAccess: 'off' }

  function setSay (text, kind) {
    setMsg.textContent = text || ''
    setMsg.className = 'set-msg' + (kind ? ' ' + kind : '')
  }

  function setCounts () {
    var rows = [[setStyle, 'set-style-n', 'set-style-cap', 'style'], [setPrefs, 'set-prefs-n', 'set-prefs-cap', 'preferences']]
    rows.forEach(function (r) {
      var cap = setState.caps[r[3]]
      var n = r[0].value.length
      document.getElementById(r[1]).textContent = String(n)
      document.getElementById(r[2]).textContent = cap ? String(cap) : '—'
      document.getElementById(r[1]).parentNode.className = 'set-count' + (cap && n > cap ? ' over' : '')
    })
  }

  function renderSetFlags () {
    var box = document.getElementById('set-flags')
    box.textContent = ''
    // Every switch the SERVER reports, in its order — the memory pair first, then the
    // sources it actually has. A source the server knows about can no longer be missing
    // from this page because the page forgot to list it.
    var keys = Object.keys(setState.flags).length ? Object.keys(setState.flags) : Object.keys(SET_LABELS)
    keys.forEach(function (key) {
      var f = setState.flags[key] || { effective: 'off', setByOwner: false }
      if (key === 'READ_ACCESS') return // the master switch is reported, not offered here
      var row = el('div', 'set-flag')
      row.appendChild(el('span', 'set-name', SET_LABELS[key] || setState.flagLabels[key] || key))
      row.appendChild(el('span', 'set-who', f.setByOwner ? '你設定' : '啟動時設定'))

      var btn = el('button', null, f.effective === 'on' ? '開' : '關')
      btn.type = 'button'
      btn.setAttribute('data-state', f.effective)
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-state') === 'on' ? 'off' : 'on'
        btn.setAttribute('data-state', next)
        btn.textContent = next === 'on' ? '開' : '關'
        setState.flags[key] = { effective: next, setByOwner: true }
        row.querySelector('.set-who').textContent = '你設定'
      })
      row.appendChild(btn)

      /* A source shown as "on" while the master READ_ACCESS is off would be a lie on the
         screen, so the gap is stated rather than hidden. */
      if (key.indexOf('CONTEXT_') === 0 && setState.readAccess !== 'on') {
        row.appendChild(el('span', 'set-note', '總開關 READ_ACCESS 係關嘅，所以呢個開咗都唔會讀到'))
      }
      box.appendChild(row)
    })
  }

  function openSettings () {
    setOverlay.className = 'overlay'
    setOpenBtn.setAttribute('aria-expanded', 'true')
    setSay('讀取中…')
    fetch('/api/v1/settings', { credentials: 'same-origin' })
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (!j.ok) throw new Error('read failed')
        setStyle.value = j.style || ''
        setPrefs.value = j.preferences || ''
        setState.caps = j.caps || {}
        setState.flags = j.flags || {}
        setState.readAccess = (j.flags && j.flags.READ_ACCESS && j.flags.READ_ACCESS.effective) || 'off'
        setCounts()
        renderSetFlags()
        setSay(j.updatedAt ? '上次儲存 ' + String(j.updatedAt).replace('T', ' ').slice(0, 16) : '')
      })
      .catch(function () { setSay('讀取設定失敗', 'bad') })
    setStyle.focus()
  }

  function closeSettings () {
    setOverlay.className = 'overlay hidden'
    setOpenBtn.setAttribute('aria-expanded', 'false')
    setSay('')
    msg.focus() // straight back to the conversation
  }

  setOpenBtn.addEventListener('click', openSettings)
  document.getElementById('close-settings').addEventListener('click', closeSettings)
  document.getElementById('settings-backdrop').addEventListener('click', closeSettings)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && setOverlay.className.indexOf('hidden') < 0) closeSettings()
  })
  setStyle.addEventListener('input', setCounts)
  setPrefs.addEventListener('input', setCounts)

  document.getElementById('save-settings').addEventListener('click', function () {
    var btn = document.getElementById('save-settings')
    btn.disabled = true
    setSay('儲存中…')

    var flags = {}
    Object.keys(SET_LABELS).forEach(function (k) {
      if (setState.flags[k]) flags[k] = setState.flags[k].effective
    })

    fetch('/api/v1/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ style: setStyle.value, preferences: setPrefs.value, flags: flags })
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }) })
      .then(function (res) {
        if (res.status === 200 && res.body.ok) {
          setState.flags = res.body.flags || setState.flags
          renderSetFlags()
          setSay('已儲存。下一句即時生效。', 'ok')
          return
        }
        /* A refusal is shown in full — it names what was rejected and why, and says nothing
           was saved. The page never silently edits what the Owner typed. */
        setSay(res.body.detail || '儲存失敗', 'bad')
      })
      .catch(function () { setSay('儲存失敗', 'bad') })
      .finally(function () { btn.disabled = false })
  })

  send.disabled = true
  autoGrow()
  newConversation(false)
  // The sidebar reads its history from the server. Done after the page is already usable,
  // so a slow or failed fetch delays nothing and breaks nothing.
  bootHistory()
  addBot('我係香香。有咩想傾，或者想我幫你做啲咩？\n\n想我改嘢，直接講明改邊個檔案同改乜就得 —— 我會出一張工作單畀你過目，**你批准咗我先會做**。')
})()
