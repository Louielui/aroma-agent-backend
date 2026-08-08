'use strict'

/**
 * settingsSaveGuard.test.js — Save must not be able to write settings that were never read.
 *
 * ⛔ THE DEFECT THIS PINS. `loadAll()`'s failure path only set a message. Nothing disabled the
 * Save button, and the POST body is built unconditionally from the textareas — so on a failed
 * read the page would send `style: ''`, `preferences: ''`, and the server takes an empty string
 * because an empty string IS a string. The Owner's standing instructions, overwritten with
 * blanks, from a screen that looked operable.
 *
 * > **Owner: 「你今次安全，但係因為讀同寫啱好共用一道閘，唔係因為有人設計過」** — the write was
 * > blocked only because `requireOwner` happens to gate GET and POST alike. The case he named,
 * > a VALID session with a failed read, had no guard at all.
 *
 * ── WHY THIS RUNS THE FILE INSTEAD OF GREPPING IT ────────────────────────────
 * The other client tests beside this one are static assertions over the bundle, and they say so
 * honestly. Static text cannot answer 「is the button disabled」 — that is a value produced by
 * running the code. `settings.js` is a self-contained IIFE whose only globals are `document`,
 * `fetch`, `createResolver`, `CATALOGUE` and `INITIAL_LOCALE`, so it runs in a `vm` against a
 * stub DOM with no new dependency. That makes these the first tests here that observe the
 * client's BEHAVIOUR rather than its source.
 *
 * ⚠ WHAT IT STILL CANNOT SEE: real browser event dispatch, CSS, and whether the button LOOKS
 * disabled. It proves the state machine, not the rendering.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { CATALOGUE } = require('../i18n/catalogue')
const { createResolver } = require('../governance/textResolver')

const SETTINGS_JS = fs.readFileSync(path.join(__dirname, 'assets', 'settings.js'), 'utf8')

/** A DOM stub that never throws: any id or selector yields a usable node. */
function makeDom () {
  const nodes = new Map()
  const mk = (id) => {
    const n = {
      id: id || '',
      value: '',
      textContent: '',
      className: '',
      disabled: false,
      _attrs: {},
      _listeners: {},
      children: [],
      appendChild (c) { this.children.push(c); return c },
      querySelector () { return mk('') },
      setAttribute (k, v) { this._attrs[k] = v },
      getAttribute (k) { return this._attrs[k] },
      addEventListener (ev, fn) { this._listeners[ev] = fn },
      get parentNode () { return this._parent || (this._parent = mk('')) }
    }
    return n
  }
  const document = {
    title: '',
    getElementById (id) {
      if (!nodes.has(id)) nodes.set(id, mk(id))
      return nodes.get(id)
    },
    createElement (tag) { return mk('') },
    addEventListener () {}
  }
  return { document, nodes }
}

/**
 * Run settings.js with a controlled /api/v1/settings response.
 * @param {{status:number, body:object|null, reject?:boolean}} reply
 */
async function run (reply) {
  const { document, nodes } = makeDom()
  const calls = []
  const fetchStub = (url, opts) => {
    calls.push({ url, opts })
    if (reply.reject) return Promise.reject(new Error('network'))
    return Promise.resolve({
      status: reply.status,
      json: () => (reply.body === null
        ? Promise.reject(new Error('not json'))
        : Promise.resolve(reply.body))
    })
  }
  const ctx = {
    document,
    fetch: fetchStub,
    createResolver,
    CATALOGUE,
    INITIAL_LOCALE: 'zh',
    console,
    setTimeout,
    Promise
  }
  vm.createContext(ctx)
  vm.runInContext(SETTINGS_JS, ctx, { filename: 'settings.js' })
  // let the fetch promise chain settle
  for (let i = 0; i < 20; i++) await Promise.resolve()
  return { nodes, calls, save: document.getElementById('save'), msg: document.getElementById('msg') }
}

const OK_BODY = {
  ok: true,
  style: 'S',
  preferences: 'P',
  updatedAt: '2026-08-08T10:00:00.000Z',
  caps: { style: 100, preferences: 100 },
  flags: {},
  flagLabels: {}
}

test('*** a 401 disables Save and says NOT SIGNED IN, not 「read failed」 ***', async () => {
  const r = await run({ status: 401, body: { error: 'owner_auth_required' } })
  assert.equal(r.save.disabled, true, 'Save must be disabled when the settings were never read')
  assert.equal(r.msg.textContent, CATALOGUE['set.notSignedIn'].zh,
    'an expired session and a broken read are different facts and must not share a sentence')
})

test('*** a failed read disables Save ***', async () => {
  const r = await run({ status: 500, body: { ok: false, error: 'settings_read_failed' } })
  assert.equal(r.save.disabled, true)
  assert.equal(r.msg.textContent, CATALOGUE['set.loadFailedSaveOff'].zh)
})

test('*** a network failure disables Save ***', async () => {
  const r = await run({ reject: true })
  assert.equal(r.save.disabled, true)
  assert.equal(r.msg.textContent, CATALOGUE['set.loadFailedSaveOff'].zh)
})

test('*** a good read ENABLES Save — the guard must not lock the page permanently ***', async () => {
  const r = await run({ status: 200, body: OK_BODY })
  assert.equal(r.save.disabled, false)
  assert.equal(r.nodes.get('style').value, 'S')
  assert.equal(r.nodes.get('prefs').value, 'P')
})

test('*** ⛔ clicking Save after a failed read sends NOTHING ***', async () => {
  const r = await run({ status: 401, body: { error: 'owner_auth_required' } })
  const before = r.calls.length
  const click = r.save._listeners.click
  assert.equal(typeof click, 'function', 'the click handler must still be wired')
  click()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(r.calls.length, before,
    'a disabled button is a UI affordance; the handler itself must refuse, because nothing ' +
    'stops a click arriving another way')
})
