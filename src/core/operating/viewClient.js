'use strict'
;(function () {
  const el = id => document.getElementById(id)
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n }
  const time = value => value ? (Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : String(value)) : L.unknown
  function link (value) {
    try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null } catch (_) { return null }
  }
  async function request (url, options) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const response = await fetch(url, { credentials: 'same-origin', ...options, signal: controller.signal })
      if (response.redirected || response.status === 401) throw Error('login_required')
      const data = await response.json()
      if (!response.ok) throw Error(data.error || 'unavailable')
      return data
    } finally { clearTimeout(timer) }
  }
  for (const id of ['title', 'intro', 'run', 'back']) el(id).textContent = L[id]
  el('mode').textContent = L.noModel
  el('status').textContent = L.idle
  el('audit-title').textContent = L.audit
  el('architecture-title').textContent = L.architecture
  el('history-title').textContent = L.history
  let currentId = null; let currentState = null; let pollTimer = null; let actionBusy = false; let pendingRequest = null; let revision = 0
  function render (run) {
    currentState = run.state
    el('status').textContent = (L[run.state] || L.unavailable) + ' · ' + time(run.finishedAt || run.startedAt)
    el('steps').replaceChildren()
    for (const step of run.steps || []) el('steps').append(node('li', (L.tools[step.tool] || step.tool) + ' · ' + (L[step.state] || L.unavailable)))
    el('controls').replaceChildren()
    const active = ['queued', 'running'].includes(run.state)
    if (active || run.retryId || ['partial', 'unavailable', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(run.state)) {
      const button = node('button', active ? L.cancel : run.retryId ? L.openRetry : L.retry); button.type = 'button'; button.disabled = actionBusy
      button.onclick = () => act(active ? 'cancel' : 'retry')
      el('controls').append(button)
    }
    if (active) el('controls').append(node('p', L.cancelNote, 'meta'))
    el('run').disabled = active || actionBusy
    el('sections').replaceChildren()
    for (const section of run.sections) {
      const card = node('article', null, 'card')
      card.append(node('div', L[section.layer], 'badge'), node('h2', L.tools[section.tool] || section.tool))
      card.append(node('p', L.source + ': ' + section.source + ' · ' + L.checked + ': ' + time(section.checkedAt), 'meta'))
      if (section.state !== 'ok') card.append(node('p', L.unavailable, 'warning'))
      else {
        card.append(node('p', L.received + ': ' + section.count + ' · ' + L.sample + ': ' + section.shownCount))
        if (!section.complete || section.truncated) card.append(node('p', L.limited, 'warning'))
        if (!section.count) card.append(node('p', L.empty, 'meta'))
        if (section.layer === 'memory') card.append(node('p', L.memoryNote, 'warning'))
        const list = node('ul', null, 'rows')
        for (const row of section.rows) {
          const item = node('li')
          const href = link(row.link)
          const heading = node(href ? 'a' : 'strong', row.title || row.id || L.untitled)
          if (href) { heading.href = href; heading.target = '_blank'; heading.rel = 'noopener noreferrer' }
          item.append(heading)
          if (row.text) item.append(node('div', row.text, 'row-text'))
          if (row.date) item.append(node('small', time(row.date)))
          list.append(item)
        }
        card.append(list)
        const detail = node('details'); detail.append(node('summary', L.details))
        detail.append(node('p', L.dataAsOf + ': ' + time(section.dataAsOf), 'meta'))
        detail.append(node('p', L.scope + ': ' + (section.scope || L.unknown), 'meta'))
        detail.append(node('p', L.approval, 'meta'))
        card.append(detail)
      }
      el('sections').append(card)
    }
  }
  async function activity () {
    try {
      const data = await request('/api/v1/manager/activity')
      el('events').replaceChildren()
      el('audit-status').textContent = data.events.length ? L.count + ': ' + data.events.length + ' / ' + data.limit : L.emptyAudit
      const table = node('table')
      const head = node('tr'); for (const text of [L.checked, L.reason, L.source, L.received]) head.append(node('th', text)); table.append(head)
      for (const event of data.events) {
        const row = node('tr')
        row.append(node('td', time(event.at)), node('td', (L.tools[event.tool] || event.workflow) + ' · ' + event.result), node('td', event.source || 'xiangxiang'), node('td', event.count == null ? '—' : event.count))
        row.title = 'Run: ' + event.runId + ' | Actor: ' + event.actor + ' | Agent: ' + (event.agent || 'coordinator') + ' | Model: none | Approval: ' + event.approval
        table.append(row)
      }
      el('events').append(table)
    } catch (_) { el('audit-status').textContent = L.failedAudit }
  }
  async function history () {
    try {
      const data = await request('/api/v1/manager/runs'); el('history').replaceChildren()
      if (!data.runs.length) el('history').append(node('p', L.none))
      for (const run of data.runs) {
        const line = node('p'); const link = node('a', time(run.startedAt) + ' · ' + (L[run.state] || L.unavailable))
        link.href = '/manager?run=' + encodeURIComponent(run.id); line.append(link); el('history').append(line)
      }
      return data.runs
    } catch (_) { el('history').textContent = L.statusFailed; return [] }
  }
  async function poll () {
    const version = revision; const id = currentId
    clearTimeout(pollTimer)
    if (!id || actionBusy) return
    try {
      const data = await request('/api/v1/manager/runs/' + encodeURIComponent(id))
      if (version !== revision) return
      if (!data.run) throw Error()
      render(data.run)
      if (['queued', 'running'].includes(data.run.state)) pollTimer = setTimeout(poll, 1000)
      else { await history(); await activity() }
    } catch (_) {
      if (version !== revision) return
      el('status').textContent = L.statusFailed; el('controls').replaceChildren()
      const button = node('button', L.reload); button.onclick = poll; el('controls').append(button)
    }
  }
  async function act (op) {
    if (actionBusy) return
    actionBusy = true; revision++; clearTimeout(pollTimer); el('run').disabled = true
    el('controls').querySelectorAll('button').forEach(b => { b.disabled = true })
    if (op === 'start' && !pendingRequest) pendingRequest = crypto.randomUUID()
    try {
      const body = op === 'start' ? { op, requestId: pendingRequest } : { op, id: currentId }
      const data = await request('/api/v1/manager/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      currentId = data.run.id; pendingRequest = null
      window.history.replaceState(null, '', '/manager?run=' + encodeURIComponent(currentId))
      actionBusy = false; render(data.run); await poll()
    } catch (e) {
      el('status').textContent = e.message === 'briefing_busy' ? L.busy : L.statusFailed
      el('controls').replaceChildren(); const button = node('button', L.reload); button.onclick = () => currentId ? poll() : act('start'); el('controls').append(button)
    } finally { actionBusy = false; el('run').disabled = ['queued', 'running'].includes(currentState); await history() }
  }
  el('run').addEventListener('click', () => act('start'))
  request('/api/v1/manager/registry').then(data => {
    const root = el('architecture')
    const inventory = node('a', L.inventory); inventory.href = '/architecture'; root.append(inventory)
    for (const agent of data.agents) root.append(node('p', agent.id + ' → ' + agent.tools.map(id => L.tools[id] || id).join(' / ') + ' · ' + agent.engine))
    root.append(node('p', L.planned + ': ' + data.integrations.map(i => i.id + ' (' + i.state + ')').join(', ')))
  }).catch(() => { el('architecture').textContent = L.unavailable })
  activity()
  history().then(runs => {
    currentId = new URLSearchParams(window.location.search).get('run') || (runs[0] && runs[0].id) || null
    poll()
  })
})()
