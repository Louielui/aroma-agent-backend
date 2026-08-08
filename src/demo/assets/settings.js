/* settings.js — load, edit, save. No polling, no autosave, no timers. */
(function () {
  'use strict'

  /**
   * ⛔ THE SAME RESOLVER THE SERVER AND THE CHAT PAGE RUN — inlined above this script by
   * settingsHtml.js. NOT a second t(): two renderings could disagree, and a second page is
   * exactly where nobody would look for the disagreement.
   */
  var t = createResolver({ catalogue: CATALOGUE, locale: INITIAL_LOCALE })

  // ⛔ Thunks, not key strings — `t(LABELS[key])` would be a DYNAMIC key (HR-48).
  var LABELS = {
    CONVERSATION_RECALL: function () { return t('set.conversationRecall') },
    DECISION_RECALL: function () { return t('set.decisionRecall') },
    CONTEXT_DRIVE: function () { return t('set.readDrive') },
    CONTEXT_GMAIL: function () { return t('set.readGmail') },
    CONTEXT_CALENDAR: function () { return t('set.readCalendar') },
    CONTEXT_GITHUB: function () { return t('set.readGithub') }
  }
  var READ_SOURCES = ['CONTEXT_DRIVE', 'CONTEXT_GMAIL', 'CONTEXT_CALENDAR', 'CONTEXT_GITHUB']

  var $ = function (id) { return document.getElementById(id) }
  // `loaded` starts false: nothing may be written before a read has succeeded.
  var state = { flags: {}, caps: {}, readAccess: 'off', loaded: false }

  function el (tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function counts () {
    var pairs = [['style', 'styleCount', 'styleCap'], ['prefs', 'prefsCount', 'prefsCap']]
    pairs.forEach(function (p) {
      var len = $(p[0]).value.length
      var cap = p[0] === 'style' ? state.caps.style : state.caps.preferences
      $(p[1]).textContent = len
      $(p[2]).textContent = cap || '—'
      $(p[1]).parentNode.className = 'count' + (cap && len > cap ? ' over' : '')
    })
  }

  function renderFlags () {
    var box = $('flags')
    box.textContent = ''
    Object.keys(LABELS).forEach(function (key) {
      var f = state.flags[key] || { effective: 'off', setByOwner: false }
      var row = el('div', 'flag')
      row.appendChild(el('span', 'name', LABELS[key] ? LABELS[key]() : key))
      row.appendChild(el('span', 'who', f.setByOwner ? t('set.setByOwner') : t('set.setAtStartup')))

      var btn = el('button', null, f.effective === 'on' ? t('set.on') : t('set.off'))
      btn.setAttribute('data-state', f.effective)
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-state') === 'on' ? 'off' : 'on'
        btn.setAttribute('data-state', next)
        btn.textContent = next === 'on' ? t('set.on') : t('set.off')
        state.flags[key] = { effective: next, setByOwner: true }
        row.querySelector('.who').textContent = t('set.setByOwner')
      })
      row.appendChild(btn)

      /* A read source switched on while the master READ_ACCESS is off would be a lie on
         the screen, so it is stated rather than hidden. */
      if (READ_SOURCES.indexOf(key) >= 0 && state.readAccess !== 'on') {
        row.appendChild(el('span', 'note', t('set.masterOff')))
      }
      box.appendChild(row)
    })
  }

  function say (text, kind) {
    var m = $('msg')
    m.textContent = text
    m.className = 'msg' + (kind ? ' ' + kind : '')
  }

  /**
   * ⛔ SAVE IS OFF UNTIL A READ SUCCEEDS. The page must never be able to write settings it
   * never read: the POST body is built from the textareas unconditionally, and on a failed
   * read those are empty — which the server accepts, because an empty string IS a string.
   *
   * The write happened to be blocked before this existed, but only because `requireOwner`
   * gates GET and POST alike. A valid session with a failed read — a 500, a dropped
   * connection, a body that will not parse — had no guard at all.
   */
  function lockSave (message) {
    state.loaded = false
    $('save').disabled = true
    say(message, 'bad')
  }

  function loadAll () {
    $('save').disabled = true // closed until proven open, including while the request is in flight
    fetch('/api/v1/settings', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json()
          .then(function (j) { return { status: r.status, body: j } })
          .catch(function () { return { status: r.status, body: null } })
      })
      .then(function (res) {
        // 401 is not a malfunction — it is a session that ended, and it has its own sentence.
        if (res.status === 401) { lockSave(t('set.notSignedIn')); return }
        if (res.status !== 200 || !res.body || !res.body.ok) { lockSave(t('set.loadFailedSaveOff')); return }
        var j = res.body
        $('style').value = j.style || ''
        $('prefs').value = j.preferences || ''
        state.caps = j.caps || {}
        state.flags = j.flags || {}
        state.readAccess = (j.flags && j.flags.READ_ACCESS && j.flags.READ_ACCESS.effective) || 'off'
        if (j.updatedAt) $('sub').textContent = t('set.lastSaved', { when: j.updatedAt.replace('T', ' ').slice(0, 16) })
        counts()
        renderFlags()
        state.loaded = true
        $('save').disabled = false
      })
      .catch(function () { lockSave(t('set.loadFailedSaveOff')) })
  }

  $('save').addEventListener('click', function () {
    // ⛔ THE HANDLER REFUSES, NOT JUST THE BUTTON. `disabled` is an affordance; a click can
    // still arrive from a script, an enter key, or a stale DOM. The guard belongs where the
    // write is, not only where the finger is.
    if (!state.loaded) { say(t('set.loadFailedSaveOff'), 'bad'); return }
    var btn = $('save')
    btn.disabled = true
    say(t('set.saving'))

    var flags = {}
    Object.keys(LABELS).forEach(function (k) {
      if (state.flags[k]) flags[k] = state.flags[k].effective
    })

    fetch('/api/v1/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ style: $('style').value, preferences: $('prefs').value, flags: flags })
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }) })
      .then(function (res) {
        if (res.status === 200 && res.body.ok) {
          state.flags = res.body.flags || state.flags
          $('sub').textContent = t('set.lastSaved', { when: String(res.body.updatedAt).replace('T', ' ').slice(0, 16) })
          renderFlags()
          say(t('set.savedNextTurn'), 'ok')
          return
        }
        /* A refusal is shown in full: it names what was rejected and why, and says nothing
           was saved. The page never silently edits what the Owner typed. */
        say(res.body.detail || t('set.saveFailed'), 'bad')
      })
      .catch(function () { say(t('set.saveFailed'), 'bad') })
      // ⛔ NOT an unconditional re-enable. Writing `false` here would undo the read guard from
      // inside the save path itself — a failed save would hand the button back on a page that
      // still holds nothing.
      .finally(function () { btn.disabled = !state.loaded })
  })

  $('style').addEventListener('input', counts)
  $('prefs').addEventListener('input', counts)
  /**
   * ⛔ THIS PAGE CARRIES NO WORDS EITHER — same reason as index.html. settings.html ships
   * empty-labelled and every label is set here, through the same resolver.
   */
  var SHELL = [
    ['page-h', 'text', function () { return t('shell.settingsTitle') }],
    ['sub', 'text', function () { return t('set.subtitle') }],
    ['style-h', 'text', function () { return t('set.styleHeading') }],
    ['style-hint', 'text', function () { return t('set.styleHint') }],
    ['prefs-h', 'text', function () { return t('set.prefsHeading') }],
    ['prefs-hint', 'text', function () { return t('set.prefsHint') }],
    ['mem-h', 'text', function () { return t('set.memoryHeading') }],
    ['mem-hint', 'text', function () { return t('set.memoryHint') }],
    ['save', 'text', function () { return t('set.save') }],
    ['foot', 'text', function () { return t('set.footPage') }],
    ['style', 'placeholder', function () { return t('set.stylePlaceholder') }],
    ['prefs', 'placeholder', function () { return t('set.prefsPlaceholder') }]
  ]

  function applyShellText () {
    document.title = t('shell.settingsTitle')
    for (var i = 0; i < SHELL.length; i++) {
      var n = $(SHELL[i][0])
      if (!n) continue
      // The key comes from a table of LITERALS written in this file — see the note in app.js.
      var text = SHELL[i][2]()
      if (SHELL[i][1] === 'text') n.textContent = text
      else n.setAttribute('placeholder', text)
    }
  }
  applyShellText()

  loadAll()
})()
