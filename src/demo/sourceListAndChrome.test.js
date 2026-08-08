'use strict'

/**
 * sourceListAndChrome.test.js — the source list is GENERATED, and the chrome names her
 * correctly.
 *
 * ── THE DEFECT CLASS, FOR THE THIRD TIME ─────────────────────────────────────
 * A hardcoded list of four sources has now been wrong twice in the read layer, both times
 * the same way: a fifth source was connected and read live, and the hardcoded four kept
 * telling the Owner it did not exist. readContext's safety header used to freeze the list
 * into prose; readStateGuard's LABELS used to be a hand-written table. Both are now derived
 * from ALL_SOURCES.
 *
 * The settings page and the model picker were the two places still holding the same four by
 * hand — so aroma_system, the restaurant's OWN system, had no switch and was missing from
 * the sentence describing what each provider can see. These tests derive their expectations
 * from ALL_SOURCES too, so a sixth source fails them until it is given a name.
 */

const test = require('node:test')
const { CATALOGUE } = require('../i18n/catalogue')
const assert = require('node:assert/strict')

const { ALL_SOURCES } = require('../context/liveClients')
const { LABELS } = require('../intake/readStateGuard')
const { FLAGS, effectiveFlags } = require('../persona/ownerSettings')
const { SOURCE_FLAGS, sourceFlagLabels } = require('../persona/ownerSettings')
const { DEMO_HTML } = require('./demoHtml')

/* ── the switches ────────────────────────────────────────────────────────── */

test('*** every registered source has a settings switch — including aroma_system ***', () => {
  for (const s of ALL_SOURCES) {
    const flag = 'CONTEXT_' + s.toUpperCase()
    assert.ok(FLAGS.includes(flag), `${s} has no switch (${flag})`)
  }
  assert.ok(FLAGS.includes('CONTEXT_AROMA_SYSTEM'), 'the restaurant\'s own system is a source like any other')
})

test('*** and no switch exists for a source that is not registered ***', () => {
  const registered = new Set(ALL_SOURCES.map((s) => 'CONTEXT_' + s.toUpperCase()))
  for (const f of FLAGS) {
    if (!f.startsWith('CONTEXT_')) continue
    assert.ok(registered.has(f), `${f} is a switch for a source that does not exist`)
  }
})

test('the switch list is DERIVED, so a new source cannot be forgotten', () => {
  assert.deepEqual(SOURCE_FLAGS, ALL_SOURCES.map((s) => 'CONTEXT_' + s.toUpperCase()))
})

test('*** each switch carries the Owner-facing name from the one label table ***', () => {
  const labels = sourceFlagLabels()
  for (const s of ALL_SOURCES) {
    const flag = 'CONTEXT_' + s.toUpperCase()
    assert.ok(labels[flag], `${flag} has no label`)
    assert.ok(labels[flag].includes(LABELS[s]), `${flag} must read as ${LABELS[s]}`)
  }
  assert.ok(labels.CONTEXT_AROMA_SYSTEM.includes('餐廳系統'), 'not "Aroma System" on the Owner\'s screen')
})

test('effectiveFlags reports a state for every switch the page can show', () => {
  const f = effectiveFlags({})
  for (const flag of FLAGS) assert.ok(f[flag], `${flag} has no effective state`)
})

/* ── the provider description ────────────────────────────────────────────── */

test('*** the picker note names every source, generated — not a stale four ***', () => {
  // The claim on the picker is a statement about where the Owner's data goes. A stale one
  // is worse than none, and this one had gone stale in the direction that understates it.
  // CONVERTED (HR-51): the catalogue is inlined into the page, so this found the words either
  // way. The page must RENDER the source list; the label itself is checked on its entry.
  assert.ok(DEMO_HTML.includes('READ_SOURCES'), 'the page renders the generated source list')
  assert.strictEqual(CATALOGUE['source.aromaSystem'].zh, '餐廳系統', 'aroma_system is named in the interface text')
  assert.ok(CATALOGUE['source.aromaSystem'].en.length > 0, 'and in English')
  for (const s of ALL_SOURCES) {
    assert.ok(DEMO_HTML.includes(LABELS[s]), `${s} (${LABELS[s]}) is missing from the page`)
  }
  // GENERATED, NOT TYPED. The page must carry the exact array the registry produces, so a
  // source added to ALL_SOURCES appears here with no edit to the page — and this assertion
  // is itself built from ALL_SOURCES, so it cannot go stale in the way the old list did.
  const expected = JSON.stringify(ALL_SOURCES.map((s) => LABELS[s] || s))
  assert.ok(DEMO_HTML.includes(expected), 'the injected list must be the registry\'s own: ' + expected)
  assert.equal(DEMO_HTML.includes('/*READ_SOURCE_LABELS*/'), false, 'and the placeholder was replaced')
})

test('the second-vendor disclosure survives the rewrite', () => {
  // contextAsymmetry.test.js pins the behaviour; this pins that the interface still says it.
  // CONVERTED: inlining the catalogue made this pass regardless of what the page renders.
  assert.ok(DEMO_HTML.includes("t('provider.canSeeButSends'"), 'the disclosure is rendered')
  for (const loc of ['zh', 'en']) {
    assert.match(CATALOGUE['provider.canSeeButSends'][loc], /OpenAI/,
      loc + ': GPT sending the same context to a second vendor is still disclosed')
  }
})

/* ── the chrome ──────────────────────────────────────────────────────────── */

test('*** no retired name is left in anything the Owner READS ***', () => {
  // SCOPE, STATED RATHER THAN ASSUMED. Comments are stripped, exactly as
  // currentNameGuard.test.js scoped the 2026-07-30 rename — the repo-wide sweep is still
  // its own deferred branch. Measured today: three CSS comments and two JS comments in the
  // served page still carry the first name. The JS ones are fixed in this change; the CSS
  // ones are inside app.css, which this task was told not to touch, so they are LEFT and
  // reported rather than quietly rewritten.
  const visible = DEMO_HTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l)).join('\n')
  for (const retired of ['守燈', '心燈']) {
    assert.equal(visible.includes(retired), false, 'a retired name is on screen')
  }
})

test('the retired names that remain are comments only, and are counted', () => {
  // A number the Owner can challenge beats an absence nobody can see. If this count moves,
  // someone either fixed them or added one, and either way it should be deliberate.
  const hits = ['守燈', '心燈']
    .map((w) => DEMO_HTML.split(w).length - 1)
    .reduce((a, b) => a + b, 0)
  assert.equal(hits, 3, 'three CSS comments in app.css, which this change was told not to modify')
})

test('the tab and installed-app titles are the current name', () => {
  // CONVERTED: the tab title is set by applyShellText so it follows the language; the markup
  // carries only a neutral fallback for the moment before the script runs.
  const { CATALOGUE } = require('../i18n/catalogue')
  assert.ok(DEMO_HTML.includes("document.title = t('shell.title')"), 'the tab title follows the language')
  assert.strictEqual(CATALOGUE['shell.title'].zh, '香香', 'and the Chinese name is unchanged')
  assert.ok(DEMO_HTML.includes('apple-mobile-web-app-title'), 'the installed-app title is still declared')
})

/* ── the sidebar ─────────────────────────────────────────────────────────── */

test('*** the sidebar loads history from the server, not just from the page ***', () => {
  assert.ok(DEMO_HTML.includes("'/api/v1/conversations'"), 'it lists')
  assert.ok(DEMO_HTML.includes('loadConversation'), 'it loads a full transcript on click')
  assert.ok(DEMO_HTML.includes('deleteConversation'), 'it deletes')
})

test('*** delete asks first ***', () => {
  assert.ok(/confirm\(/.test(DEMO_HTML), 'a conversation is not deleted on a stray click')
})

test('the page still builds no markup from strings', () => {
  // The standing rule for this page: real DOM only. A history feature is not a reason to
  // start assembling HTML out of conversation text.
  assert.equal(/innerHTML\s*=/.test(DEMO_HTML), false, 'no innerHTML assignment')
  assert.equal(/insertAdjacentHTML/.test(DEMO_HTML), false)
})
