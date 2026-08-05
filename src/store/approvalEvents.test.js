'use strict'

/**
 * approvalEvents.test.js — approval decisions become durable, in the store that already
 * holds operational truth.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * `approvalAudit` in app.js is an in-memory array capped at 500 plus one console.log line.
 * The Owner's first principle is that operational truth is permanent and conversations are
 * temporary; approval decisions were on the wrong side of that line — they survived only as
 * long as a log file.
 *
 * WHAT IS GENUINELY LOST WHEN THE LOG ROTATES, as opposed to reconstructable:
 *   reconstructable  approved / cancelled — the proposal record carries status + who
 *   GONE FOREVER     every REFUSED attempt. A bad nonce, a dead session, an expired order,
 *                    a hash mismatch — nothing else in the system records that someone
 *                    tried and was turned away.
 *
 * ── NOT A SECOND DECISION STORE ─────────────────────────────────────────────
 * Owner constraint: 「this must not become a second Decision store… two records of what was
 * decided is how they start disagreeing.」
 *
 * `events` already exists in the truth store, beside `decisions`, with a settled shape
 * ({ id, type, entity_id, actor, at }) and existing members — decision.created,
 * task.created, dispatch.*. This ADDS TYPES to that stream. It does not add a collection, a
 * file, or a second answer to "what was decided": the proposal record remains the only
 * statement of a proposal's status, and these events are the record of what HAPPENED.
 */

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-approval-events-'))

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')

const store = require('./store')

const ROOT = path.resolve(__dirname, '..', '..')

/* ═══ 1. THE EVENTS EXIST AND CARRY WHAT THE OWNER ASKED FOR ═════════════ */

test('*** an approval event records who, when, and the work order hash ***', () => {
  const out = store.recordApprovalEvent({
    type: 'approved',
    approvalId: 'appr_1',
    proposalId: 'prop_1',
    workOrderHash: 'a'.repeat(64),
    actor: 'louie',
    reason: 'agent_execute_accepted',
    entryPoint: 'owner_local'
  })
  assert.equal(out.ok, true)
  const ev = store.listApprovalEvents().find((e) => e.approval_id === 'appr_1')
  assert.ok(ev, 'not written')
  assert.equal(ev.type, 'approval.approved')
  assert.equal(ev.actor, 'louie')
  assert.equal(ev.work_order_hash, 'a'.repeat(64))
  assert.equal(ev.proposal_id, 'prop_1')
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(ev.at), 'no timestamp: ' + ev.at)
})

test('*** all seven lifecycle types are accepted ***', () => {
  // The Owner's list, plus the three additions he accepted: sealed, refused, expired.
  for (const t of ['sealed', 'approved', 'rejected', 'cancelled', 'expired', 'executed', 'refused']) {
    const r = store.recordApprovalEvent({ type: t, approvalId: 'appr_' + t, actor: 'louie' })
    assert.equal(r.ok, true, t)
  }
  const types = store.listApprovalEvents().map((e) => e.type)
  for (const t of ['sealed', 'approved', 'rejected', 'cancelled', 'expired', 'executed', 'refused']) {
    assert.ok(types.includes('approval.' + t), 'missing: ' + t)
  }
})

test('*** an unknown type is REFUSED, not silently written ***', () => {
  // A typo'd type would create a category nothing queries and nothing counts — a silent
  // hole in the one record that exists to have no holes.
  const r = store.recordApprovalEvent({ type: 'appruved', approvalId: 'x', actor: 'louie' })
  assert.equal(r.ok, false)
  assert.ok(/unknown/i.test(r.error || ''), r.error)
  assert.equal(store.listApprovalEvents().some((e) => e.approval_id === 'x'), false, 'it was written anyway')
})

/* ═══ 2. NO CAP. NOTHING DISCARDED. ══════════════════════════════════════ */

test('*** nothing is ever dropped — the Owner ruled no cap ***', () => {
  const before = store.listApprovalEvents().length
  for (let i = 0; i < 600; i++) {
    store.recordApprovalEvent({ type: 'refused', approvalId: 'bulk_' + i, actor: 'louie', reason: 'no_session' })
  }
  const after = store.listApprovalEvents()
  assert.equal(after.length, before + 600, 'events were dropped')
  // 600 crosses the old in-memory 500 cap. The oldest must still be there — that cap
  // silently dropping the oldest decision is what this replaces.
  assert.ok(after.some((e) => e.approval_id === 'bulk_0'), 'the oldest was discarded')
})

test('listApprovalEvents returns ALL of them, oldest first — not a tail', () => {
  const all = store.listApprovalEvents()
  const idx0 = all.findIndex((e) => e.approval_id === 'bulk_0')
  const idx1 = all.findIndex((e) => e.approval_id === 'bulk_1')
  assert.ok(idx0 >= 0 && idx1 > idx0, 'not in write order')
})

/* ═══ 3. THE SAME ATOMIC PATH AND THE SAME LOCK ══════════════════════════ */

test('*** it goes through withLock — the same critical section as everything else ***', () => {
  const src = fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8')
  const at = src.indexOf('function recordApprovalEvent')
  assert.ok(at > 0, 'function not found')
  const body = src.slice(at, src.indexOf('\nfunction ', at + 10))
  assert.ok(/withLock\(/.test(body), 'not serialised — a concurrent write would be lost')
  assert.ok(/save\(db\)/.test(body), 'not written through the atomic save')
  assert.equal(/writeFileSync\(/.test(body), false, 'it must not write the file itself')
})

test('*** CONCURRENCY: parallel writers all survive ***', () => {
  // The defect this must not have. Two processes doing load->mutate->save without the lock
  // each save their own snapshot and one set of records disappears, with no corruption
  // anywhere to notice. Proven with REAL processes, not by reading the code.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-approval-conc-'))
  const N = 8
  const each = 25
  const code = `
    const s = require(${JSON.stringify(path.join(__dirname, 'store.js'))})
    const tag = process.argv[1]
    for (let i = 0; i < ${each}; i++) {
      s.recordApprovalEvent({ type: 'refused', approvalId: tag + '_' + i, actor: 'louie', reason: 'bad_nonce' })
    }
  `
  const kids = []
  for (let k = 0; k < N; k++) {
    kids.push(require('node:child_process').spawn(
      process.execPath, ['-e', code, 'w' + k],
      { env: Object.assign({}, process.env, { AROMA_DATA_DIR: dir }), stdio: 'ignore' }
    ))
  }
  const waits = kids.map((c) => new Promise((res) => c.on('close', res)))
  return Promise.all(waits).then(() => {
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'aroma-truth.json'), 'utf8'))
    const evs = db.events.filter((e) => String(e.type).startsWith('approval.'))
    assert.equal(evs.length, N * each, `lost writes: got ${evs.length} of ${N * each}`)
    const ids = new Set(evs.map((e) => e.approval_id))
    assert.equal(ids.size, N * each, 'duplicate or overwritten ids')
  })
})

/* ═══ 4. IT NEVER CARRIES CONTENT ════════════════════════════════════════ */

test('*** ids and short enums only — never a goal, a file or a reply ***', () => {
  store.recordApprovalEvent({
    type: 'sealed',
    approvalId: 'appr_scrub',
    actor: 'louie',
    reason: 'x'.repeat(500),
    goal: 'SECRET GOAL TEXT',
    file: 'C:/somewhere/private.md',
    reply: 'SECRET REPLY'
  })
  const ev = store.listApprovalEvents().find((e) => e.approval_id === 'appr_scrub')
  const json = JSON.stringify(ev)
  assert.equal(/SECRET/.test(json), false, 'content rode in: ' + json)
  assert.equal(/private\.md/.test(json), false, 'a path rode in: ' + json)
  assert.ok(ev.reason.length <= 64, 'the reason is not bounded: ' + ev.reason.length)
})

/* ═══ 5. IT IS NOT A SECOND DECISION STORE ═══════════════════════════════ */

test('*** it adds TYPES to the existing events stream, not a collection ***', () => {
  const db = JSON.parse(fs.readFileSync(path.join(process.env.AROMA_DATA_DIR, 'aroma-truth.json'), 'utf8'))
  assert.deepEqual(Object.keys(db).sort(), ['decisions', 'dispatches', 'events', 'llm_usage', 'tasks'],
    'a new top-level collection appeared: ' + Object.keys(db))
  const src = fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8')
  assert.equal(/db\.approval/.test(src), false, 'a separate approval collection exists')
})

test('the existing event members are untouched', () => {
  const src = fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8')
  for (const t of ['decision.created', 'task.created', 'dispatch.created']) {
    assert.ok(src.includes(t), 'an existing event type was lost: ' + t)
  }
})
