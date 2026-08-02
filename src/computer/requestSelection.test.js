'use strict'

/**
 * requestSelection.test.js — WHICH request a Companion picks up, and what happens to the rest.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * `readdirSync(dir).filter(CREATED__).sort()[0]`. Filenames are `CREATED__req_<random hex>.json`,
 * so that sorted on RANDOMNESS. It reads like "take the oldest" and means "take whichever random
 * id sorts first", and the comment above it said only "the one request this process will handle"
 * — the criterion was never stated anywhere, so it could not be wrong on paper.
 *
 * On the Owner's machine `req_1edf3e52…` from the previous day, expired for 20.6 hours, won every
 * sort ('1' beats 'b' and 'f'). Two fresh approvals in a row were shadowed by it and reported as
 * "too old to use", which described the dead file and not the live approval the Owner had just
 * made. Deterministic, not intermittent: it would have happened every time, forever.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *   retire anything expired -> take the NEWEST live request by request.createdAt -> ties break
 *   on requestId ascending.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createRequestStore } = require('./executeRequestStore')

const T0 = Date.parse('2026-08-02T12:00:00.000Z')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'req-sel-'))

/** Write a CREATED record straight to disk, the way the producer does. */
function put (dir, { id, createdAt, ttlMs = 30 * 60 * 1000 }) {
  const req = {
    schemaVersion: 1,
    messageType: 'execute-canary-request',
    requestId: id,
    approvalId: 'appr_' + id.slice(4, 12).padEnd(32, '0'),
    approvedOrderHash: 'a'.repeat(64),
    executionPackageManifestHash: 'b'.repeat(64),
    receiptHash: 'c'.repeat(64),
    canaryType: 'notepad-canary',
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + ttlMs).toISOString()
  }
  fs.writeFileSync(path.join(dir, 'CREATED__' + id + '.json'),
    JSON.stringify({ state: 'CREATED', request: req, createdAt: new Date(createdAt).toISOString() }, null, 2))
  return req
}

const storeAt = (dir, nowMs) => createRequestStore({ dir, now: () => nowMs })
const names = (dir) => fs.readdirSync(dir).sort()

/* ── 1. one expired + one valid ───────────────────────────────────────────── */

test('*** 1. an expired request does not shadow a valid one ***', () => {
  const dir = tmp()
  // The real shape of the failure: the dead one sorts FIRST by filename.
  const dead = put(dir, { id: 'req_1edf3e52de497808705210e3', createdAt: T0 - 21 * 3600 * 1000 })
  const live = put(dir, { id: 'req_b62b31ea0d6ce93b7576eb3c', createdAt: T0 - 60 * 1000 })

  const sel = storeAt(dir, T0).selectPending()
  assert.equal(sel.ok, true)
  assert.equal(sel.requestId, live.requestId, 'the LIVE request is chosen')
  assert.notEqual(sel.requestId, dead.requestId)
  assert.equal(sel.expiredRetired, 1, 'and the dead one is retired')
})

test('*** 1b. POSITIVE CONTROL — the OLD filename sort picks the dead one ***', () => {
  // Without this, test 1 could be passing for a reason unrelated to the fix. This is the exact
  // expression that was in tool-start-companion.js, run against the exact ids from the machine.
  const dir = tmp()
  put(dir, { id: 'req_1edf3e52de497808705210e3', createdAt: T0 - 21 * 3600 * 1000 })
  put(dir, { id: 'req_b62b31ea0d6ce93b7576eb3c', createdAt: T0 - 60 * 1000 })

  const oldPick = fs.readdirSync(dir).filter((n) => n.startsWith('CREATED__') && n.endsWith('.json')).sort()[0]
  assert.match(oldPick, /req_1edf3e52/, 'the old rule really does select the expired request')

  const rec = JSON.parse(fs.readFileSync(path.join(dir, oldPick), 'utf8'))
  assert.ok(T0 >= Date.parse(rec.request.expiresAt), 'and it really is expired at this moment')
  // So test 1 would have been RED under the old rule. The fix is what makes it green.
})

/* ── 2. many expired ──────────────────────────────────────────────────────── */

test('*** 2. several expired requests are all skipped and none shadows the live one ***', () => {
  const dir = tmp()
  for (let i = 0; i < 4; i++) put(dir, { id: 'req_0' + i + 'aaaaaaaaaaaaaaaaaaaaaaa', createdAt: T0 - (20 - i) * 3600 * 1000 })
  const live = put(dir, { id: 'req_zzzzzzzzzzzzzzzzzzzzzzzz', createdAt: T0 - 5 * 60 * 1000 })

  const sel = storeAt(dir, T0).selectPending()
  assert.equal(sel.ok, true)
  assert.equal(sel.requestId, live.requestId, 'chosen even though it sorts LAST by filename')
  assert.equal(sel.expiredSeen, 4)
  assert.equal(sel.expiredRetired, 4)
  assert.equal(sel.candidates, 1)

  // Retired, not deleted: every one is still on disk and still readable.
  const after = names(dir)
  assert.equal(after.filter((n) => n.startsWith('EXPIRED__')).length, 4)
  assert.equal(after.filter((n) => n.startsWith('CREATED__')).length, 1)
  for (const n of after.filter((x) => x.startsWith('EXPIRED__'))) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
    assert.ok(rec.request.requestId, 'the retired record kept its content')
  }
})

/* ── 3. several valid ─────────────────────────────────────────────────────── */

test('*** 3. among several LIVE requests the NEWEST by createdAt wins ***', () => {
  const dir = tmp()
  const older = put(dir, { id: 'req_aaaaaaaaaaaaaaaaaaaaaaaa', createdAt: T0 - 10 * 60 * 1000 })
  const newest = put(dir, { id: 'req_mmmmmmmmmmmmmmmmmmmmmmmm', createdAt: T0 - 1 * 60 * 1000 })
  const middle = put(dir, { id: 'req_zzzzzzzzzzzzzzzzzzzzzzzz', createdAt: T0 - 5 * 60 * 1000 })

  const sel = storeAt(dir, T0).selectPending()
  assert.equal(sel.requestId, newest.requestId)
  assert.equal(sel.candidates, 3, 'the others are left alone, not retired')
  assert.equal(sel.expiredRetired, 0)
  assert.equal(names(dir).filter((n) => n.startsWith('CREATED__')).length, 3)

  // POSITIVE CONTROL: the answer is not an accident of filename order. The newest sorts in the
  // MIDDLE alphabetically, so a filename sort would have returned `older`, and a reverse
  // filename sort would have returned `middle`. Neither is the right answer.
  const byName = names(dir).filter((n) => n.startsWith('CREATED__'))
  assert.match(byName[0], /req_aaaa/, 'ascending filename would give the older one')
  assert.match(byName[byName.length - 1], /req_zzzz/, 'descending filename would give the middle one')
  assert.notEqual(older.requestId, newest.requestId)
  assert.notEqual(middle.requestId, newest.requestId)
})

test('*** 3b. an exact createdAt tie breaks on requestId, so the choice is repeatable ***', () => {
  const dir = tmp()
  put(dir, { id: 'req_bbbbbbbbbbbbbbbbbbbbbbbb', createdAt: T0 - 60 * 1000 })
  put(dir, { id: 'req_aaaaaaaaaaaaaaaaaaaaaaaa', createdAt: T0 - 60 * 1000 })
  const first = storeAt(dir, T0).selectPending().requestId
  const again = storeAt(dir, T0).selectPending().requestId
  assert.equal(first, 'req_aaaaaaaaaaaaaaaaaaaaaaaa', 'ties break on requestId ascending')
  assert.equal(first, again, 'and the same input gives the same answer')
})

/* ── 4. retirement failing must not block a valid request ─────────────────── */

test('*** 4. a retirement that FAILS does not stop the live request being handled ***', () => {
  const dir = tmp()
  put(dir, { id: 'req_1111111111111111111111', createdAt: T0 - 21 * 3600 * 1000 })
  const live = put(dir, { id: 'req_9999999999999999999999', createdAt: T0 - 60 * 1000 })

  // Rename always throws — the shape of "another process has that file open".
  const brokenFs = Object.assign(Object.create(fs), {
    renameSync () { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) }
  })
  const sel = createRequestStore({ dir, now: () => T0, fs: brokenFs }).selectPending()

  assert.equal(sel.ok, true, 'the live request is still selected')
  assert.equal(sel.requestId, live.requestId)
  assert.equal(sel.retireFailures, 1, 'and the failure is COUNTED, not swallowed')
  assert.equal(sel.expiredRetired, 0)
  // The stale file is still CREATED, and will simply be skipped again next time.
  assert.equal(names(dir).filter((n) => n.startsWith('CREATED__')).length, 2)
})

/* ── 5. nothing live ──────────────────────────────────────────────────────── */

test('*** 5. no live request says so — it does NOT say "too old" ***', () => {
  const dir = tmp()
  put(dir, { id: 'req_1edf3e52de497808705210e3', createdAt: T0 - 21 * 3600 * 1000 })

  const sel = storeAt(dir, T0).selectPending()
  assert.equal(sel.ok, false)
  assert.equal(sel.reason, 'no_pending_request')
  assert.notEqual(sel.reason, 'request_expired')
  assert.equal(sel.expiredRetired, 1)

  // "too old to use" describes a REQUEST. Reporting it when there is none told the Owner his
  // fresh approval had expired when it had not, and cost two account switches.
  assert.equal(JSON.stringify(sel).includes('too old'), false)
})

test('*** 5b. an empty directory is also "none", never an error about age ***', () => {
  const dir = tmp()
  const sel = storeAt(dir, T0).selectPending()
  assert.equal(sel.ok, false)
  assert.equal(sel.reason, 'no_pending_request')
  assert.equal(sel.candidates, 0)
  assert.equal(sel.expiredSeen, 0)
})

/* ── unreadable files are reported, not silently skipped ──────────────────── */

test('*** a corrupt request file is counted and reported, never silently ignored ***', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'CREATED__req_broken.json'), '{ not json')
  const live = put(dir, { id: 'req_aaaaaaaaaaaaaaaaaaaaaaaa', createdAt: T0 - 60 * 1000 })

  const sel = storeAt(dir, T0).selectPending()
  assert.equal(sel.ok, true)
  assert.equal(sel.requestId, live.requestId)
  assert.equal(sel.unreadable, 1, '"nothing to do" must never mean "everything here is broken"')
})

/* ── the Companion actually uses this, and no longer sorts filenames ──────── */

test('*** the Companion delegates the choice and no filename sort remains ***', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'computer', 'tool-start-companion.js'), 'utf8')
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(code, /selectPending\(\)/, 'it asks the store')
  assert.equal(/\.filter\([^)]*CREATED__[\s\S]{0,80}\.sort\(\)/.test(code), false, 'the filename sort is gone')
  assert.equal(code.includes('pendingRequestFile'), false, 'and so is the old picker')
  // Retirement is surfaced to the person watching the window.
  assert.match(code, /Cleared ' \+ sel\.expiredRetired/, 'it says when it cleared something away')
  assert.match(code, /retireFailures/, 'and when it could not')
})
