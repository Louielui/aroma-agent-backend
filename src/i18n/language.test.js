'use strict'
/**
 * language.test.js — entry 8 of 8: the interface language is a setting he can change.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「The registry hitting 8 of 8: add language, then stop.」**
 *
 * ⛔ WHAT 「LIVE」 WOULD HAVE BEEN A LIE ABOUT. The demo page is assembled ONCE at module load,
 * so a language change cannot reach an already-built document. It reaches:
 *   · server-rendered text — on the next render, immediately;
 *   · the page — on the next RELOAD, because the client reads the setting at boot;
 *   · and never requires a restart.
 * That is why the entry declares `RELOAD_PAGE` rather than `LIVE`.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ENTRIES, APPLIES, validate } = require('../governance/settingsRegistry')
const { LOCALES, DEFAULT_LOCALE } = require('../governance/textResolver')

let dir
let savedEnv
let savedCtx
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-'))
  process.env.AROMA_DATA_DIR = dir
  savedEnv = process.env.XIANGXIANG_LOCALE
  delete process.env.XIANGXIANG_LOCALE
  // ⛔ These tests are ABOUT the stored setting, so they opt back into reading it — see the
  // note in i18n/t.js on why every other test does not.
  savedCtx = process.env.NODE_TEST_CONTEXT
  delete process.env.NODE_TEST_CONTEXT
  require('../home/settingsValues')._resetCache()
})
afterEach(() => {
  if (savedEnv === undefined) delete process.env.XIANGXIANG_LOCALE
  else process.env.XIANGXIANG_LOCALE = savedEnv
  if (savedCtx === undefined) delete process.env.NODE_TEST_CONTEXT
  else process.env.NODE_TEST_CONTEXT = savedCtx
  delete process.env.AROMA_DATA_DIR
  require('../home/settingsValues')._resetCache()
  fs.rmSync(dir, { recursive: true, force: true })
})

const settings = () => require('../home/settingsValues')
const langEntry = () => ENTRIES.find((e) => e.id === 'language')

describe('⛔ the language is a setting, and the registry is now full', () => {
  test('the entry exists and offers exactly the locales the resolver knows', () => {
    const e = langEntry()
    assert.ok(e, 'language is entry 8')
    assert.deepStrictEqual(e.oneOf, [...LOCALES],
      'the offered list and the supported list must be the same list, not two lists that agree today')
    assert.strictEqual(e.def, DEFAULT_LOCALE)
  })

  test('⛔ it declares RELOAD_PAGE, not LIVE — because the page is built once', () => {
    assert.strictEqual(langEntry().appliesOn, APPLIES.RELOAD_PAGE,
      'claiming LIVE would be the calmest kind of lie: he would believe it took')
    assert.ok(langEntry().howToApply, 'and it says what to do about it')
  })

  test('changing it changes what the server renders, at use time', () => {
    const { t, currentLocale } = require('./t')
    assert.strictEqual(currentLocale(), DEFAULT_LOCALE)
    const zh = t('briefing.nothingWaiting')

    assert.strictEqual(settings().set('language', 'en').ok, true)
    settings()._resetCache()

    assert.strictEqual(currentLocale(), 'en')
    const en = t('briefing.nothingWaiting')
    assert.notStrictEqual(en, zh, 'the same key, a different language, no restart')
    assert.strictEqual(en, 'Nothing needs you.')
  })

  test('⛔ SEEN TO FAIL — an unsupported locale is REFUSED, not silently ignored', () => {
    // Without the fence an unknown locale falls back to the default at render time, which
    // looks exactly like the setting having failed to save.
    const bad = validate('language', 'fr')
    assert.strictEqual(bad.ok, false)
    assert.strictEqual(bad.reason, 'not_in_list')
    assert.match(bad.saying, /zh/, 'and it says what IS allowed')

    assert.strictEqual(settings().set('language', 'en').ok, true)
    settings()._resetCache()
    assert.strictEqual(settings().set('language', 'fr').ok, false)
    settings()._resetCache()
    assert.strictEqual(require('./t').currentLocale(), 'en', 'the refused write changed nothing')
  })

  test('the env override wins over the stored value — a test must not read his settings', () => {
    assert.strictEqual(settings().set('language', 'en').ok, true)
    settings()._resetCache()
    process.env.XIANGXIANG_LOCALE = 'zh'
    assert.strictEqual(require('./t').currentLocale(), 'zh')
    delete process.env.XIANGXIANG_LOCALE
  })

  test('⛔ an unreadable settings file falls back to the default and never throws', () => {
    // A blank interface is the one thing this surface may never be — the same rule as
    // missingMark one level down.
    fs.writeFileSync(path.join(dir, 'settings-values.json'), '{ this is not json')
    settings()._resetCache()
    assert.strictEqual(require('./t').currentLocale(), DEFAULT_LOCALE)
  })
})

describe('⛔ the page reads the setting at boot, which is why a RELOAD is enough', () => {
  const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'demo', 'assets', 'app.js'), 'utf8')

  test('the client asks the settings endpoint and re-points its resolver', () => {
    assert.match(APP_JS, /\/api\/v1\/home\/settings/, 'it asks what the setting says now')
    assert.match(APP_JS, /setLocale\(e\.value\)/, 'and re-points the one resolver')
    assert.match(APP_JS, /e\.value !== INITIAL_LOCALE/, 'only when it differs from the baked value')
  })

  test('⛔ setLocale re-points the SAME resolver — it does not write a second one', () => {
    const fn = APP_JS.slice(APP_JS.indexOf('function setLocale'), APP_JS.indexOf('function setLocale') + 160)
    assert.match(fn, /createResolver\(\{ catalogue: CATALOGUE, locale: loc \}\)/,
      'a hand-rolled switch here would be the second implementation browserResolver.js exists to avoid')
  })

  test('the settings endpoint ships oneOf, so the screen can offer the choices', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'home', 'homeRoutes.js'), 'utf8')
    assert.match(routes, /oneOf: e\.oneOf/, 'without it the page would have to hardcode the list')
  })
})
