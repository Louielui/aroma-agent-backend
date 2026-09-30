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
  let followupRunId = null
  function followup (run) {
    const root = el('followup'); root.hidden = !run.finishedAt
    if (!run.finishedAt || followupRunId === run.id) return
    followupRunId = run.id; root.replaceChildren(node('h2', L.followup), node('p', L.followupHelp, 'meta'))
    const form = node('form'); const kind = node('select'); const correction = node('select'); const subject = node('input'); const content = node('textarea'); const taskState = node('select')
    for (const [key, label] of [['open', L.taskOpen], ['completed', L.taskCompleted]]) { const option = node('option', label); option.value = key; taskState.append(option) }
    for (const key of ['decision', 'preference', 'todo']) { const option = node('option', L[key]); option.value = key; kind.append(option) }
    const fresh = node('option', L.newMemory); fresh.value = ''; correction.append(fresh)
    const memories = run.sections.find(s => s.tool === 'memory.decisions')?.rows || []
    for (const row of memories.filter(r => ['decision', 'preference', 'todo'].includes(r.memoryType))) { const option = node('option', L.correction + ' · ' + row.title); option.value = row.id; correction.append(option) }
    subject.required = content.required = true; subject.maxLength = 240; content.maxLength = 4000; content.rows = 4
    for (const [control, label] of [[correction, L.correction], [kind, L.memory], [taskState, L.todo], [subject, L.subject], [content, L.content]]) {
      const wrapper = node('label', label); wrapper.style.display = 'block'; control.style.cssText = 'display:block;width:100%;font:inherit;margin:6px 0 14px;padding:8px'; wrapper.append(control); form.append(wrapper)
    }
    const updateKind = () => { taskState.parentElement.style.display = kind.value === 'todo' ? 'block' : 'none' }
    kind.onchange = updateKind; updateKind()
    correction.onchange = () => { const old = memories.find(r => r.id === correction.value); kind.disabled = subject.readOnly = !!old; if (old) { kind.value = old.memoryType; subject.value = old.title }; updateKind() }
    const submit = node('button', L.propose); submit.type = 'submit'; const notice = node('p'); notice.setAttribute('role', 'status'); form.append(submit, notice); root.append(form)
    let pending = null
    form.onsubmit = async event => {
      event.preventDefault(); if (submit.disabled) return; submit.disabled = true
      const values = { kind: kind.value, subject: subject.value, text: content.value, ...(kind.value === 'todo' ? { taskState: taskState.value } : {}), ...(correction.value ? { supersedes: correction.value } : {}) }
      if (!pending || JSON.stringify(pending.values) !== JSON.stringify(values)) pending = { requestId: crypto.randomUUID(), values }
      try {
        const data = await request('/api/v1/manager/runs/' + encodeURIComponent(run.id) + '/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: pending.requestId, ...pending.values }) })
        notice.replaceChildren(node('span', data.record.status === 'ignored' ? L.followupExcluded : L.followupSaved))
        const review = node('a', L.review); review.href = '/memory?record=' + encodeURIComponent(data.record.id); notice.append(node('span', ' · '), review)
        pending = null; content.value = ''
      } catch (_) { notice.textContent = L.followupError }
      finally { submit.disabled = false }
    }
  }
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
      if (section.state !== 'ok') card.append(node('p', (L[section.availability] || L.unavailable) + (L[section.reason] && section.reason !== section.availability ? ' · ' + L[section.reason] : ''), 'warning'))
      else {
        if(section.tool==='gmail.followups') {
          card.append(node('p',L.mailAnalysisPending+' '+section.pendingAnalysis,'meta'))
          const review=node('a',L.mailBriefingReview); review.href='/company-access#mail-memory'; card.append(review)
        }
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
          if(row.mailCategory) {
            item.append(node('p',L.mailCategories[row.mailCategory],'badge'))
            item.append(node('p',row.mailStatus==='active'?L.mailMemoryApproved:row.mailStatus==='rejected'?L.mailMemoryRejected:L.mailMemoryCandidate,'meta'))
            if(row.mailReview) item.append(node('p',L.mailMemoryNeedsReview,'warning'))
            if(row.mailReview&&L.mailChanges[row.mailChange]) item.append(node('p',L.mailChanges[row.mailChange],'warning'))
            item.append(node('p',L.mailAssignee+': '+(row.assignee||'—')+' · '+L.mailDeadline+': '+(row.deadline||'—'),'meta'))
            if(row.suggestion) item.append(node('p',L.mailSuggestion+': '+row.suggestion))
            if(row.quote) { const cited=node('details'); cited.append(node('summary',L.mailCitation),node('blockquote',row.quote)); if(link(row.quoteLink)) { const source=node('a',L.mailCitation); source.href=link(row.quoteLink); source.target='_blank'; source.rel='noopener noreferrer'; cited.append(source) }; item.append(cited) }
          }
          if (row.date) item.append(node('small', time(row.date)))
          if (section.layer === 'memory') {
            if (L[row.memoryType]) item.append(node('p', L[row.memoryType], 'badge'))
            if (row.approvedAt) item.append(node('p', L.approvedAt + ' · ' + time(row.approvedAt), 'meta'))
            const reference = node('a', L.memoryId + ' · ' + row.id); reference.href = '/memory?record=' + encodeURIComponent(row.id); item.append(reference)
          }
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
    followup(run)
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
