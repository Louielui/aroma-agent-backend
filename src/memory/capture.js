'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { resolveDataDir } = require('../store/dataDir')
const { ID } = require('./hindsight')
const { exclusionReason } = require('./capturePolicy')
function sourceId(key) {
  const h = createHash('sha256').update(key).digest('hex')
  return 'xx-' + h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32)
}
const digest = value => createHash('sha256').update(value).digest('hex')
function capturePolicyText(row) {
  if (row.source.kind !== 'conversation') return row.text
  const prefix = 'Conversation ' + row.source.id + ', turn ' + row.source.turn + ', captured ' + row.source.at + '\nOWNER SAID:\n'
  const marker = '\nASSISTANT SAID (suggestions and claims, not verified actions):\n'
  const end = row.text.indexOf(marker, prefix.length)
  return row.text.startsWith(prefix) && end >= prefix.length ? row.text.slice(prefix.length, end) : null
}
function reconcilable(row) {
  if (row.state !== 'unconfirmed' || !['write_unconfirmed', 'restart_interrupted'].includes(row.reason) || !row.text || row.text.length > 30000 ||
      !['conversation', 'briefing'].includes(row.source?.kind) || typeof row.source.id !== 'string' || !row.source.id ||
      typeof row.source.at !== 'string' || !Number.isFinite(Date.parse(row.source.at)) ||
      row.id !== sourceId(row.source.kind + ':' + row.source.id + ':' + (row.source.turn || ''))) return false
  const policy = capturePolicyText(row)
  return policy !== null && !exclusionReason(policy) && !exclusionReason(row.text, false)
}
function verifiedCapture(row, proof) {
  const r = proof?.record, indexed = proof?.indexed, origin = proof?.origin
  if (!r || !indexed || !origin || r.id !== row.id || r.text !== row.text || r.subject !== row.source.kind + ' · ' + row.source.id ||
      r.type !== 'episodic' || r.scope !== 'private:owner' || r.owner !== 'owner' || r.status !== 'active' || r.supersedes || r.supersededBy ||
      (r.expiresAt && (!Number.isFinite(Date.parse(r.expiresAt)) || Date.parse(r.expiresAt) <= Date.now())) ||
      r.approval?.kind !== 'policy' || r.approval.id !== 'owner_history' || r.approval.actor !== 'owner' ||
      typeof r.approval.at !== 'string' || !Number.isFinite(Date.parse(r.approval.at)) || !Number.isInteger(r.version) || r.version <= 0 ||
      !Number.isInteger(r.index?.facts) || typeof r.index.checkedAt !== 'string' || !Number.isFinite(Date.parse(r.index.checkedAt)) ||
      !((r.index.state === 'saved' && r.index.facts > 0) || (r.index.state === 'raw_only' && r.index.facts === 0)) ||
      indexed.state !== r.index.state || indexed.facts !== r.index.facts || indexed.canonicalVersion !== r.version || indexed.textHash !== digest(row.text)) return false
  const migrated = r.source?.kind === 'historical_import'
  const expected = { kind: migrated ? 'historical_import' : row.source.kind, id: row.source.id + ':' + (row.source.turn || ''), at: row.source.at,
    attribution: row.source.kind === 'briefing' ? 'measured_result' : 'historical_import' }
  const sameSource = source => source && Object.keys(source).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => source[key] === value)
  if (!sameSource(r.source)) return false
  if (!migrated) return origin.kind === 'native_capture'
  return origin.kind === 'capture_history_import' && origin.firstVersion === 1 && /^[a-f0-9]{64}$/.test(origin.auditHash || '') &&
    origin.textHash === indexed.textHash && sameSource(origin.source) && origin.approval &&
    Object.keys(origin.approval).length === Object.keys(r.approval).length && Object.entries(r.approval).every(([key, value]) => origin.approval[key] === value)
}
function createCapture({ dir = path.join(resolveDataDir(), 'memory-capture'), client, available = () => true } = {}) {
  let loaded = false; let enabled = true; let active = null; let locked = false; let lastError = null; let timer = null; let reconciledId = ''
  const entries = new Map()
  function persist(name, value) {
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, name + '.json'); const temp = target + '.' + randomUUID() + '.tmp'
    try { fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, target) }
    catch (_) { try { fs.unlinkSync(temp) } catch (_) {} throw Error('capture_store_unavailable') }
  }
  function save(row) { row.updatedAt = new Date().toISOString(); persist(row.id, row); entries.set(row.id, row); return structuredClone(row) }
  function load() {
    if (loaded) return
    let files; try { files = fs.readdirSync(dir) } catch (e) { if (e.code !== 'ENOENT') throw Error('capture_store_unavailable'); files = [] }
    for (const file of files) {
      if (file !== 'settings.json' && !(file.endsWith('.json') && ID.test(file.slice(0, -5)))) continue
      let row; try { row = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) } catch (_) { throw Error('capture_store_unavailable') }
      if (file === 'settings.json') { if (typeof row.enabled !== 'boolean') throw Error('capture_store_unavailable'); enabled = row.enabled; continue }
      if (row.id + '.json' !== file || typeof row.text !== 'string' || !row.source || typeof row.state !== 'string') throw Error('capture_store_unavailable')
      if (row.state === 'processing') { row.state = 'unconfirmed'; row.reason = 'restart_interrupted'; save(row) }
      entries.set(row.id, row)
    }
    loaded = true
  }
  function get(id) { load(); if (!ID.test(id || '')) throw Error('invalid_capture_id'); return entries.has(id) ? structuredClone(entries.get(id)) : null }
  function capture(source, text, policyText = text) {
    load(); const id = sourceId(source.kind + ':' + source.id + ':' + (source.turn || ''))
    if (entries.has(id)) return get(id)
    const reason = !available() ? 'disabled' : !enabled ? 'paused' : exclusionReason(policyText) || exclusionReason(text, false) || (text.length > 30000 ? 'too_long' : null)
    return save({ id, source, text: reason ? '' : text, state: reason ? 'skipped' : 'pending', reason, facts: null, attempts: 0, createdAt: new Date().toISOString() })
  }
  function turn(input, messageCount) {
    const source = { kind: 'conversation', id: input.id, turn: messageCount, at: input.now || new Date().toISOString() }
    const text = 'Conversation ' + source.id + ', turn ' + source.turn + ', captured ' + source.at + '\nOWNER SAID:\n' + input.userText + '\nASSISTANT SAID (suggestions and claims, not verified actions):\n' + input.replyText
    return capture(source, text, String(input.userText))
  }
  function run(r) {
    const source = { kind: 'briefing', id: r.id, at: r.finishedAt }
    const evidence = { runId: r.id, state: r.state, finishedAt: r.finishedAt, sources: r.sections.map(s => ({ tool: s.tool, state: s.state, count: s.count, completeWithinScope: s.complete === true })) }
    return capture(source, 'MEASURED WORK RESULT (historical evidence, not current business truth or approval):\n' + JSON.stringify(evidence))
  }
  async function work() {
    if (active || locked || !available()) return
    try {
      load(); if (!enabled) return
      if (typeof client?.getCaptureEvidence === 'function') {
        // One historical receipt per tick, rotating past unresolved evidence.
        // This never retries extraction and cannot starve new pending receipts.
        const history = [...entries.values()].filter(reconcilable).sort((a, b) => a.id.localeCompare(b.id))
        const receipt = history.find(r => r.id.localeCompare(reconciledId) > 0) || history[0]
        if (receipt) {
          reconciledId = receipt.id; active = receipt.id
          const original = structuredClone(receipt)
          try {
            const proof = await client.getCaptureEvidence(receipt.id)
            const current = entries.get(receipt.id)
            if (enabled && available() && !locked && JSON.stringify(current) === JSON.stringify(original) && reconcilable(current) && verifiedCapture(current, proof)) {
              const row = structuredClone(current)
              row.state = proof.record.index.state; row.facts = proof.record.index.facts; row.reason = row.state === 'saved' ? null : 'no_extracted_facts'
              row.reconciliation = { at: new Date().toISOString(), canonicalVersion: proof.record.version, textHash: proof.indexed.textHash, origin: proof.origin.kind }
              save(row)
            }
          } catch (_) { /* Unavailable, revoked or mismatched evidence remains retryable by the Owner. */ }
          finally { active = null }
        }
      }
      if (!enabled || !available() || locked) return
      const row = [...entries.values()].find(r => r.state === 'pending'); if (!row) return
      active = row.id; row.state = 'processing'; row.attempts++; save(row)
      try {
        // A stable document id plus read-back prevents duplicate ingestion on explicit retry.
        let doc = await client.get(row.id)
        if (!doc || doc.text !== row.text || !(doc.facts > 0 || doc.indexState === 'raw_only')) doc = await client.retainAutomatic(row.id, row.text, row.source)
        if (!doc || doc.text !== row.text || !(doc.facts > 0 || (doc.facts === 0 && doc.indexState === 'raw_only'))) throw Error('unconfirmed')
        row.state = doc.facts > 0 ? 'saved' : 'raw_only'; row.facts = doc.facts; row.reason = doc.facts > 0 ? null : 'no_extracted_facts'; save(row)
      } catch (_) { row.state = 'unconfirmed'; row.reason = 'write_unconfirmed'; save(row) }
    } catch (_) { lastError = 'capture_store_unavailable' }
    finally { active = null }
  }
  function status() {
    load(); const rows = [...entries.values()]
    return { enabled, available: available(), active, error: lastError, counts: Object.fromEntries(['pending', 'processing', 'saved', 'raw_only', 'unconfirmed', 'skipped', 'edited', 'forgotten'].map(s => [s, rows.filter(r => r.state === s).length])),
      entries: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(({ text, ...r }) => r) }
  }
  function search(query) { load(); const q = String(query).trim().toLowerCase(); if (q.length < 2 || q.length > 100) throw Error('invalid_search'); return [...entries.values()].filter(r => r.text.toLowerCase().includes(q)).slice(-20).reverse().map(r => ({ id: r.id, source: r.source, state: r.state, preview: r.text.slice(0, 400) })) }
  function setEnabled(value) { load(); if (typeof value !== 'boolean') throw Error('invalid_setting'); persist('settings', { enabled: value }); enabled = value; return status() }
  function retry(id) { const r = get(id); if (!r || r.state !== 'unconfirmed') throw Error('not_retryable'); if (!enabled || !available()) throw Error('capture_paused'); r.state = 'pending'; r.reason = null; return save(r) }
  function suppress(id, state) {
    if (active) throw Error('memory_busy')
    if (!['edited', 'forgotten'].includes(state)) throw Error('invalid_state')
    const r = get(id); if (!r) return
    r.state = state; r.text = ''; r.reason = null; return save(r)
  }
  async function mutate(id, state, fn) {
    if (active || locked) throw Error('memory_busy')
    // A timed-out request can still be running upstream. Require verified retry
    // before a correction/deletion, so that late extraction cannot resurrect it.
    if (id && get(id)?.state === 'unconfirmed') throw Error('memory_write_unconfirmed')
    locked = true
    try { if (id) suppress(id, state); return await fn() } finally { locked = false }
  }
  function safe(fn) { try { return fn() } catch (_) { lastError = 'capture_store_unavailable'; return null } }
  function start() { if (!timer) { timer = setInterval(() => { void work() }, 3000); timer.unref() } }
  function stop() { clearInterval(timer); timer = null }
  return { turn, run, get, work, status, search, retry, suppress, mutate, setEnabled, start, stop, safe }
}
function wrapConversationStore(store, capture) {
  return { ...store, appendTurn(input) { const result = store.appendTurn(input); capture.safe(() => capture.turn(input, result.messageCount)); return result } }
}
module.exports = { createCapture, wrapConversationStore }
