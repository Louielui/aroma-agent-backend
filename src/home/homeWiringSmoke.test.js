'use strict'
/**
 * homeWiringSmoke.test.js — ⛔ RED WHEN THE WIRING IS REMOVED, NOT THE COMPONENT.
 *
 * > **Owner: 「yesterday found four things wired to nothing and I am not adding a fifth.」**
 *
 * These go through the REAL composition root — `createApp()` — so they fail if 首頁's routes
 * are never mounted, exactly as `routeTableSmoke.test.js` fails when the enquiry router is not.
 * A unit test proves a component behaves; only this proves it is REACHED.
 */
const { test, describe } = require('node:test')
const { t } = require('../i18n/t')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { createApp } = require('../app')
const { openErrandStore, OUTCOME } = require('./errandStore')

const TOKEN = 'smoke-token'

function serve (app) {
  return new Promise((resolve) => {
    const srv = http.createServer(app)
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
function req (srv, method, p, body) {
  const { port } = srv.address()
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'content-type': 'application/json' } }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => { let j = null; try { j = JSON.parse(d) } catch (_) {} resolve({ status: res.statusCode, json: j, raw: d }) })
    })
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'homewire-'))

describe('首頁 IS MOUNTED — not merely built', () => {
  test('GET /api/v1/home/briefing answers through the real app', async () => {
    const srv = await serve(createApp({ serviceToken: TOKEN }))
    const r = await req(srv, 'GET', '/api/v1/home/briefing')
    srv.close()
    assert.notStrictEqual(r.status, 404,
      'if this 404s, mountHomeRoutes is never called by createApp — the fifth thing wired to nothing')
    assert.ok(r.json, 'and it must answer JSON, not an error page')
  })

  test('⛔ every section reaches a state ONLY A REAL READ CAN PRODUCE', async () => {
    // DEFECT-011: the previous version asserted each section HAD a state and a checkedAt.
    // `NOT_CHECKED` satisfies both — so a wiring test PASSED with the Drive reader connected
    // to nothing. HR-6, failing inside a test written to catch this exact class: assert the
    // VALUE, not that the key appeared.
    const srv = await serve(createApp({ serviceToken: TOKEN }))
    const r = await req(srv, 'GET', '/api/v1/home/briefing')
    srv.close()
    const UNREACHABLE = ['NOT_WIRED'] // a defect, never a condition
    for (const k of ['errands', 'waiting', 'backlog']) {
      assert.ok(r.json[k], k + ' missing from the briefing')
      assert.ok(!UNREACHABLE.includes(r.json[k].state),
        k + ' is ' + r.json[k].state + ' — that state means nothing called its reader')
    }
    for (const k of ['errands', 'waiting']) {
      assert.ok(r.json[k].checkedAt, k + ' claims a read but carries no time')
    }
  })

  test('⛔ a section that did NOT read carries no time — the DEFECT-011 invariant', async () => {
    const srv = await serve(createApp({ serviceToken: TOKEN }))
    const r = await req(srv, 'GET', '/api/v1/home/briefing')
    srv.close()
    const b = r.json.backlog
    if (b.state === 'NOT_CHECKED' || b.state === 'NOT_WIRED') {
      assert.strictEqual(b.checkedAt, undefined, '一個非聲稱配一個時間，衰過冇時間')
      assert.strictEqual(b.checkedAtLabel, undefined)
    } else {
      assert.ok(b.checkedAt, 'a real read must carry the time OF THAT READ')
    }
  })

  test('⛔ it NEVER returns a blank body, even with no store on disk', async () => {
    const srv = await serve(createApp({ serviceToken: TOKEN }))
    const r = await req(srv, 'GET', '/api/v1/home/briefing')
    srv.close()
    assert.ok(r.raw.length > 40, 'a blank response renders as a blank screen')
    assert.notStrictEqual(r.json.waiting.state, undefined)
  })

  test('the open endpoint is mounted and refuses an unknown errand rather than 404ing the ROUTE', async () => {
    const srv = await serve(createApp({ serviceToken: TOKEN }))
    const r = await req(srv, 'POST', '/api/v1/home/errand/nope/open', {})
    srv.close()
    assert.strictEqual(r.status, 404)
    assert.ok(r.json && r.json.outcome, 'a mounted route answers with a REASON; an unmounted one answers with the catch-all')
    assert.strictEqual(r.json.outcome, 'ERRAND_NOT_FOUND')
  })
})

describe('the open button honours the measured lock behaviour', () => {
  const { mountHomeRoutes } = require('./homeRoutes')
  const express = require('express')

  const withStore = (rows, profileDir, launcher) => {
    const d = tmp()
    const store = openErrandStore(d)
    for (const r of rows) store.record(r)
    const app = express()
    app.use(express.json())
    mountHomeRoutes(app, { store, profileDir, launcher })
    return { app, d }
  }
  const stopped = {
    id: 'c1',
    title: 'Costco',
    outcome: OUTCOME.STOPPED_FOR_YOU,
    at: Date.now(),
    stop: { where: 'https://www.costco.ca/checkout', notPressed: { role: 'button', name: 'Place Your Order', ref: 'r1' } }
  }

  test('⛔ it REFUSES while she holds the profile, and says it will not clear the lock', async () => {
    const profile = tmp()
    fs.writeFileSync(path.join(profile, 'lockfile'), 'x')
    let launched = false
    const { app, d } = withStore([stopped], profile, () => { launched = true; return { unref () {} } })
    const srv = await serve(app)
    const r = await req(srv, 'POST', '/api/v1/home/errand/c1/open', {})
    srv.close()
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.json.outcome, 'PROFILE_IN_USE')
    assert.strictEqual(launched, false, 'nothing may be launched onto a locked profile')
    assert.ok(fs.existsSync(path.join(profile, 'lockfile')), '⛔ the lock must still be there')
    // ⛔ KEPT AS WORDING, and this is the strongest case for keeping one. The rule is 「never
    // auto-clear a stale SingletonLock」, and what must reach him is the REFUSAL PLUS ITS
    // REASON — a refusal without its reason reads as an obstacle and invites removal. Asserting
    // the key would pass for a key whose text had quietly lost the second half.
    assert.match(r.json.saying, /不會自動清|唔會自動清/)
    fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true })
  })

  test('with a free profile it launches Chrome AT HER PROFILE and the recorded url', async () => {
    const profile = tmp()
    let got = null
    const { app, d } = withStore([stopped], profile, (exe, args) => { got = { exe, args }; return { unref () {} } })
    const srv = await serve(app)
    const r = await req(srv, 'POST', '/api/v1/home/errand/c1/open', {})
    srv.close()
    assert.strictEqual(r.json.outcome, 'OPENED')
    assert.ok(got.args.some((a) => a.includes('--user-data-dir=' + profile)),
      'if this fails the page would open in HIS Chrome and show an empty cart')
    assert.ok(got.args.includes('https://www.costco.ca/checkout'))
    fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true })
  })

  test('the link works at ANY age — 過期嘅係主張，唔係 access', async () => {
    const profile = tmp()
    const old = { ...stopped, id: 'old', at: Date.now() - 40 * 24 * 3600 * 1000 }
    let launched = false
    const { app, d } = withStore([old], profile, () => { launched = true; return { unref () {} } })
    const srv = await serve(app)
    const r = await req(srv, 'POST', '/api/v1/home/errand/old/open', {})
    srv.close()
    assert.strictEqual(r.json.outcome, 'OPENED')
    assert.strictEqual(launched, true, 'refusing to open his own cart would be the system overreaching')
    fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true })
  })
})

describe('⛔ a wired reader must produce a LINE and a TIME, not just a state', () => {
  const { mountHomeRoutes } = require('./homeRoutes')
  const express = require('express')

  test('the first fix connected the wire and the section still said nothing', async () => {
    // Live evidence: `state: PRESENT` with no `line` and no `checkedAtLabel`, because
    // readBacklogFn returns the RAW reading while the section needs the sentence, and the
    // reading's checkedAt is an ISO string where the briefing stamps milliseconds.
    // A connected wire that renders blank is DEFECT-011 with a different last mile.
    const app = express()
    app.use(express.json())
    mountHomeRoutes(app, {
      store: { list: () => [] },
      profileDir: 'C:\nowhere',
      backlogReader: async () => ({ line: '64 個檔案,最舊 53 日', checkedAt: Date.now() })
    })
    const srv = await serve(app)
    const r = await req(srv, 'GET', '/api/v1/home/briefing')
    srv.close()
    assert.strictEqual(r.json.backlog.state, 'PRESENT')
    assert.ok(r.json.backlog.line && r.json.backlog.line.length > 3, 'PRESENT with no line says nothing')
    assert.ok(r.json.backlog.checkedAtLabel, 'and a read must carry its own time, formatted')
  })
})
