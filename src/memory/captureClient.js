/* global L, load */
'use strict'; (() => {
  const byId = id => document.getElementById(id)
  const stateNames = { pending: L.autoPending, processing: L.autoProcessing, saved: L.autoSaved, raw_only: L.autoRawOnly, unconfirmed: L.autoUnconfirmed, skipped: L.autoSkipped, edited: L.autoEdited, forgotten: L.autoForgotten }
  const reasons = { paused: L.autoPaused, disabled: L.autoDisabled, owner_opt_out: L.autoOptOut, sensitive_content: L.autoSensitive, too_long: L.autoTooLong, write_unconfirmed: L.autoUnconfirmed, restart_interrupted: L.autoInterrupted, no_extracted_facts: L.autoRawOnly }
  let enabled = false; let actionBusy = false; let lastSaved = null
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n }
  for (const [id, label] of [['auto-title', L.autoTitle], ['auto-intro', L.autoIntro], ['auto-search-label', L.autoSearchLabel], ['auto-search-button', L.autoSearch], ['auto-history', L.autoHistory]]) byId(id).textContent = label
  async function request(url, body) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const r = await fetch(url, { cache: 'no-store', signal: controller.signal, ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      if (!r.ok || r.redirected) throw Error(); return await r.json()
    } finally { clearTimeout(timer) }
  }
  function card(row) {
    const root = node('article', '')
    root.append(node('strong', (stateNames[row.state] || L.autoUnknown) + ' · ' + (row.source.kind === 'conversation' ? L.autoConversation : L.autoBriefing)))
    root.append(node('small', row.source.id + (row.source.turn ? ' · ' + row.source.turn : '') + ' · ' + (row.source.at || '—')))
    if (row.reason) root.append(node('p', reasons[row.reason] || L.autoUnknown))
    if (row.facts != null) root.append(node('small', L.autoFacts + ': ' + row.facts))
    if (row.preview) root.append(node('p', row.preview))
    if (!['skipped', 'forgotten', 'edited'].includes(row.state)) {
      const show = node('button', L.autoSource); show.type = 'button'
      show.onclick = async () => { show.disabled = true; try { const d = await request('/api/v1/memory/capture/' + encodeURIComponent(row.id)); const p = node('p', d.entry.text || L.autoNoSource); root.append(p); show.remove() } catch (_) { show.disabled = false; byId('auto-notice').textContent = L.autoError } }
      root.append(show)
    }
    if (row.state === 'unconfirmed') { const retry = node('button', L.autoRetry); retry.type = 'button'; retry.onclick = () => act({ op: 'retry', id: row.id }); root.append(retry) }
    return root
  }
  async function refresh() {
    try {
      const d = await request('/api/v1/memory/capture'); enabled = d.enabled
      byId('auto-status').textContent = (d.error ? L.autoError : !d.available ? L.autoDisabled : enabled ? L.autoOn : L.autoPaused) + ' · ' + L.autoPending + ': ' + d.counts.pending + ' · ' + L.autoProcessing + ': ' + d.counts.processing + ' · ' + L.autoSaved + ': ' + d.counts.saved + ' · ' + L.autoRawOnly + ': ' + d.counts.raw_only + ' · ' + L.autoUnconfirmed + ': ' + d.counts.unconfirmed
      byId('auto-toggle').textContent = enabled ? L.autoPause : L.autoResume; byId('auto-toggle').disabled = actionBusy || !d.available
      byId('auto-entries').replaceChildren(...d.entries.map(card))
      if (lastSaved !== null && lastSaved !== d.counts.saved) void load()
      lastSaved = d.counts.saved
    } catch (_) { byId('auto-status').textContent = L.autoError; byId('auto-toggle').disabled = true }
  }
  async function act(body) {
    if (actionBusy) return; actionBusy = true; byId('auto-toggle').disabled = true
    try { await request('/api/v1/memory/capture', body); byId('auto-notice').textContent = L.autoUpdated }
    catch (_) { byId('auto-notice').textContent = L.autoError }
    finally { actionBusy = false; await refresh() }
  }
  byId('auto-toggle').onclick = () => act({ op: 'enabled', value: !enabled })
  byId('auto-search').onsubmit = async e => {
    e.preventDefault(); const root = byId('auto-results'); root.textContent = L.loading
    try { const d = await request('/api/v1/memory/capture?q=' + encodeURIComponent(byId('auto-query').value)); root.replaceChildren(...d.results.map(card)); if (!d.results.length) root.textContent = L.autoNoResults }
    catch (_) { root.textContent = L.autoError }
  }
  void refresh(); const timer = setInterval(() => { if (!document.hidden && !actionBusy) void refresh() }, 5000)
  window.addEventListener('pagehide', () => clearInterval(timer))
})()
