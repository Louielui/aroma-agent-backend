'use strict'

/**
 * buildStamp.test.js — the page and the server must be able to disagree OUT LOUD.
 *
 * ── THE TRAP THIS CLOSES, THREE FOR THREE ────────────────────────────────────
 * `demoHtml.js` inlines app.js and app.css at require() time, so a browser tab loaded
 * before a restart keeps running the OLD client against the NEW server. It has cost a full
 * round three times:
 *
 *   1. the reject button that "worked" and never called the server  (prop_fed3ca71)
 *   2. the deterministic entrance that did not appear
 *   3. the backlog line that did not render                          (2026-08-06)
 *
 * Every time it was diagnosed, recorded, and then recurred. Owner ruling:
 * 「a lesson recorded three times without a mechanism is not a lesson, it is a note.」
 *
 * So the page carries the fingerprint of the assets it was built from, and asks the server
 * what it is serving now. If they differ the page SAYS SO. Nobody has to remember.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { DEMO_HTML, BUILD_STAMP, computeBuildStamp, ASSET_DIR } = require('./demoHtml')

describe('build stamp', () => {
  test('a stamp exists and is short enough to eyeball', () => {
    assert.strictEqual(typeof BUILD_STAMP, 'string')
    assert.ok(BUILD_STAMP.length >= 8 && BUILD_STAMP.length <= 16, 'got: ' + BUILD_STAMP)
  })

  test('the served page carries the stamp it was built from', () => {
    assert.ok(DEMO_HTML.includes(BUILD_STAMP), 'the page must embed its own build stamp')
  })

  test('the stamp changes when a stale-able asset changes — otherwise it detects nothing', () => {
    const before = computeBuildStamp()
    const css = fs.readFileSync(path.join(ASSET_DIR, 'app.css'), 'utf8')
    const after = computeBuildStamp({ 'app.css': css + '\n/* touched */\n' })
    assert.notStrictEqual(after, before, 'a changed asset must produce a different stamp')
  })

  test('the stamp covers app.js, app.css AND index.html', () => {
    const base = computeBuildStamp()
    for (const name of ['app.js', 'app.css', 'index.html']) {
      const original = fs.readFileSync(path.join(ASSET_DIR, name), 'utf8')
      const changed = computeBuildStamp({ [name]: original + ' ' })
      assert.notStrictEqual(changed, base, name + ' must be part of the stamp')
    }
  })

  test('it is a fingerprint, not a timestamp — the same inputs give the same stamp', () => {
    assert.strictEqual(computeBuildStamp(), computeBuildStamp(),
      'a stamp that changes on every call would report every page as stale')
  })
})
