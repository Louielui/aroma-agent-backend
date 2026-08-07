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

  test('the briefing carries all three sections, each with a timestamp', async () => {
    const srv = await serve(createApp({ serviceToken: TOKEN }))
    const r = await req(srv, 'GET', '/api/v1/home/briefing')
    srv.close()
    for (const k of ['errands', 'waiting', 'backlog']) {
      assert.ok(r.json[k], k + ' missing from the briefing')
      assert.ok(r.json[k].checkedAt, k + ' has no checkedAt — a claim without a time is not a claim')
      assert.ok(r.json[k].state, k + ' has no state')
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
    assert.match(r.json.saying, /唔會自動清/)
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
