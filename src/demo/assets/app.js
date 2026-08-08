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
  var mainEl = document.getElementById('main')
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
  /**
   * ⛔ THE SAME RESOLVER THE SERVER RUNS, not a second one.
   * `createResolver` and `CATALOGUE` are inlined above this script by demoHtml.js from
   * src/i18n/browserResolver.js — the server's own function object, serialised. Two renderings
   * could disagree; one function cannot disagree with itself, and browserResolver.test.js
   * proves it over every key in both languages.
   *
   * ⛔ AND IT IS NAMED `t`, WHICH COST 57 RENAMES IN THIS FILE. `t` was a local for DOM nodes
   * throughout (now `tEl`). The source scan that keeps data out of the translator looks for
   * `t(`, so calling the client's resolver anything else would have left the file with the most
   * interface strings outside the one structural rule. The rename was the cheaper side.
   *
   * INITIAL_LOCALE comes from the same currentLocale() the server uses — see
   * browserResolver.js. It is the value baked into THIS page, and the page is assembled once at
   * module load, so a language change after that would never reach a reloaded tab. Hence
   * setLocale() below: boot reads the stored setting and re-points the resolver, so changing
   * the language needs a RELOAD and never a restart.
   *
   * ⛔ ONE RESOLVER, RE-POINTED — not a second implementation, not a mutated catalogue. Every
   * call site stays `t('literal.key')` and stays visible to the source scan.
   */
  var resolver = createResolver({ catalogue: CATALOGUE, locale: INITIAL_LOCALE })
  function t (key, slots) { return resolver(key, slots) }
  function setLocale (loc) { resolver = createResolver({ catalogue: CATALOGUE, locale: loc }) }

  var READ_SOURCES = /*READ_SOURCE_LABELS*/
  var SOURCE_TEXT = READ_SOURCES.join(t('punct.sourceSep')) + t('provider.pastDecisions')

  var PROVIDERS = [
    { id: 'claude', name: t('provider.claude'), note: t('provider.canSee', { sources: SOURCE_TEXT }), warn: false },
    { id: 'openai', name: t('provider.gpt'), note: t('provider.canSeeButSends', { sources: SOURCE_TEXT }), warn: true }
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
    var c = { id: 'c' + (convs.length + 1), cid: cid, title: t('conv.new'), history: [], thread: thread }
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
  /**
   * THE EMPTY SCREEN — a greeting, the composer, and nothing else.
   *
   * It replaces a canned assistant bubble that fired on every page load: an avatar, a copy
   * button and two paragraphs of instructions, presented as though she had already spoken.
   *
   * THE GREETING COMES FROM THE SERVER. 早晨/午安/晚安 depends on the hour and the hour
   * depends on the OWNER'S timezone, not this device's — so the band words are not written
   * in this file at all. A failed fetch shows nothing rather than guessing.
   */
  /**
   * The empty conversation screen: a greeting and a composer. That is all.
   *
   * ⛔ THE BRIEFING USED TO LIVE HERE AND NO LONGER DOES. It grew until forty-four rows pushed
   * the composer off the screen — the briefing ate the thing it sits above. It has its own
   * destination now (`showHome`), which is what PRODUCT-IA specified all along.
   *
   * The waiting bar still persists over this screen. It is the one thing with a deadline, and
   * moving the briefing away must not take it along: a stopped errand needs somewhere to appear
   * while he is typing.
   */
  function renderEmptyScreen (c) {
    if (!mainEl || isListed(c) || c.history.length > 0) return
    mainEl.classList.add('empty')
    var box = el('div', 'empty-greeting')
    c.thread.appendChild(box)
    /**
     * ⛔ NEVER SILENTLY BLANK — the rule that holds everywhere else on this surface.
     *
     * The Owner reported the greeting gone after the briefing moved to 首頁. The endpoint
     * returns 「午安，Louie」, the CSS is intact and this function is still called, so I could
     * not reproduce it — and the old code returned SILENTLY on every failure path, which means
     * a blank greeting and a broken greeting looked identical.
     *
     * That is the same shape as every 「count: 43」 in this project. If it is blank again now,
     * the screen says WHY, and 「I could not reproduce it」 stops being the end of the sentence.
     *
     * The clock stays the SERVER's — 早晨/午安/晚安 depends on HIS timezone, never the browser's,
     * so there is no local fallback greeting. The fallback is an honest sentence, not a guess.
     */
    var settle = function (text) {
      if (active !== c || c.history.length > 0) return
      box.textContent = text
    }
    fetch('/api/v1/demo/greeting', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then(function (j) {
        if (!j || !j.line) throw new Error('no line in payload')
        settle(j.line)
      })
      .catch(function (e) {
        settle(t('greeting.unavailable', { error: String(e && e.message).slice(0, 40) }))
      })
  }

  /** 首頁 — the briefing as its own destination. */
  function showHome () {
    if (!mainEl) return
    active = null
    // ⛔ 首頁 IS A REPORT, NOT A CONVERSATION — so there is no composer here. A composer on a
    // report looks like it continues from what he is reading, and would not. The follow-up
    // problem it leaves open is recorded in DESIGN-HOME-BRIEFING; a bare box is not the answer.
    showComposer(false)
    mainEl.classList.remove('empty')
    clear(log)
    titleEl.textContent = t('nav.home')
    var view = el('div', 'home-view')
    log.appendChild(view)
    var brief = el('div', 'brief')
    view.appendChild(brief)
    markHome(true)
    // ⛔ The briefing IS visible here, so the bar must not duplicate it — the same stand-in
    // rule as before, with a new answer to 「is the briefing on screen?」.
    renderWaitingBar(true)
    fetch('/api/v1/home/briefing', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (b) {
        if (!b) throw new Error('no body')
        renderBriefing(brief, b)
      })
      .catch(function () {
        // ⛔ NEVER BLANK. A failed fetch is not 「nothing waiting」 — it is 「I could not look」,
        // and the two look identical in an empty box and mean opposite things.
        brief.appendChild(row('brief-errands brief-defect', t('client.noHomeApi'), ''))
      })
  }

  /**
   * ⛔ WHAT WOULD TRAVEL, ON SCREEN, BEFORE HE TYPES.
   *
   * Owner: 「Before I type anything I should be able to see what would travel. Not after
   * sending, not in a log — on screen, before.」
   *
   * It renders `a.lines` VERBATIM. The client deliberately does not compose its own summary
   * from the briefing: two renderings can disagree, and the one he reads would be the one that
   * is not sent. The server's preview endpoint and its send path call the same function.
   */
  var attachedKind = null
  function renderAttachPreview (a) {
    var box = document.getElementById('attach-preview')
    if (!box) return
    clear(box)
    if (!a || !Array.isArray(a.lines) || !a.lines.length) {
      box.classList.add('hidden')
      return
    }
    box.classList.remove('hidden')
    var head = el('div', 'attach-head')
    head.textContent = t('attach.travelling', { title: a.title || a.kind })
    box.appendChild(head)
    for (var i = 0; i < a.lines.length; i++) {
      var l = el('div', 'attach-line')
      l.textContent = a.lines[i]
      box.appendChild(l)
    }
  }

  /** The door into a section. Rendered only when the server says there is an inside. */
  function openLink (c) {
    var b = el('button', 'sect-open')
    b.type = 'button'
    b.textContent = t('attach.open', { title: c.title })
    b.addEventListener('click', function () { showSection(c.kind, c.title) })
    return b
  }

  /**
   * 首頁 → one section, at higher resolution.
   *
   * ⛔ ROUND A HAS NO COMPOSER. The context problem it exists to solve is real, and the answer
   * must CARRY what it attaches visibly — DESIGN-HOME-SECTIONS §4. A bare box here would be
   * HR-42 with a nicer failure.
   */
  function showSection (kind, title) {
    if (!mainEl) return
    /**
     * ⛔ ROUND B. The composer IS here, and it carries the section as context — because the
     * context is WHICH DOOR HE OPENED, never something inferred from what he types.
     *
     * ⛔ 附上咗乜要睇得見: the preview is fetched and rendered as the section opens, before any
     * keystroke. It is the SERVER's own answer to 「what would travel」, displayed verbatim —
     * the client never composes a summary of its own, because two renderings can disagree.
     */
    attachedKind = kind
    active = null
    showComposer(true)
    markHome(false)
    mainEl.classList.remove('empty')
    clear(log)
    titleEl.textContent = title || kind

    var view = el('div', 'home-view')
    log.appendChild(view)

    var back = el('button', 'sect-back')
    back.type = 'button'
    back.textContent = t('nav.backHome')
    back.addEventListener('click', function () { showHome() })
    view.appendChild(back)

    var host = el('div', 'sect-body')
    view.appendChild(host)
    renderWaitingBar(true)

    // ⛔ FETCHED AS THE SECTION OPENS — before any keystroke, not on focus, not on send.
    // What is rendered is the SERVER's own answer to 「what would travel」, verbatim.
    fetch('/api/v1/home/section/' + encodeURIComponent(kind) + '/attachment', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (a) { renderAttachPreview(a) })
      .catch(function () { renderAttachPreview(null) })

    fetch('/api/v1/home/section/' + encodeURIComponent(kind), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) {
        if (!d) throw new Error('no body')
        renderSection(host, d)
      })
      .catch(function () {
        // ⛔ NEVER BLANK, here too. 「我睇唔到」 is not 「there is nothing」.
        host.appendChild(row('brief-errands brief-defect', t('client.cannotOpenSection'), ''))
      })
  }

  /** The inside: the same conclusion at higher resolution. Never a step log. */
  function renderSection (host, d) {
    clear(host)

    if (d.freshness && d.freshness.line) host.appendChild(row('sect-fresh', d.freshness.line, ''))

    var ings = el('div', 'sect-ingredients')
    for (var i = 0; i < (d.ingredients || []).length; i++) {
      var g = d.ingredients[i]
      var line = el('div', 'sect-ingredient ' + (g.state === 'BLOCKED' ? 'sect-blocked' : (g.state === 'UNRECORDED' ? 'sect-unrecorded' : '')))
      var name = el('span', 'sect-name')
      name.textContent = g.ingredient
      line.appendChild(name)
      var body = el('span', 'sect-detail')
      if (g.state === 'BLOCKED') {
        // ⛔ A reason, never a zero. A site that would not answer is not a site with no recalls.
        body.textContent = t('detail.blocked', { why: g.why || '' })
      } else if (g.state === 'UNRECORDED') {
        // ⛔ AND 「冇記低」 IS NOT 「冇搵到」. Rendering an absent field as an empty result put a
        // false all-clear on this screen for all eight ingredients. Found live, not by tests.
        body.textContent = g.why || t('detail.noItemsRecorded')
      } else if (!Array.isArray(g.items)) {
        // ⛔ THE THIRD READER, HARDENED. This branch used to be `(g.items || []).slice(...)`,
        // which is the SAME collapse that put a false all-clear on this screen from the server
        // side — missing rendered as empty. It is currently unreachable because the server's
        // state field keeps it out, but the guard against it lived somewhere else, which is
        // exactly the fragility. A fallback must fail toward honesty, not toward calm.
        body.textContent = t('detail.noItemsWarning')
      } else {
        var head = (typeof g.found === 'number' ? t('detail.siteFound', { n: g.found }) : '')
        var top = g.items.slice(0, 3).map(function (x) { return x.when + ' ' + x.title }).join(' / ')
        body.textContent = head + t('punct.colon') + (top || t('detail.nothingFound'))
      }
      line.appendChild(body)
      ings.appendChild(line)
    }
    host.appendChild(ings)

    // ⛔ History is CHANGE, not occurrence. A day that repeats the same list is the log grain.
    var h = el('div', 'sect-history')
    var head = el('div', 'sect-history-head')
    head.textContent = t('detail.whichDayChanged')
    h.appendChild(head)
    for (var j = 0; j < (d.history || []).length; j++) {
      h.appendChild(row('sect-day' + (d.history[j].changeCount ? ' sect-day-changed' : ''), d.history[j].line, ''))
    }
    host.appendChild(h)
  }

  /** The composer belongs to a conversation. One place decides, so the two cannot disagree. */
  function showComposer (on) {
    var c = document.getElementById('composer')
    if (c) c.classList.toggle('hidden', !on)
  }

  /** Which destination is current. One place, so the two cannot both look selected. */
  function markHome (on) {
    var b = document.getElementById('open-home')
    if (b) b.classList.toggle('side-item-on', !!on)
    if (on) renderConvList()
  }

  /**
   * A section shows its own time ONLY when the server says it earns its place.
   * Four timestamps all saying 「roughly now」 buried the real times, which live inside the
   * text — 55 days, 5 hours ago. See briefing.js stamped().
   */
  function whenFor (section) {
    return (section && section.showCheckedAt) ? section.checkedAtLabel : ''
  }

  function row (cls, text, when) {
    var r = el('div', 'brief-row ' + cls)
    var tEl = el('div', 'brief-text')
    tEl.textContent = text
    r.appendChild(tEl)
    if (when) {
      var s = el('div', 'brief-when')
      s.textContent = when
      r.appendChild(s)
    }
    return r
  }

  var OUT_CLASS = { ANSWERED: 'out-answered', STOPPED_FOR_YOU: 'out-stopped', BLOCKED_BY_SITE: 'out-blocked' }
  // ⛔ Thunks, not key strings: `t(OUT_WORD[x])` would be a dynamic key (HR-48).
  var OUT_WORD = {
    ANSWERED: function () { return t('outcome.answered') },
    STOPPED_FOR_YOU: function () { return t('outcome.stopped') },
    BLOCKED_BY_SITE: function () { return t('outcome.blocked') }
  }

  /**
   * The full briefing — empty screen only. Everything here can wait for the next blank
   * screen; only the waiting bar has a deadline.
   */
  /**
   * ⛔ ORDER: WAITING FIRST, THE STANDING BACKLOG LAST.
   *
   * The first version rendered Drive, then errands, then waiting — 而 Drive 排第一，係因為佢
   * 先存在。A layout decision nobody made, which would have been defended if the Owner had
   * not asked, because the thing that exists first looks like the thing that belongs first.
   *
   * The briefing already has the principle: only items with a DEADLINE persist above the
   * thread. The order now follows the same principle it uses for persistence. The Drive line
   * is four lines tall and changes once a day; it is the least urgent thing on the screen.
   */
  function renderBriefing (host, b) {
    clear(host)

    // ⛔ ONE TIME, AT THE TOP. Measured 2026-08-07: builtAt 14:04, waiting 14:04, errands
    // 14:04, backlog 14:02 — four stamps all saying 「roughly now」. That is noise, and it
    // buried the real times, which live INSIDE the text: 55 days, 5 hours ago.
    // A section still dates itself when that means something — see whenFor().
    if (b.builtAtLabel) host.appendChild(row('brief-updated', t('briefing.updatedAt', { time: b.builtAtLabel }), ''))

    // ── ① anything waiting on him — the only thing with a deadline ──
    var w = b.waiting || {}
    if (w.state === 'NOT_WIRED') {
      host.appendChild(row('brief-waiting brief-defect', w.line, ''))
    } else if (w.state === 'CANNOT_READ') {
      host.appendChild(row('brief-waiting', w.line || t('briefing.waitingCannotRead'), whenFor(w)))
    } else if (w.state === 'NOTHING_WAITING') {
      host.appendChild(row('brief-waiting', t('briefing.nothingWaiting'), whenFor(w)))
    } else if (w.cards) {
      for (var k = 0; k < w.cards.length; k++) host.appendChild(waitingCard(w.cards[k]))
    }

    // ── ② what she ran ──
    var e = b.errands || {}
    if (e.state === 'NOT_WIRED') {
      // A defect must not render as a condition. 「未有差事紀錄」 would be a lie here: the
      // record may be full — nothing asked it. Same class as DEFECT-011.
      host.appendChild(row('brief-errands brief-defect', e.line, ''))
    } else if (e.state === 'CANNOT_READ') {
      host.appendChild(row('brief-errands', t('briefing.errandsCannotRead'), whenFor(e)))
    } else if (e.state === 'NONE_RAN' || !(e.rows && e.rows.length)) {
      // ⛔ Empty FOR A REASON is still never blank. Owner ruling: say why.
      host.appendChild(row('brief-errands', t('briefing.noneRan'), whenFor(e)))
    } else {
      // ── THE CONCLUSION, NOT THE LOG ──
      //
      // Forty-four rows pushed the composer off the screen: the briefing ate the thing it sits
      // above. A row is one execution of one query; what he acts on is what the kind FOUND.
      //
      // ⛔ THE FOUR FIELDS RENDER SEPARATELY AND ARE NEVER CONCATENATED.
      //   alert   — a new recall. Act on this.
      //   gap     — something could NOT be checked. ⛔ Its own line, always, even when five of
      //             six are clean. This is the through-line of the whole week.
      //   unknown — nothing to compare against. Never 「冇新嘢」. First run especially.
      //   calm    — the count that was actually checked and actually comparable.
      // Folding one into another requires deleting a branch here, not rewording a sentence.
      var cl = el('div', 'brief-conclusion')
      for (var ci = 0; ci < (e.conclusions || []).length; ci++) {
        var c = e.conclusions[ci]
        if (c.alert) cl.appendChild(row('concl-line concl-alert', c.alert, ''))
        if (c.gap) cl.appendChild(row('concl-line concl-gap', c.gap, ''))
        if (c.unknown) cl.appendChild(row('concl-line concl-unknown', c.unknown, ''))
        if (c.calm) cl.appendChild(row('concl-line concl-calm', c.calm, ''))
        // ── the door, beside the conclusion it opens ──
        //
        // ⛔ 冇門好過一道假門. The control exists only when the SERVER says this section has an
        // inside. A kind that never ran gets its line and NO affordance — a greyed-out card
        // promises something is there and then has nothing.
        if (c.openable) cl.appendChild(openLink(c))
      }
      host.appendChild(cl)

      // ── the history is REACHABLE, not displayed ──
      var runs = (e.conclusions || []).reduce(function (a, x) { return Math.max(a, x.runsToday || 0) }, 0)
      var bits = []
      if (runs > 1) bits.push(t('errands.ranTimesToday', { n: runs }))
      if (e.totalRows) bits.push(e.totalRows === 1 ? t('errands.oneRow') : t('errands.rows', { n: e.totalRows }))
      // ⛔ Never-blank applies to what was CUT, not only to what is empty.
      if (e.hiddenRows > 0) bits.push(t('errands.moreHidden', { n: e.hiddenRows }))
      if (bits.length) host.appendChild(row('brief-errands concl-history', t('errands.noHistoryPage', { bits: bits.join(t('punct.bulletSep')) }), whenFor(e)))
    }

    // ── ②b how fresh that is ALLOWED to be ──
    //
    // ⛔ RENDERED FOR EVERY DECLARED KIND, INCLUDING ON THE EMPTY PATH — which is exactly when
    // it carries the most: 「未有差事紀錄」 says nothing about WHAT was never done, and a kind
    // that has never run once produces no row to hang a timestamp on.
    //
    // ⛔ AND IT IS NOT AN ALARM. With no scheduler every kind is DUE most of the time — the
    // normal state of a thing he runs by hand. Styled red, he would learn to skip the line
    // within a week, and skip it too on the day it meant something.
    if (e.freshness && e.freshness.length) {
      var fl = el('div', 'brief-fresh-list')
      for (var j = 0; j < e.freshness.length; j++) {
        var f = e.freshness[j]
        var cls = 'brief-fresh fresh-' + String(f.state || '').toLowerCase()
        var fr = el('div', cls)
        var mark = el('span', 'fresh-mark')
        mark.textContent = f.state === 'FRESH' ? '·' : (f.state === 'NEVER_RUN' ? '○' : '–')
        fr.appendChild(mark)
        var txt = el('span', 'fresh-line')
        txt.textContent = f.line
        fr.appendChild(txt)
        fl.appendChild(fr)
      }
      host.appendChild(fl)
    }

    // ── ③ the Drive line, LAST: standing state, four lines tall, changes once a day ──
    if (b.backlog) {
      host.appendChild(row('brief-backlog', b.backlog.line, whenFor(b.backlog)))
    }
  }

  /** The stop report, INLINE. Not a link to a report — he decides here or he does not. */
  function waitingCard (c) {
    var card = el('div', 'brief-card')
    var h = el('div', 'card-head')
    h.textContent = t('waiting.heading', { title: c.title })
    card.appendChild(h)

    if (c.where) card.appendChild(kv(t('waiting.where'), c.where));
    if (c.account) card.appendChild(kv(t('waiting.account'), c.account))
    if (c.filled && c.filled.length) card.appendChild(kv(t('waiting.didWhat'), c.filled.join(t('punct.bulletSep'))))
    if (c.notPressed) card.appendChild(kv(t('waiting.notPressed'), t('waiting.notPressedValue', { role: c.notPressed.role, name: c.notPressed.name })))

    if (c.amount) {
      var a = el('div', 'card-kv')
      var ak = el('span', 'kv-k'); ak.textContent = t('waiting.amount'); a.appendChild(ak)
      var av = el('span', 'kv-v' + (c.amountStruck ? ' amount-struck' : ''))
      av.textContent = c.amount
      a.appendChild(av)
      card.appendChild(a)
    }
    if (c.amountNote) card.appendChild(kv('', c.amountNote))
    if (c.whichLayer) card.appendChild(kv(t('waiting.whyStopped'), c.whichLayer))

    var btn = el('button', 'card-open')
    btn.type = 'button'
    btn.textContent = t('waiting.reopen')
    btn.addEventListener('click', function () { openStopped(c, btn) })
    card.appendChild(btn)
    return card
  }
  function kv (k, v) {
    var r = el('div', 'card-kv')
    var ke = el('span', 'kv-k'); ke.textContent = k; r.appendChild(ke)
    var ve = el('span', 'kv-v'); ve.textContent = v; r.appendChild(ve)
    return r
  }

  /**
   * ⛔ A POST, never an <a href>.
   *
   * A cart lives in the session that built it. A link opened in HIS everyday Chrome shows an
   * empty cart — measured on Costco. Only a local endpoint can launch Chrome against HER
   * profile, so the button asks the server to do it.
   */
  function openStopped (c, btn) {
    btn.disabled = true
    var was = btn.textContent
    btn.textContent = t('waiting.opening')
    fetch(c.openHref, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
      .then(function (res) {
        btn.disabled = false
        if (res.ok) { btn.textContent = t('waiting.opened'); return }
        // A refusal is an ANSWER, not something to try again. The lock especially: two
        // Chromes writing one profile is corruption that surfaces days later as something
        // else entirely, so nothing here retries and nothing clears a lock.
        btn.textContent = was
        var m = el('div', 'card-refusal')
        m.textContent = (res.j && res.j.outcome === 'PROFILE_IN_USE')
          ? (res.j.saying || t('waiting.profileBusyShort'))
          : ((res.j && res.j.saying) || t('waiting.cannotOpen'))
        btn.parentNode.appendChild(m)
      })
      .catch(function () {
        btn.disabled = false
        btn.textContent = was
      })
  }

  /**
   * ⛔ THE WAITING BAR — the ONE thing that survives a keystroke.
   *
   * `renderEmptyScreen` returns early once the conversation has history, so the greeting and
   * everything with it vanishes on the first keystroke. That is fine for 「what she ran」 and
   * fatal for 「a cart is priced and unpressed」 — it would leave the screen at the exact
   * moment he is doing something else.
   *
   * So this renders ABOVE the thread, is not gated on an empty conversation, and shows only
   * items with a deadline. 有死線嗰啲留低,其餘等下次空畫面。
   */
  function renderWaitingBar (briefingVisible) {
    if (!mainEl) return
    // ⛔ THE STAND-IN RULE — one sentence deciding both the order and the gating:
    //   首頁 shows waiting FIRST; the bar is the briefing's STAND-IN when the briefing is gone.
    //
    // While the briefing is on screen the bar is redundant, and worse than redundant: it
    // rendered the SAME waiting item twice — a collapsed count at the top and the useful card
    // at the bottom. Nothing had stopped yet, so neither of us had seen it, and the first day
    // something did stop is the moment the Owner would be least patient with it.
    if (briefingVisible) {
      var stale = document.getElementById('waiting-bar')
      if (stale) stale.parentNode.removeChild(stale)
      return
    }
    var old = document.getElementById('waiting-bar')
    if (old) old.parentNode.removeChild(old)
    fetch('/api/v1/home/briefing', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (b) {
        if (!b || !b.waiting) return
        if (b.waiting.state !== 'WAITING' || !b.waiting.cards.length) return
        var bar = el('div', 'waiting-bar')
        bar.id = 'waiting-bar'
        var n = b.waiting.cards.length
        var tEl = el('span', 'wb-text')
        tEl.textContent = t('waiting.countWaiting', { n: n })
        bar.appendChild(tEl)
        var open = el('button', 'wb-open')
        open.type = 'button'
        open.textContent = t('waiting.look')
        open.addEventListener('click', function () {
          bar.classList.toggle('expanded')
          if (bar.querySelector('.brief-card')) return
          for (var i = 0; i < b.waiting.cards.length; i++) bar.appendChild(waitingCard(b.waiting.cards[i]))
        })
        bar.appendChild(open)
        mainEl.insertBefore(bar, mainEl.firstChild)
      })
      .catch(function () { /* the bar is an addition; its absence is not a claim */ })
  }

  /**
   * ── THE STALE-TAB GUARD ───────────────────────────────────────────────────
   * app.js and app.css are INLINED into this page at server require() time, so a tab loaded
   * before a restart keeps running old client code against a new server — and looks
   * completely normal doing it. That has cost three rounds: a reject button that "worked"
   * and never called the server, a deterministic entrance that did not appear, and a
   * backlog line that did not render.
   *
   * The page knows the fingerprint it was built from. It asks the server what is being
   * served now, and if they differ it SAYS SO. Checked once on load — the answer only
   * changes on a restart, so polling would be noise.
   */
  function checkStale () {
    // Substituted by demoHtml.js at build time. It lives HERE rather than in a second
    // script block in index.html, because the page is required to carry exactly ONE inline
    // script — 「nothing is fetched at runtime」 is checked by counting them, and this file
    // is inlined into that count. (Writing the tag name in full here breaks that test: the
    // comment itself is part of the page.)
    var mine = '/*BUILD_STAMP*/'
    if (!mine || mine.indexOf('BUILD_STAMP') !== -1) return
    fetch('/api/v1/demo/version', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) {
        if (!j || !j.build || j.build === mine) return
        var bar = el('div', 'stale-banner')
        // Naming the remedy matters: an ordinary reload does NOT clear this, and a banner
        // that only says "out of date" sends him looking for the fix.
        bar.textContent = t('client.staleTab')
        document.body.insertBefore(bar, document.body.firstChild)
      })
      .catch(function () { /* a guard that fails is silent; it must never break the page */ })
  }
  checkStale()

  /** The moment he sends, the greeting is gone — and the pane stops being centred. */
  function clearEmptyScreen (c) {
    if (mainEl) mainEl.classList.remove('empty')
    var box = (c && c.thread) ? c.thread.querySelector('.empty-greeting') : null
    if (box && box.parentNode) box.parentNode.removeChild(box)
  }
  function isListed (c) { return c.stored === true || c.history.length > 0 }
  function selectConversation (c) {
    // A conversation is the current destination, so 首頁 is not.
    markHome(false)
    showComposer(true)
    active = c
    clear(log)
    log.appendChild(c.thread)
    titleEl.textContent = isListed(c) ? c.title : t('brand.name')
    renderConvList()
    // A stored conversation is a title until it is opened; the transcript arrives here.
    if (c.stored && !c.loaded) loadConversation(c)
    else renderEmptyScreen(c)
    // The briefing is on screen exactly when the empty screen is. The bar is its STAND-IN,
    // so it is told which rather than guessing.
    renderWaitingBar(!isListed(c) && c.history.length === 0)
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
          d.setAttribute('aria-label', t('conv.deleteLabel', { title: c.title }))
          d.setAttribute('title', t('conv.delete'))
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
    var tEl = String(text).replace(/\s+/g, ' ').trim()
    return tEl.length > 30 ? tEl.slice(0, 30) + '…' : (tEl || t('conv.new'))
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
      id: 'h-' + row.id, cid: row.id, title: row.title || t('conv.new'),
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
    return t('conv.monthDay', { m: d.getMonth() + 1, d: d.getDate() })
  }

  function groupLabel (iso) {
    if (!iso) return t('conv.earlier')
    var d = new Date(iso)
    if (isNaN(d.getTime())) return t('conv.earlier')
    var days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
    return days === 0 ? t('conv.today') : (days === 1 ? t('conv.yesterday') : t('conv.earlier'))
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
          addError(t('conv.cannotRead'), c)
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
            var tEl = addBot(text, c)
            // The same disclosure a live turn carries: who actually answered.
            if (m[i] && m[i].servedBy) labelServedBy(tEl, { servedBy: m[i].servedBy })
            c.history.push({ role: 'assistant', text: text })
          }
        }
        c.loaded = true
        if (c === active) scroll()
      })
      .catch(function () {
        c.inflight = false   // a failed load may be retried by clicking again
        addError(t('conv.cannotRead'), c)
      })
  }

  function deleteConversation (c) {
    // ASKS FIRST. A conversation is not deleted on a stray click, and there is no undo.
    if (!window.confirm(t('conv.deleteConfirm', { title: c.title }))) return
    fetch('/api/v1/conversations/' + encodeURIComponent(c.cid), { method: 'DELETE', credentials: 'same-origin' })
      .then(function () {
        for (var i = 0; i < convs.length; i++) {
          if (convs[i] === c) { convs.splice(i, 1); break }
        }
        if (active === c) newConversation(false)
        else renderConvList()
      })
      .catch(function () { addError(t('conv.cannotDelete')) })
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
    var tEl = el('div', 'turn ' + who)
    if (who === 'bot') tEl.appendChild(avatar())
    var body = el('div', 'body')
    tEl.appendChild(body)
    c.thread.appendChild(tEl)
    if (c === active) scroll()   // never yank the view to a conversation he is not reading
    return { root: tEl, body: body }
  }
  function addUser (text, conv) {
    var tEl = turn('user', conv)
    tEl.body.appendChild(el('div', null, text))
    return tEl
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
    b.setAttribute('aria-label', t('copy.label'))
    b.setAttribute('title', t('copy.title'))
    var busy = false
    function flash (label) {
      b.textContent = label
      setTimeout(function () { b.textContent = IDLE; busy = false }, 2000)
    }
    b.addEventListener('click', function () {
      if (busy) return
      busy = true
      var clip = window.navigator && window.navigator.clipboard
      if (!clip || typeof clip.writeText !== 'function') { flash(t('copy.failed')); return }
      try {
        clip.writeText(source).then(function () { flash(t('copy.done')) }).catch(function () { flash(t('copy.failed')) })
      } catch (e) { flash(t('copy.failed')) }
    })
    return b
  }

  function addBot (text, conv) {
    var tEl = turn('bot', conv)
    tEl.body.appendChild(renderMarkdown(text))
    // ONE FOOTER ROW PER MESSAGE, built here so it rides on the message rather than on a
    // call site. The copy control is always in it; labelServedBy drops the attribution in
    // beside it when the server reported who answered. Both reuse styles app.css already
    // defines — this change adds no CSS.
    tEl.source = String(text == null ? '' : text)
    tEl.foot = el('div', 'served')
    tEl.foot.appendChild(copyButton(tEl.source))
    tEl.body.appendChild(tEl.foot)
    return tEl
  }
  function addError (text, conv) {
    var tEl = turn('bot', conv)
    tEl.body.appendChild(el('div', 'err-note', text))
    return tEl
  }
  function addMeta (host, text) { host.appendChild(el('div', 'meta', text)) }

  // A typing indicator the moment a message is sent — never a silent wait.
  function addTyping (conv) {
    var tEl = turn('bot', conv)
    var dots = el('div', 'typing')
    dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'))
    tEl.body.appendChild(dots)
    return tEl
  }
  // Stale red errors used to sit above fresh content, so the Owner could not tell which
  // message was current. Any new render clears them first.
  function clearErrors () {
    var olds = active.thread.querySelectorAll('.err-note')
    for (var i = 0; i < olds.length; i++) {
      var tEl = olds[i].parentNode && olds[i].parentNode.parentNode
      if (tEl && tEl.parentNode) tEl.parentNode.removeChild(tEl)
    }
  }

  /* ── the "+" shortcuts ────────────────────────────────────────────────────
   * ONE composer. 香香 routes internally, so there is no lane to pick before typing.
   * These two remain as SHORTCUTS for when the Owner wants to force a lane — never as a
   * required upfront choice. A shortcut applies to the NEXT message only and then clears
   * itself, so a forced lane can never quietly persist into later turns. */
  var SHORTCUTS = [
    { mode: 'email_draft', name: t('lane.emailDraft'), note: t('lane.emailDraftNote') },
    // THE HOW-TO HALF of the retired opening bubble lives here. The composer
    // placeholder carries the approval promise; naming the file and the change needs more
    // room than a placeholder has, and this is where someone already comes to ask for one.
    { mode: 'proposal', name: t('lane.proposal'), note: t('lane.proposalNote') }
  ]
  var forcedMode = null

  function setForced (mode) {
    forcedMode = mode || null
    var s = null
    for (var i = 0; i < SHORTCUTS.length; i++) if (SHORTCUTS[i].mode === forcedMode) s = SHORTCUTS[i]
    laneHint.textContent = s ? t('lane.next', { name: s.name }) : ''
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
  // ⛔ Thunks, not key strings — a dynamic key is the one structural line (HR-48).
  var LANE_NAMES = {
    chat: function () { return t('lane.chat') },
    email_draft: function () { return t('lane.emailName') },
    proposal: function () { return t('lane.proposalName') }
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
    /**
     * ⛔ TWO THINGS BEFORE ANYTHING IS SENT, AND BOTH ARE HR-42.
     *
     * 1. SENDING FROM A SECTION OPENS AN ORDINARY CONVERSATION. Not a hidden per-section
     *    thread — he would have conversations he cannot find again. Without this branch
     *     is null on the section view and the guard below would SWALLOW the message,
     *    which is the exact defect HR-42 records, in the screen added to fix the context
     *    problem. 「It would have looked like she ignored me.」
     *
     * 2. THE ATTACHMENT IS CAPTURED FIRST, because newConversation → selectConversation
     *    clears it. And it rides the FIRST TURN ONLY: 「no lingering scope, no guessing」.
     *    A context that quietly persisted for ten turns would be the invisible carried state
     *    this whole shape exists to remove, and the preview disappearing says so on screen.
     *
     * The !active guard stays after both, because the NEXT destination must not be able to
     * reintroduce a silent swallow.
     */
    var carry = attachedKind
    if (!active && carry) newConversation(false)
    if (!active) return
    var text = msg.value.trim()
    if (!text) return
    clearErrors()
    if (active.history.length === 0) {
      active.title = titleFrom(text)
      titleEl.textContent = active.title
      renderConvList()
    }
    var conv = active
    clearEmptyScreen(conv)   // captured BEFORE anything renders: a click must not steal this turn
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
      // ⛔ THE SECTION ID TRAVELS, NEVER THE LINES. The server re-derives them from its own
      // store, so text the browser composed can never enter the prompt wearing the section's
      // name — the same discipline as workRequestRoute re-deriving the file from his words.
      body: JSON.stringify(Object.assign(
        forced
          ? { message: text, interactionMode: forced, history: conv.history, providerHint: provider, previousLane: previousLane, conversationId: conv.cid }
          : { message: text, history: conv.history, providerHint: provider, previousLane: previousLane, conversationId: conv.cid },
        carry ? { attachSection: carry } : {}))
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
      addError(t('err.connection'), conv)
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
    if (status === 403) return addError(t('err.demoDisabled'), conv)
    if (status === 400) return addError(t('err.badInput'), conv)
    if (status >= 500 || (res.error && !res.blocked)) {
      return addError(t('err.retrySuffix', { message: res.error && res.error.message ? res.error.message : t('err.serverBusy') }), conv)
    }
    if (res.blocked === true) {
      var b = addBot(res.reply || '', conv)
      addMeta(b.body, t('served.noExternalModel'))
      return b
    }
    if (res.stage === 'SHADOW_ONLY') return renderDraft(res)
    /* A REAL PROPOSAL WINS. The model path produced one and a card is coming; the offer
       must not pre-empt it. offerFor already declines when a proposal exists, and this
       ordering agrees rather than relying on that alone. */
    if (res.demoOutcome === 'execution_proposal') return renderProposal(res, conv)

    /* THE DETERMINISTIC ENTRANCE — one sentence and a button, never a filled-in card.
     *
     * ORDER IS THE WHOLE FIX. This sat BELOW the clarification branch, so it was dead code
     * on exactly the turn it exists for: `clarification` IS the model declining to produce
     * a task, which is the case the deterministic entrance rescues. The offer was computed
     * correctly, travelled to the browser, and was thrown away here.
     *
     * The Owner's condition, treated as necessary: a false trigger must cost one glance. A
     * rendered card invites a reflex approval, and he has said plainly that he had been
     * approving from memory rather than from what was on the screen. Nothing exists at this
     * point — no Task, no Proposal, no sealed order. Pressing the button is what creates. */
    if (res.workRequestOffer) return renderOffer(res.workRequestOffer, conv)
    /* ⛔ AND THE SETTINGS OFFER, HERE — BEFORE the clarification branch, for the same reason
       the work-order offer is. HR-7: the server computed this correctly and the browser threw
       it away, which is a whole failure however green the suite is. Caught at the served
       string, not by a test. */
    if (res.settingsOffer) return renderSettingsOffer(res.settingsOffer, conv)

    if (res.demoOutcome === 'clarification') return renderProposal(res, conv)
    if (res.talkOnly === true || res.mode === 'chat' || res.mode === 'ask' || res.mode === 'recommend') return addBot(res.reply || '', conv)
    return addError(t('err.unknownShape', { id: res.requestId || t('err.none') }), conv)
  }

  // A pick is not a promise: if the chosen provider fails, the orchestrator falls back to
  // Claude, so the reply may not come from whoever the Owner selected. The label reads the
  // SERVER's report of what actually answered — never the local pick.
  function labelServedBy (tEl, res) {
    if (!tEl || !tEl.body || !res || typeof res.servedBy !== 'string') return
    var name = res.servedBy === 'openai' ? t('provider.gpt') : t('provider.claude')
    var text = res.fallbackUsed
      ? t('served.byFallback', { name: name })
      : t('served.by', { name: name })
    // INTO the message's own footer when it has one, so the attribution and the copy
    // control read as one row. A turn that is not a plain markdown message (a draft, a
    // proposal card) has no footer, and still gets its own line exactly as before.
    if (tEl.foot) {
      if (res.fallbackUsed) tEl.foot.className = 'served fallback'
      tEl.foot.appendChild(el('span', null, text))
      return
    }
    tEl.body.appendChild(el('div', 'served' + (res.fallbackUsed ? ' fallback' : ''), text))
  }

  function renderDraft (res) {
    var tEl = turn('bot')
    var d = res.draft || {}
    tEl.body.appendChild(el('div', 'sec-t', t('draft.title')))
    if (d.subject) tEl.body.appendChild(el('div', 'sec-b', t('draft.subject', { subject: d.subject })))
    tEl.body.appendChild(renderMarkdown(d.body || t('draft.emptyBody')))
    addMeta(tEl.body, t('draft.meta'))
  }

  function renderProposal (res, conv) {
    var tEl = turn('bot')
    if (res.reply) tEl.body.appendChild(renderMarkdown(res.reply))
    var proposals = Array.isArray(res.proposals) ? res.proposals : []
    if (!proposals.length || !proposals[0] || !proposals[0].id) {
      addMeta(tEl.body, t('proposal.none'))
      return
    }
    var pid = proposals[0].id
    var goal = proposals[0].task || res.reply || ''
    addMeta(tEl.body, t('proposal.meta', { id: pid }))

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
      if (inf.file) read.appendChild(el('div', null, t('proposal.file', { file: inf.file })))
      if (inf.intent) read.appendChild(el('div', null, t('proposal.intent', { intent: inf.intent })))
      read.appendChild(el('div', 'inferred-note', t('proposal.correctIt')))
      tEl.body.appendChild(read)
    }

    var row = el('div', 'act')
    var askIn = null

    if (missing.length) {
      // ONE question, about the one thing missing. Never two boxes, never a question
      // about something already answered.
      tEl.body.appendChild(el('p', 'ask', inf.question || t('proposal.whichFile')))
      askIn = el('input', 'typed')
      askIn.setAttribute('type', 'text')
      askIn.setAttribute('aria-label', missing.indexOf('file') >= 0 ? t('proposal.askFileLabel') : t('proposal.askIntentLabel'))
      /* THE PLACEHOLDER IS AN INSTRUCTION, NEVER A PLAUSIBLE ANSWER. An earlier walkthrough
         cost two attempts and burned a nonce because an empty field LOOKED filled — the
         placeholder was the value. A sample path here would repeat exactly that. */
      askIn.setAttribute('placeholder', missing.indexOf('file') >= 0 ? t('proposal.askFilePlaceholder') : t('proposal.askIntentPlaceholder'))
      row.appendChild(askIn)
    }

    var mk = el('button', 'primary', t('proposal.makeWorkOrder'))
    mk.setAttribute('type', 'button')
    mk.disabled = !!askIn
    if (askIn) askIn.addEventListener('input', function () { mk.disabled = askIn.value.trim() === '' })
    row.appendChild(mk)
    tEl.body.appendChild(row)

    mk.addEventListener('click', function () {
      if (mk.disabled) return
      mk.disabled = true
      var typedAnswer = askIn ? askIn.value.trim() : ''
      var file = inf.file || (missing.indexOf('file') >= 0 ? typedAnswer : '')
      var intent = inf.intent || (missing.indexOf('file') < 0 ? typedAnswer : '')
      requestWorkOrder(goal, file, null, pid, intent, conv)
    })
  }

  /* ── the deterministic offer: ONE SENTENCE AND A BUTTON ──────────────── */
  /**
   * ⛔ ONE LINE, BEFORE → AFTER, AND A BUTTON.
   *
   * Owner: 「A settings offer that says 每樣食材顯示幾多條回收：6 → 10 is one line and removes
   * any chance I approve a change I did not mean.」 Nothing is written until he presses.
   */
  function renderSettingsOffer (offer, conv) {
    var tEl = turn('bot')
    var box = el('div', 'offer')
    box.appendChild(el('p', null, t('offer.settingAsk')))
    var line = el('div', 'set-change')
    line.textContent = t('offer.change', { say: offer.say, from: JSON.stringify(offer.from), to: JSON.stringify(offer.to) })
    box.appendChild(line)
    if (offer.appliesOn !== 'LIVE') {
      // ⛔ Said BEFORE he presses. A change that will not take effect must never look like one
      // that will.
      var warn = el('div', 'meta', t('offer.needsReregister'))
      box.appendChild(warn)
    }
    var row = el('div', 'act')
    var go = el('button', 'primary', t('offer.go'))
    go.setAttribute('type', 'button')
    var out = el('div', 'meta')
    row.appendChild(go); box.appendChild(row); box.appendChild(out)
    tEl.body.appendChild(box)
    scroll()

    go.addEventListener('click', function () {
      if (go.disabled) return
      go.disabled = true
      out.textContent = t('offer.changing')
      /* THE MESSAGE, NOT THE VALUE. The server re-derives which setting and what value from
         his own words; a value posted from here would be ignored. */
      fetch('/api/v1/home/settings/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: lastOwnerMessage(conv) })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
        .then(function (x) {
          if (!x.ok) { out.textContent = t('offer.failed', { reason: x.j.saying || x.j.reason || '' }); return }
          out.textContent = t('offer.done', {
            say: x.j.say,
            to: JSON.stringify(x.j.to),
            how: x.j.appliesOn === 'LIVE' ? t('offer.liveNow') : t('offer.howToApply', { how: x.j.howToApply })
          })
        })
        .catch(function () { out.textContent = t('offer.noAnswer') })
    })
  }

  function renderOffer (offer, conv) {
    var tEl = turn('bot')
    var box = el('div', 'offer')
    box.appendChild(el('p', null, t('offer.workOrderAsk', { file: offer.file })))
    var row = el('div', 'act')
    var go = el('button', 'primary', t('offer.makeWorkOrder'))
    go.setAttribute('type', 'button')
    var out = el('div', 'meta')
    row.appendChild(go)
    box.appendChild(row); box.appendChild(out)
    tEl.body.appendChild(box)
    scroll()

    go.addEventListener('click', function () {
      if (go.disabled) return
      go.disabled = true
      out.textContent = t('offer.making')
      /* THE MESSAGE, NOT THE TARGET. The server re-derives the file and the change from
         the Owner's own words; a file named here would be ignored. */
      fetch('/api/v1/owner/work-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: lastOwnerMessage(conv) })
      }).then(function (r) {
        return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } })
      }).then(function (o) {
        if (o.status === 201 && o.body.proposalId) {
          out.textContent = ''
          requestWorkOrder(o.body.goal, o.body.file, null, o.body.proposalId, o.body.intent, conv)
          return
        }
        out.textContent = t('offer.makeFailed', { reason: o.body.reason || o.body.error || t('err.unknownReason') })
      }).catch(function () {
        out.textContent = t('offer.makeFailedNet')
      })
    })
  }

  /* The Owner's own latest words — what the server re-derives from. */
  function lastOwnerMessage (conv) {
    for (var i = conv.history.length - 1; i >= 0; i--) {
      if (conv.history[i] && conv.history[i].role !== 'assistant') return String(conv.history[i].text || '')
    }
    return ''
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
      addError(o.body.reasonForOwner || t('offer.createFailed', { reason: o.body.reason || o.body.error || t('err.unknownReason') }))
    }).catch(function () { addError(t('offer.createFailedNet')) })
  }

  function historyText (conv) {
    var out = []
    for (var i = 0; i < conv.history.length; i++) out.push(String(conv.history[i].text || ''))
    return out
  }

  function renderCard (sealed) {
    clearErrors()
    var c = sealed.card || { heading: '', sections: [], actions: [t('approve.approve'), t('approve.reject')], technicalTitle: t('approve.technical') }
    var tEl = turn('bot')
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
        // ⛔ A FLAG, NOT A TITLE MATCH. This compared the section title against a TRANSLATED
      // string — so a page in one language against a server in the other (the reload window
      // after a language change) would simply stop matching, silently.
      var isExcerpt = secs[i].mono === true
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
      ds.textContent = c.detailsTitle || t('approve.details')
      dd.appendChild(ds)
      for (var j = 0; j < dets.length; j++) {
        var d = el('div', 'sec')
        d.appendChild(el('div', 'sec-t', dets[j].title))
        var mono = dets[j].mono === true
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
    sum.textContent = c.technicalTitle || t('approve.technical')
    det.appendChild(sum)
    det.appendChild(el('pre', null, (sealed.technicalLines || []).join('\n')))
    card.appendChild(det)

    var act = el('div', 'act')
    var typed = el('input', 'typed')
    typed.setAttribute('type', 'text')
    typed.setAttribute('placeholder', t('approve.typeToConfirm', { word: sealed.typedConfirmationRequired }))
    typed.setAttribute('aria-label', t('approve.typeToConfirm', { word: sealed.typedConfirmationRequired }))
    var go = el('button', 'primary', (c.actions && c.actions[0]) || t('approve.approve'))
    go.setAttribute('type', 'button')
    go.disabled = true                                  // exact match only — no misclick
    var no = el('button', 'ghost', (c.actions && c.actions[1]) || t('approve.reject'))
    no.setAttribute('type', 'button')
    var out = el('div', 'meta')
    typed.addEventListener('input', function () { go.disabled = (typed.value !== sealed.typedConfirmationRequired) })
    act.appendChild(typed); act.appendChild(go); act.appendChild(no)
    card.appendChild(act); card.appendChild(out)
    tEl.body.appendChild(card)
    scroll()

    /* REJECT IS A GOVERNANCE ACTION, SO IT GOES TO THE SERVER.
     *
     * This used to disable three controls and print 「你拒絕了這張工作單。甚麼都沒有執行。」
     * without calling anything. The second sentence was true. The FIRST was recorded
     * nowhere: the sealed order expired on its own, but the PROPOSAL stayed pending
     * forever — three of them were sitting in the store when this was fixed.
     *
     * The message now waits for the server, and a failure says so instead of reading as a
     * successful rejection. */
    no.addEventListener('click', function () {
      if (no.disabled) return
      no.disabled = true; go.disabled = true; typed.disabled = true
      out.textContent = t('approve.cancelling')
      fetch('/api/v1/owner/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          approvalId: sealed.approvalId,
          workOrderHash: sealed.workOrderHash,
          nonce: sealed.nonce
        })
      }).then(function (r) {
        return r.json().catch(function () { return {} }).then(function (j) { return { status: r.status, body: j } })
      }).then(function (o) {
        if (o.status === 200) {
          out.textContent = t('approve.rejected')
          return
        }
        out.textContent = t('approve.cancelFailed', { reason: o.body.reason || o.body.error || t('err.unknownReason') })
      }).catch(function () {
        out.textContent = t('approve.cancelFailedNet')
      })
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
            out.textContent = t('approve.startedInCopy')
            watchProgress(sealed.approvalId, card, sealed)
          } else {
            out.textContent = t('approve.confirmedNotRun')
          }
          return
        }
        out.textContent = t('approve.refused', { reason: o.body.reason || o.body.error || t('err.unknownReason') })
      }).catch(function () { out.textContent = t('approve.refusedNet') })
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
    var label = el('span', null, t('run.starting'))
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
      label.textContent = (body && body.headline) || (state === 'done' ? t('run.done') : t('run.failed'))
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
              ? t('run.elapsedOfCap', { secs: secs, cap: Math.round(capMs / 1000) })
              : t('run.elapsed', { secs: secs })
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
            label.textContent = t('run.timedOut')
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
    box.appendChild(el('div', 'sec-t', t('run.result')))
    var s = Array.isArray(body.sections) ? body.sections : []
    for (var i = 0; i < s.length; i++) {
      var sec = el('div', 'sec')
      sec.appendChild(el('div', 'sec-t', s[i].title))
      /**
       * ⛔ THE FLAG ONLY. The fallback here was `title.indexOf('diff')`, and I left it in as
       * belt-and-braces on the grounds that 「diff」 is a technical token both renderings
       * happen to contain. That is true today and it is true because of a WORDING CHOICE, not
       * a contract — reword the section and the branch silently takes the other path.
       *
       * 意思用欄位 travel，唔用字面. The server marks it; the client reads the mark.
       */
      var isDiff = s[i].mono === true
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
  // ⛔ THUNKS, NOT KEY STRINGS. `t(SET_LABELS[key])` would be a DYNAMIC key — the one
  // structural line that keeps data out of the translator, and the exact hole I walked into at
  // the scheduler status codes one tranche ago (HR-48). A thunk keeps this table's shape and
  // keeps every key a literal the source scan can see.
  var SET_LABELS = {
    CONVERSATION_RECALL: function () { return t('set.conversationRecall') },
    DECISION_RECALL: function () { return t('set.decisionRecall') }
  }
  var SET_READ_SOURCES = []

  // ── 首頁 as a destination ──
  var homeBtn = document.getElementById('open-home')
  if (homeBtn) homeBtn.addEventListener('click', function () { showHome() })

  var setOverlay = document.getElementById('settings-overlay')
  var setOpenBtn = document.getElementById('open-settings')
  var setStyle = document.getElementById('set-style')
  var setPrefs = document.getElementById('set-prefs')
  var setMsg = document.getElementById('set-msg')
  // `loaded` starts false: nothing may be written before a read has succeeded.
  var setState = { flags: {}, flagLabels: {}, caps: {}, readAccess: 'off', loaded: false }

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
      var label = SET_LABELS[key] ? SET_LABELS[key]() : (setState.flagLabels[key] || key)
      row.appendChild(el('span', 'set-name', label))
      row.appendChild(el('span', 'set-who', f.setByOwner ? t('set.setByOwner') : t('set.setAtStartup')))

      var btn = el('button', null, f.effective === 'on' ? t('set.on') : t('set.off'))
      btn.type = 'button'
      btn.setAttribute('data-state', f.effective)
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-state') === 'on' ? 'off' : 'on'
        btn.setAttribute('data-state', next)
        btn.textContent = next === 'on' ? t('set.on') : t('set.off')
        setState.flags[key] = { effective: next, setByOwner: true }
        row.querySelector('.set-who').textContent = t('set.setByOwner')
      })
      row.appendChild(btn)

      /* A source shown as "on" while the master READ_ACCESS is off would be a lie on the
         screen, so the gap is stated rather than hidden. */
      if (key.indexOf('CONTEXT_') === 0 && setState.readAccess !== 'on') {
        row.appendChild(el('span', 'set-note', t('set.masterOff')))
      }
      box.appendChild(row)
    })
  }

  function openSettings () {
    setOverlay.className = 'overlay'
    setOpenBtn.setAttribute('aria-expanded', 'true')
    setSay(t('set.loading'))
    // ⛔ Closed until proven open — same guard as the settings page. The POST body is built
    // from these fields unconditionally, and on a failed read they are empty, which the server
    // accepts because an empty string IS a string.
    setState.loaded = false
    document.getElementById('save-settings').disabled = true
    fetch('/api/v1/settings', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json()
          .then(function (j) { return { status: r.status, body: j } })
          .catch(function () { return { status: r.status, body: null } })
      })
      .then(function (res) {
        // 401 is a session that ended, not a malfunction. Different fact, different sentence.
        if (res.status === 401) { setLockSave(t('set.notSignedIn')); return }
        if (res.status !== 200 || !res.body || !res.body.ok) { setLockSave(t('set.loadFailedSaveOff')); return }
        var j = res.body
        setStyle.value = j.style || ''
        setPrefs.value = j.preferences || ''
        setState.caps = j.caps || {}
        setState.flags = j.flags || {}
        setState.readAccess = (j.flags && j.flags.READ_ACCESS && j.flags.READ_ACCESS.effective) || 'off'
        setCounts()
        renderSetFlags()
        setSay(j.updatedAt ? t('set.lastSaved', { when: String(j.updatedAt).replace('T', ' ').slice(0, 16) }) : '')
        setState.loaded = true
        document.getElementById('save-settings').disabled = false
      })
      .catch(function () { setLockSave(t('set.loadFailedSaveOff')) })
    setStyle.focus()
  }

  function setLockSave (message) {
    setState.loaded = false
    document.getElementById('save-settings').disabled = true
    setSay(message, 'bad')
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
    // ⛔ THE HANDLER REFUSES, NOT JUST THE BUTTON. `disabled` is an affordance; a click can
    // still arrive from a script, a key, or a stale DOM. The guard belongs at the write.
    if (!setState.loaded) { setSay(t('set.loadFailedSaveOff'), 'bad'); return }
    var btn = document.getElementById('save-settings')
    btn.disabled = true
    setSay(t('set.saving'))

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
          setSay(t('set.saved'), 'ok')
          return
        }
        /* A refusal is shown in full — it names what was rejected and why, and says nothing
           was saved. The page never silently edits what the Owner typed. */
        setSay(res.body.detail || t('set.saveFailed'), 'bad')
      })
      .catch(function () { setSay(t('set.saveFailed'), 'bad') })
      // ⛔ NOT an unconditional re-enable — that would undo the read guard from inside the save
      // path itself, handing the button back on a dialog that still holds nothing.
      .finally(function () { btn.disabled = !setState.loaded })
  })

  send.disabled = true
  autoGrow()
  newConversation(false)
  // The sidebar reads its history from the server. Done after the page is already usable,
  // so a slow or failed fetch delays nothing and breaks nothing.
  /**
   * ⛔ THE PAGE SHELL CARRIES NO WORDS OF ITS OWN, AND THIS IS WHY.
   *
   * index.html used to hold its labels as literal text. Static markup cannot call t(), and
   * baking the words in at assembly time would freeze them: the document is built ONCE at
   * module load, so a language change would have needed a RESTART — not the reload the
   * setting promises. So the markup ships empty and every label is set here, through the same
   * resolver as everything else, and re-set whenever the locale changes.
   *
   * ⛔ textContent AND setAttribute ONLY. No markup is assembled from strings anywhere in this
   * file, and a bilingual shell is not a reason to start.
   */
  var SHELL_TEXT = [
    ['brand-name', 'text', function () { return t('shell.title') }],
    ['home-label', 'text', function () { return t('nav.home') }],
    ['new-chat', 'text', function () { return t('shell.newChat') }],
    ['settings-label', 'text', function () { return t('shell.settings') }],
    ['conn-text', 'text', function () { return t('shell.local') }],
    ['composer-note', 'text', function () { return t('shell.composerNote') }],
    ['settings-title', 'text', function () { return t('shell.settings') }],
    ['set-style-h', 'text', function () { return t('set.styleHeading') }],
    ['set-style-hint', 'text', function () { return t('set.styleHint') }],
    ['set-prefs-h', 'text', function () { return t('set.prefsHeading') }],
    ['set-prefs-hint', 'text', function () { return t('set.prefsHint') }],
    ['set-mem-h', 'text', function () { return t('set.memoryHeading') }],
    ['set-mem-hint', 'text', function () { return t('set.memoryHint') }],
    ['set-foot', 'text', function () { return t('set.foot') }],
    ['save-settings', 'text', function () { return t('set.save') }],
    ['set-style', 'placeholder', function () { return t('set.stylePlaceholder') }],
    ['set-prefs', 'placeholder', function () { return t('set.prefsPlaceholder') }],
    ['msg', 'placeholder', function () { return t('shell.composerPlaceholder') }],
    ['msg', 'aria', function () { return t('shell.messageLabel') }],
    ['sidebar', 'aria', function () { return t('shell.convListLabel') }],
    ['collapse', 'both', function () { return t('shell.collapse') }],
    ['expand', 'both', function () { return t('shell.expand') }],
    ['places', 'aria', function () { return t('shell.placesLabel') }],
    ['convs', 'aria', function () { return t('shell.historyLabel') }],
    ['plus', 'both', function () { return t('shell.more') }],
    ['plus-menu', 'aria', function () { return t('shell.shortcuts') }],
    ['picker-menu', 'aria', function () { return t('shell.pickWho') }],
    ['send', 'aria', function () { return t('shell.send') }],
    ['close-settings', 'both', function () { return t('shell.close') }]
  ]

  function applyShellText () {
    document.title = t('shell.title')
    for (var i = 0; i < SHELL_TEXT.length; i++) {
      var id = SHELL_TEXT[i][0]
      var how = SHELL_TEXT[i][1]
      /**
       * ⛔ THUNKS — AND THE FIRST VERSION OF THIS TABLE HELD KEY STRINGS AND CALLED
       * `t(SHELL_TEXT[i][2])`.
       *
       * I wrote a paragraph right here arguing that was fine: the table holds literals written
       * in this file, nothing from outside can reach it, so no data can enter the translator.
       * The argument is even correct. **The scan failed the build anyway, and it was right to.**
       *
       * Rule ① is 「literal keys at call sites」, not 「keys someone can argue are safe」 — because
       * the arguing IS the failure mode. Fourth time this has happened in this work, and the
       * fourth time the fence held where the reasoning did not (HR-48).
       */
      var text = SHELL_TEXT[i][2]()
      var n = document.getElementById(id)
      if (!n) continue
      if (how === 'text') n.textContent = text
      else if (how === 'placeholder') n.setAttribute('placeholder', text)
      else if (how === 'aria') n.setAttribute('aria-label', text)
      else { n.setAttribute('aria-label', text); n.setAttribute('title', text) }
    }
    // The picker shows the provider it is on, and provider names are catalogue entries too.
    if (pickerLabel) pickerLabel.textContent = currentProvider().name
  }
  applyShellText()

  bootHistory()

  /**
   * ⛔ THE LANGUAGE, READ FROM THE STORED SETTING — the reason a change needs a RELOAD
   * and not a RESTART.
   *
   * The page was BUILT with whatever locale the server had when it assembled the document,
   * once, at module load. This asks what the setting says NOW and re-points the resolver, so
   * the language he chose is the language the next reload shows.
   *
   * ⛔ NOTHING ALREADY ON SCREEN IS RE-RENDERED, and that is deliberate rather than lazy:
   * this runs before the first briefing render, and re-rendering mid-flight is how a
   * half-translated page happens. A tab left open in the old language is caught by the
   * stale-tab banner, because the build stamp covers the catalogue and the locale.
   *
   * A silent catch, and this is the one place it is right (HR-46 is about fallbacks that
   * hide a FAILURE): the page has already rendered in a real language. A settings endpoint
   * that does not answer is not a reason to blank it, and 「I could not read your
   * settings」 belongs to the settings panel, which says it.
   */
  fetch('/api/v1/home/settings', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (j) {
      if (!j || !j.entries) return
      for (var i = 0; i < j.entries.length; i++) {
        var e = j.entries[i]
        if (e.id === 'language' && e.value && e.value !== INITIAL_LOCALE) {
          setLocale(e.value)
          // ⛔ The shell was already painted in the baked language; re-paint it. Only the
          // static labels — nothing rendered from server data is touched mid-flight.
          applyShellText()
        }
      }
    })
    .catch(function () { })})()
