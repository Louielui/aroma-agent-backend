'use strict'
;(function () {
  const el = id => document.getElementById(id)
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n }
  const time = value => value ? (Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : String(value)) : L.unknown
  function link (value) {
    try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null } catch (_) { return null }
  }
  async function request (url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options })
    if (response.redirected || response.status === 401) throw Error('login_required')
    const data = await response.json()
    if (!response.ok) throw Error(data.error || 'unavailable')
    return data
  }
  for (const id of ['title', 'intro', 'run', 'back']) el(id).textContent = L[id]
  el('mode').textContent = L.noModel
  el('status').textContent = L.idle
  el('audit-title').textContent = L.audit
  el('architecture-title').textContent = L.architecture
  function render (run) {
    el('status').textContent = (L[run.state] || L.unavailable) + ' · ' + time(run.finishedAt)
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
  el('run').addEventListener('click', async () => {
    el('run').disabled = true; el('status').textContent = L.running
    try { render(await request('/api/v1/manager/briefing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })) }
    catch (e) { el('status').textContent = e.message === 'briefing_busy' ? L.busy : e.message === 'audit_unavailable' ? L.auditBlocked : L.unavailable }
    finally { el('run').disabled = false; await activity() }
  })
  request('/api/v1/manager/registry').then(data => {
    const root = el('architecture')
    for (const agent of data.agents) root.append(node('p', agent.id + ' → ' + agent.tools.map(id => L.tools[id] || id).join(' / ') + ' · ' + agent.engine))
    root.append(node('p', L.planned + ': ' + data.integrations.map(i => i.id + ' (' + i.state + ')').join(', ')))
  }).catch(() => { el('architecture').textContent = L.unavailable })
  activity()
})()
