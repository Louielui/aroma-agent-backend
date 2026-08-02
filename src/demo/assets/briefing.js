/* briefing.js — renders one brief. No polling, no auto-refresh, no timers. */
(function () {
  'use strict'

  var SECTIONS = [
    { key: 'today', title: 'Today' },
    { key: 'recentActivity', title: 'Recent Activity' },
    { key: 'risks', title: 'Risks / Blockers' },
    { key: 'topPriorities', title: 'Top Priorities' },
    { key: 'decisionsNeeded', title: 'Decisions Needed' }
  ]

  var btn = document.getElementById('gen')
  var out = document.getElementById('out')
  var sub = document.getElementById('sub')

  /* Everything below builds DOM with textContent. Brief text quotes external sources —
     Gmail subjects, file names — and that content is untrusted by definition, so it is
     never inserted as markup anywhere on this page. */
  function el (tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function when (s) {
    if (!s) return ''
    return s.display || s.iso || ''
  }

  function renderItem (it) {
    var d = el('div', 'item')
    var p = el('p', 'text')
    p.appendChild(el('span', 'kind ' + it.kind, it.kind))
    p.appendChild(document.createTextNode(it.text))
    d.appendChild(p)

    if (it.provenance) {
      var pr = it.provenance
      var line = el('div', 'prov')
      var bits = pr.source
      if (pr.originalDate && (pr.originalDate.display || pr.originalDate.iso)) bits += ' · ' + when(pr.originalDate)
      if (pr.usedFallback) bits += ' · (recent items, not a keyword match)'
      line.appendChild(document.createTextNode(bits + ' · '))
      if (pr.link) {
        var a = el('a', null, 'open')
        a.href = pr.link
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        line.appendChild(a)
      } else {
        line.appendChild(document.createTextNode('id=' + pr.sourceId))
      }
      d.appendChild(line)
    }
    if (it.basedOnFactIds && it.basedOnFactIds.length) {
      d.appendChild(el('div', 'based', 'based on ' + it.basedOnFactIds.join(', ')))
    }
    return d
  }

  function renderSection (spec, items, alwaysOpen, withheld) {
    var s = el('section', alwaysOpen ? 'always' : '')
    var head = el('div', 'head')
    head.appendChild(el('h2', null, spec.title))
    var summary = items.length === 0 ? '沒有' : items.length + ' 項'
    /* A COUNT, NEVER THE CONTENT. Withheld items were removed by the delivery validator
       because their evidence did not hold up. Their text is precisely what must not be
       shown, so only how many were withheld appears — never what they said. */
    if (withheld > 0) summary += ' · ' + withheld + ' 項因證據不足未有顯示'
    head.appendChild(el('span', 'summary', summary))
    head.appendChild(el('span', 'chev', '▸'))
    s.appendChild(head)

    var body = el('div', 'body')
    if (items.length === 0) {
      body.appendChild(el('p', 'none', '沒有 — 這是讀到的結果，不是缺少資料。'))
    } else {
      items.forEach(function (it) { body.appendChild(renderItem(it)) })
    }
    s.appendChild(body)

    if (!alwaysOpen) {
      head.addEventListener('click', function () {
        s.classList.toggle('open')
        head.querySelector('.chev').textContent = s.classList.contains('open') ? '▾' : '▸'
      })
    }
    return s
  }

  var STATE_TEXT = { live: 'live', live_zero: 'read OK — no results', unavailable: 'UNAVAILABLE' }

  /* The six coverage failure codes, in words. The Owner needs to know which KIND of
     failure it was — a credential to fix, a permission to grant, a blip to ignore. */
  var REASON_TEXT = {
    configured_off: 'not configured',
    credential_unavailable: 'credential unavailable',
    permission_denied: 'permission denied',
    timeout: 'timed out',
    read_failed: 'read failed',
    source_unavailable: 'source unavailable'
  }

  function renderCoverage (rows) {
    var s = el('section', 'always')
    var head = el('div', 'head')
    head.appendChild(el('h2', null, 'Data Coverage'))
    var readable = rows.filter(function (r) { return r.state !== 'unavailable' }).length
    head.appendChild(el('span', 'summary', readable + '/' + rows.length + ' 來源可讀'))
    s.appendChild(head)

    var body = el('div', 'body')
    rows.forEach(function (r) {
      var row = el('div', 'cov')
      row.appendChild(el('span', 'name', r.source))
      row.appendChild(el('span', 'state ' + r.state, STATE_TEXT[r.state] || r.state))
      /* A FIXED CODE, plus a scrubbed detail if the server had one. The adapter's own
         message never arrives here — it carried URLs, paths, addresses and queries. */
      var why = ''
      if (r.state === 'unavailable') {
        why = REASON_TEXT[r.errorCode] || r.errorCode || 'unavailable'
        if (r.errorDetail) why += ' (' + r.errorDetail + ')'
      } else if (r.state === 'live') {
        why = r.count + ' item(s)' + (r.usedFallback ? ' · recent items' : '')
      }
      row.appendChild(el('span', 'why', why))
      body.appendChild(row)
    })
    s.appendChild(body)
    return s
  }

  function render (brief) {
    out.textContent = ''
    var withheld = brief.withheldCounts || {}
    SECTIONS.forEach(function (spec) {
      out.appendChild(renderSection(spec, brief.sections[spec.key] || [], false, withheld[spec.key] || 0))
    })
    out.appendChild(renderCoverage(brief.sections.dataCoverage || []))
    sub.textContent = 'Generated ' + when(brief.generatedAt) + ' · ' + brief.briefId
  }

  btn.addEventListener('click', function () {
    btn.disabled = true
    btn.textContent = 'Generating…'
    out.textContent = ''
    fetch('/api/v1/briefing/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }) })
      .then(function (res) {
        /* The server sends a fixed error code and no detail -- an adapter's message is
           written for developers and can carry URLs, ids and queries. */
        if (res.status !== 200 || !res.body.ok) throw new Error((res.body && res.body.error) || ('HTTP ' + res.status))
        render(res.body.brief)
      })
      .catch(function (e) {
        out.textContent = ''
        out.appendChild(el('p', 'err', '產生失敗：' + e.message))
      })
      .finally(function () {
        btn.disabled = false
        btn.textContent = 'Generate Briefing'
      })
  })
})()
