/* settings.js — load, edit, save. No polling, no autosave, no timers. */
(function () {
  'use strict'

  var LABELS = {
    CONVERSATION_RECALL: '對話記憶',
    DECISION_RECALL: '決定記憶',
    CONTEXT_DRIVE: '讀取 Drive',
    CONTEXT_GMAIL: '讀取 Gmail',
    CONTEXT_CALENDAR: '讀取 Calendar',
    CONTEXT_GITHUB: '讀取 GitHub'
  }
  var READ_SOURCES = ['CONTEXT_DRIVE', 'CONTEXT_GMAIL', 'CONTEXT_CALENDAR', 'CONTEXT_GITHUB']

  var $ = function (id) { return document.getElementById(id) }
  var state = { flags: {}, caps: {}, readAccess: 'off' }

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
      row.appendChild(el('span', 'name', LABELS[key]))
      row.appendChild(el('span', 'who', f.setByOwner ? '你設定' : '啟動時設定'))

      var btn = el('button', null, f.effective === 'on' ? '開' : '關')
      btn.setAttribute('data-state', f.effective)
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-state') === 'on' ? 'off' : 'on'
        btn.setAttribute('data-state', next)
        btn.textContent = next === 'on' ? '開' : '關'
        state.flags[key] = { effective: next, setByOwner: true }
        row.querySelector('.who').textContent = '你設定'
      })
      row.appendChild(btn)

      /* A read source switched on while the master READ_ACCESS is off would be a lie on
         the screen, so it is stated rather than hidden. */
      if (READ_SOURCES.indexOf(key) >= 0 && state.readAccess !== 'on') {
        row.appendChild(el('span', 'note', '總開關 READ_ACCESS 係關嘅，所以呢個開咗都唔會讀到'))
      }
      box.appendChild(row)
    })
  }

  function say (text, kind) {
    var m = $('msg')
    m.textContent = text
    m.className = 'msg' + (kind ? ' ' + kind : '')
  }

  function loadAll () {
    fetch('/api/v1/settings', { credentials: 'same-origin' })
      .then(function (r) { return r.json() })
      .then(function (j) {
        if (!j.ok) throw new Error('read failed')
        $('style').value = j.style || ''
        $('prefs').value = j.preferences || ''
        state.caps = j.caps || {}
        state.flags = j.flags || {}
        state.readAccess = (j.flags && j.flags.READ_ACCESS && j.flags.READ_ACCESS.effective) || 'off'
        if (j.updatedAt) $('sub').textContent = '上次儲存 ' + j.updatedAt.replace('T', ' ').slice(0, 16)
        counts()
        renderFlags()
      })
      .catch(function () { say('讀取設定失敗', 'bad') })
  }

  $('save').addEventListener('click', function () {
    var btn = $('save')
    btn.disabled = true
    say('儲存中…')

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
          $('sub').textContent = '上次儲存 ' + String(res.body.updatedAt).replace('T', ' ').slice(0, 16)
          renderFlags()
          say('已儲存。下次對話即時生效。', 'ok')
          return
        }
        /* A refusal is shown in full: it names what was rejected and why, and says nothing
           was saved. The page never silently edits what the Owner typed. */
        say(res.body.detail || '儲存失敗', 'bad')
      })
      .catch(function () { say('儲存失敗', 'bad') })
      .finally(function () { btn.disabled = false })
  })

  $('style').addEventListener('input', counts)
  $('prefs').addEventListener('input', counts)
  loadAll()
})()
