'use strict'

/**
 * inertStoresAreLoud.test.js — an inert implementation may not look like it worked.
 *
 * ── WHY THIS IS A CLASS GUARD AND NOT THREE ASSERTIONS ───────────────────────
 * Silent degradation has now been reintroduced TWICE by the change that was fixing it.
 *
 *   Round 1: the demo router defaulted its conversation store to the real writer, so a
 *            test suite wrote fixture conversations into the Owner's data directory.
 *   Round 2: the fix for that — inverting the default to an inert store — shipped an
 *            appendTurn that returned `{ id: null, messageCount: 0 }`. A success SHAPE.
 *            Had the production wiring ever regressed, conversations would have stopped
 *            being saved and nothing anywhere would have said so.
 *
 * The settings router got this right in the same commit (`INERT_SAVE` throws) and the
 * conversation store got it wrong, which is the real lesson: two inert implementations in
 * one codebase disagreed about whether silence is acceptable, and nothing forced them to
 * agree. A one-off correction to one of them would not have held either.
 *
 * ── THE RULE THIS FILE ENFORCES ──────────────────────────────────────────────
 * Every `INERT_*` export in src/ is discovered by scanning, not by a list here — a list is
 * the thing that goes stale. For each one:
 *
 *   WRITE-shaped methods (append/save/write/create/update/persist/record/commit)
 *     MUST THROW. Returning anything at all is a claim that the work was done.
 *   DESTRUCTIVE methods (remove/delete)
 *     must throw OR return a falsy value — `false` is a truthful "nothing was removed",
 *     which the routes already surface as a 404, so it is not a silent success.
 *   READ-shaped methods (list/get/read/load/find)
 *     are UNCHECKED. An inert store legitimately reads as empty; that is the whole point
 *     of it being usable at all.
 *
 * And a module that DECLARES an inert implementation without exporting it fails here too,
 * because an invariant that cannot be inspected cannot be guaranteed.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname, '..')

const WRITE_RE = /^(append|save|write|create|update|persist|put|record|commit)/i
const DESTRUCTIVE_RE = /^(remove|delete|purge|clear|drop)/i

/** Every non-test .js under src/. */
function sourceFiles (dir = SRC, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (name !== 'node_modules') sourceFiles(p, out); continue }
    if (name.endsWith('.js') && !name.includes('.test.')) out.push(p)
  }
  return out
}

/** Files that declare an inert implementation, by scanning rather than by a list. */
function filesDeclaringInert () {
  return sourceFiles().filter((p) => /\bINERT_[A-Z0-9_]+\s*=/.test(fs.readFileSync(p, 'utf8')))
}

const rel = (p) => path.relative(SRC, p).replace(/\\/g, '/')

/** Call it with benign args and report what happened. */
function invoke (fn, ctx) {
  try {
    const value = fn.call(ctx, { id: 'inert-guard-probe-0001', userText: 'x', replyText: 'y' })
    return { threw: false, value }
  } catch (_) {
    return { threw: true }
  }
}

/* ── the discovery itself must not silently find nothing ─────────────────── */

test('*** the scan finds the inert implementations that exist ***', () => {
  const files = filesDeclaringInert().map(rel)
  // If this drops to zero, the guard has stopped guarding and would pass forever.
  assert.ok(files.length >= 2, 'expected at least the two known inert implementations, found: ' + files.join(', '))
  assert.ok(files.includes('store/conversationStore.js'), 'the conversation store declares one')
  assert.ok(files.includes('routes/settingsRouter.js'), 'the settings router declares one')
})

test('*** an inert implementation that is not exported cannot be guarded, and fails ***', () => {
  const unexportable = []
  for (const p of filesDeclaringInert()) {
    const src = fs.readFileSync(p, 'utf8')
    const declared = [...src.matchAll(/\b(INERT_[A-Z0-9_]+)\s*=/g)].map((m) => m[1])
    let mod
    try { mod = require(p) } catch (_) { continue }
    for (const name of new Set(declared)) {
      if (!(name in mod)) unexportable.push(`${rel(p)}:${name}`)
    }
  }
  assert.deepEqual(unexportable, [],
    'declared but not exported, so this guard cannot inspect it: ' + unexportable.join(', '))
})

/* ── the rule ────────────────────────────────────────────────────────────── */

test('*** no inert WRITE returns a success-shaped value — it throws ***', () => {
  const offenders = []
  for (const p of filesDeclaringInert()) {
    let mod
    try { mod = require(p) } catch (_) { continue }
    for (const [key, val] of Object.entries(mod)) {
      if (!key.startsWith('INERT_')) continue

      // A bare inert function (INERT_SAVE) — the name says what it stands in for.
      if (typeof val === 'function') {
        if (!WRITE_RE.test(key.replace(/^INERT_/, ''))) continue
        if (!invoke(val).threw) offenders.push(`${rel(p)}:${key}() returned instead of throwing`)
        continue
      }

      // An inert object standing in for a store.
      if (!val || typeof val !== 'object') continue
      for (const [m, fn] of Object.entries(val)) {
        if (typeof fn !== 'function') continue
        if (WRITE_RE.test(m)) {
          if (!invoke(fn, val).threw) offenders.push(`${rel(p)}:${key}.${m}() returned instead of throwing`)
        } else if (DESTRUCTIVE_RE.test(m)) {
          const r = invoke(fn, val)
          if (!r.threw && r.value) offenders.push(`${rel(p)}:${key}.${m}() returned a truthy value`)
        }
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join(' | '))
})

test('the two known inert implementations agree with each other', () => {
  const { INERT_CONVERSATION_STORE } = require('./conversationStore')
  const { INERT_SAVE } = require('../routes/settingsRouter')
  // THE POINT OF THIS ROUND: these two disagreed, and nothing made them agree.
  assert.throws(() => INERT_SAVE({}), /settings_store_not_wired/)
  assert.throws(() => INERT_CONVERSATION_STORE.appendTurn({ id: 'a', userText: 'b', replyText: 'c' }),
    /conversation_store_not_wired/)
})

test('an inert READ is still allowed to answer emptily — it is not broken, it is empty', () => {
  const { INERT_CONVERSATION_STORE } = require('./conversationStore')
  assert.deepEqual(INERT_CONVERSATION_STORE.list(), [])
  assert.equal(INERT_CONVERSATION_STORE.get('anything'), null)
  assert.equal(INERT_CONVERSATION_STORE.remove('anything'), false, 'a truthful "nothing removed", surfaced as 404')
})
