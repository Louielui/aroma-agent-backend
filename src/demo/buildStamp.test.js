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

  test('⛔ AND THE CATALOGUE — rewording is a page change, so it must move the stamp', () => {
    /**
     * The words the page shows now live in `src/i18n/catalogue.js`, not in app.js. Without the
     * catalogue in the fingerprint, rewording anything would change what the page SAYS and not
     * change its stamp — so a tab holding the old wording would report itself current. That is
     * exactly the failure the stamp exists to catch, walking back in through the door the
     * bilingual work opened.
     *
     * `computeBuildStamp` takes overrides by ASSET NAME, and the catalogue is not an asset, so
     * this proves it the only way available: mutate the real module cache, recompute, restore.
     */
    const base = computeBuildStamp()
    const cataloguePath = require.resolve('../i18n/catalogue')
    const real = require('../i18n/catalogue').CATALOGUE
    const patched = Object.assign({}, real, {
      'briefing.nothingWaiting': { zh: '（改咗字）', en: '(reworded)' }
    })
    require.cache[cataloguePath].exports = { CATALOGUE: patched }
    delete require.cache[require.resolve('../i18n/browserResolver')]
    try {
      assert.notStrictEqual(computeBuildStamp(), base,
        'a reworded catalogue must produce a different stamp, or a stale tab believes itself current')
    } finally {
      require.cache[cataloguePath].exports = { CATALOGUE: real }
      delete require.cache[require.resolve('../i18n/browserResolver')]
    }
    assert.strictEqual(computeBuildStamp(), base, 'and restoring it must restore the stamp')
  })

  test('it is a fingerprint, not a timestamp — the same inputs give the same stamp', () => {
    assert.strictEqual(computeBuildStamp(), computeBuildStamp(),
      'a stamp that changes on every call would report every page as stale')
  })
})
