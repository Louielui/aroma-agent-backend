'use strict'

/**
 * greetingBacklog.test.js — the backlog line rides on the greeting, and NEVER breaks it.
 *
 * ── THE OWNER'S NON-NEGOTIABLE CONSTRAINT ────────────────────────────────────
 * 「the constraint that greeting must render even when Drive does not answer」
 *
 * The greeting is a pure function of the clock today. Attaching a network read to it trades
 * a screen that always works for a feature that usually does. So: the greeting is computed
 * FIRST and returned regardless; the backlog line is attached only if it resolves in time.
 * A Drive outage costs the line, never the greeting.
 *
 * The line surfaces by itself because the failure mode is the Owner FORGETTING — an answer
 * he has to ask for inherits the same defect, and would also route through a classifier
 * measured as non-deterministic (M-5).
 */

const { test, describe } = require('node:test')
const { CATALOGUE } = require('../i18n/catalogue')
const assert = require('node:assert')
const express = require('express')
const { createDemoRouter } = require('./demoRouter')

function appWith (deps) {
  const app = express()
  app.use(express.json())
  // The greeting sits behind demoGuard, exactly like every sibling route. Setting this is
  // what the real app does; leaving it out yields 403, not a greeting.
  app.locals.conversationDemo = true
  app.use(createDemoRouter(deps))
  return app
}

/** No supertest in this repo (no new dependencies). Same harness as conversationRoutes.test.js. */
async function get (app, p) {
  const server = app.listen(0)
  try {
    const port = server.address().port
    const res = await fetch('http://127.0.0.1:' + port + p, { headers: { Accept: 'application/json' } })
    let json = null
    try { json = await res.json() } catch (_) {}
    return { status: res.status, body: json }
  } finally { server.close() }
}

describe('greeting + backlog line', () => {
  test('the greeting still renders when the backlog read THROWS', async () => {
    const app = appWith({ readBacklogFn: async () => { throw new Error('drive exploded') } })
    const res = await get(app, '/api/v1/demo/greeting')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.ok, true)
    assert.ok(res.body.greeting, 'the greeting itself must survive a Drive failure')
    // OWNER RULING REVERSED 2026-08-06: a failure SPEAKS. Returning null renders identically
    // to 「nothing waiting」, and that is the one meaning it must never carry.
    // ⛔ The KEY against the response, the WORDING against the catalogue (HR-51). Grepping
    // 「出錯」 on the body went green on the phrasing, which now lives in the catalogue and
    // can be rewritten in either locale without this noticing.
    assert.strictEqual(res.body.backlog, CATALOGUE['route.driveError'].zh)
    assert.match(CATALOGUE['route.driveError'].zh, /出錯|失敗/)
    assert.match(CATALOGUE['route.driveError'].en, /fail/i)
  })

  test('the greeting still renders when the backlog read HANGS past its budget', async () => {
    const app = appWith({
      readBacklogFn: () => new Promise((resolve) => setTimeout(resolve, 5000)),
      backlogTimeoutMs: 20
    })
    const started = Date.now()
    const res = await get(app, '/api/v1/demo/greeting')
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.greeting)
    // A TIMEOUT MUST NOT BE SILENT. This exact case shipped as null and cost a round: the
    // read took 3.2-5.6s against a 2.5s budget, so every cold render showed nothing while
    // 64 files sat in Drive.
    assert.strictEqual(res.body.backlog, CATALOGUE['route.driveStillReading'].zh)
    assert.match(CATALOGUE['route.driveStillReading'].zh, /未拿到|還在/)
    assert.match(CATALOGUE['route.driveStillReading'].en, /still|no count/i)
    assert.ok(Date.now() - started < 2000, 'must not wait for a hung Drive call')
  })

  test('the line is attached when there is something waiting', async () => {
    const app = appWith({
      readBacklogFn: async () => ({
        scanned: { state: 'FILES_WAITING', fileCount: 64, batchCount: 7, nonEmptyBatchCount: 4, oldestBatchAgeDays: 53 },
        inbox: { state: 'FILES_WAITING', fileCount: 2 }
      })
    })
    const res = await get(app, '/api/v1/demo/greeting')
    assert.strictEqual(res.status, 200)
    assert.match(res.body.backlog, /64/)
    assert.match(res.body.backlog, /53/)
    // CONVERTED (HR-51): the wording lives in the catalogue; the page must RENDER it.
    assert.ok(res.body.backlog.includes(CATALOGUE['backlog.countCaveat'].zh))
  })

  test('a CLEAR result speaks and proves it looked — silence cannot distinguish clear from broken', async () => {
    const app = appWith({
      readBacklogFn: async () => ({
        scanned: { state: 'EMPTY', fileCount: 0 },
        inbox: { state: 'EMPTY', fileCount: 0 },
        checkedAt: '2026-08-06T00:47:00.000Z'
      })
    })
    const res = await get(app, '/api/v1/demo/greeting')
    assert.ok(res.body.backlog, 'a clear result must not be silent')
    // CONVERTED (HR-51): assert the WORDING on the entry, not on the response body.
    // The route renders the STAMPED form, so the shared clause is asserted on that entry.
    const emptyClause = CATALOGUE['backlog.folderEmpty'].zh.split('」')[1].split('{')[0]
    assert.ok(res.body.backlog.includes(emptyClause), res.body.backlog)
  })

  test('a read FAILURE speaks — silence there would read as "nothing waiting"', async () => {
    const app = appWith({
      readBacklogFn: async () => ({
        scanned: { state: 'READ_FAILED', fileCount: null, reason: 'timeout' },
        inbox: { state: 'READ_FAILED', fileCount: null, reason: 'timeout' }
      })
    })
    const res = await get(app, '/api/v1/demo/greeting')
    // CONVERTED (HR-51): the catalogue is not inlined here, but the wording is catalogue
    // wording, so it is asserted on the entry — and a read FAILURE must never read as empty.
    assert.ok(res.body.backlog, 'a read failure must produce a sentence, not silence')
    assert.ok(res.body.backlog.includes(CATALOGUE['backlog.inboxUnreadable'].zh.split('{')[0].trim()) ||
              /看不到/.test(res.body.backlog), res.body.backlog)
  })

  test('with no backlog reader injected at all the route behaves exactly as before', async () => {
    const app = appWith({})
    const res = await get(app, '/api/v1/demo/greeting')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.ok, true)
    assert.ok(res.body.greeting)
    // Silence is reserved for one case only: no reader injected, i.e. the feature is off.
    assert.strictEqual(res.body.backlog, null)
  })
})
