'use strict'
/**
 * currentNameGuard.test.js — the CURRENT name is what users see, and retired names may not
 * reach the screen.
 *
 * ── WHY THIS EXISTS, AND WHAT IT COVERS THAT THE OTHER GUARD DOES NOT ──────
 * xiangxiang.test.js locks PERSONA_IDENTITY and the retired-name list. It reads that ONE
 * string and nothing else, so a retired name reintroduced anywhere in the UI passes it
 * unnoticed. That gap was recorded when the list stopped being a one-way door; this file
 * closes the user-facing half of it.
 *
 * Scope is deliberately UI CHROME and shipped surfaces — the things a person reads. Code
 * comments stay out, exactly as the 2026-07-30 rename scoped them, and this file must not be
 * quietly widened into the repo-wide scan that is still deferred to its own branch.
 *
 * ── THE CASE THAT PROMPTED IT ──────────────────────────────────────────────
 * MEASURED 2026-07-30: the live window read 「守燈 - 心燈」. Two DIFFERENT sources, and only
 * one of them is in this repository:
 *   心燈  the page <title>, served by us — fixed here, and pinned below.
 *   守燈  the Chrome INSTALLED-APP name, cached in the browser profile at install time.
 *         Nothing in this repo can change it directly; it follows the web app manifest when
 *         Chrome next refreshes it. The manifest is pinned below so that when Chrome does
 *         refresh, it refreshes to the right name.
 * A test that only checked <title> would have reported success while the window still said
 * 守燈, so the manifest is asserted alongside it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const CURRENT = '香香'                             // the current name, written plainly:
                                                   // a rename SHOULD rewrite this one
// The retired names are \u escapes ON PURPOSE, the same discipline xiangxiang.test.js uses and
// for the same measured reason: a blanket search-and-replace over the old name would otherwise
// rewrite the very list that detects it, turning this file into a tautology that passes while
// checking nothing. Do NOT convert them back to literals.
const RETIRED = ['\u5b88\u71c8', '\u5fc3\u71c8']

// Surfaces a person actually looks at. Listed by name rather than globbed: a glob silently
// grows and shrinks, and this list is meant to be argued with when it changes.
const UI_SURFACES = [
  'src/demo/assets/index.html',
  'src/demo/assets/app.js',
  'src/demo/assets/dot.svg',
  'src/demo/appManifest.js',
  'src/demo/demoHtml.js',
  'src/agent/agentResultView.js',
  'src/agent/workOrderView.js',
  'src/agent/ownerDecisionCard.js'
]

const readIf = (rel) => {
  const p = path.join(ROOT, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

// Strip comments so the rule matches the rename's agreed scope. HTML/JS/CSS forms all appear
// across these files.
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l)).join('\n')

test('*** no retired name appears on any user-facing surface ***', () => {
  const hits = []
  for (const rel of UI_SURFACES) {
    const src = readIf(rel)
    if (src === null) continue
    const body = stripComments(src)
    for (const old of RETIRED) {
      if (body.includes(old)) hits.push(`${rel} still shows a retired name`)
    }
  }
  assert.deepEqual(hits, [], hits.join(' | '))
})

test('*** the page title and tab title are the CURRENT name ***', () => {
  const html = readIf('src/demo/assets/index.html')
  assert.ok(html, 'the demo page must exist')
  /**
   * ⛔ CONVERTED — and the guard is UNCHANGED in what it forbids.
   *
   * The tab title is now set from `shell.title` so it follows the interface language, which
   * means the markup no longer spells the name. What this test exists for is that no RETIRED
   * name survives anywhere, and that check is below and untouched. The positive half moves to
   * the catalogue, which is where the name now lives.
   */
  const { CATALOGUE } = require('../i18n/catalogue')
  assert.strictEqual(CATALOGUE['shell.title'].zh, CURRENT, 'the name must be the current one')
  assert.ok(html.includes('apple-mobile-web-app-title'), 'the installed-app title is still declared')
  for (const old of RETIRED) {
    assert.equal(stripComments(html).includes(old), false, 'a retired name is still in the page head')
  }
})

test('*** the web app manifest carries the current name ***', () => {
  // This is the ONLY lever this repo has over the Chrome installed-app caption — the 守燈 half
  // of 「守燈 - 心燈」. Pinning <title> alone would pass while the window still read wrong.
  const src = readIf('src/demo/appManifest.js')
  assert.ok(src, 'the manifest builder must exist')
  const body = stripComments(src)
  assert.match(body, new RegExp(`name:\\s*'${CURRENT}'`), 'manifest name')
  assert.match(body, new RegExp(`short_name:\\s*'${CURRENT}'`), 'manifest short_name')
  for (const old of RETIRED) {
    assert.equal(body.includes(old), false, 'a retired name is still in the manifest')
  }
})

/*
 * ── THE SIGNED RECORDS WERE NOT REWRITTEN BY THE RENAME ────────────────────
 * The AISL documents are signed history. They mention the first name because it WAS the name
 * at the time, and that is what makes them a record rather than a description of today. A
 * rename that edited them would be tampering, and the tempting way to do it is exactly the
 * blanket search-and-replace this project keeps reaching for.
 *
 * Pinned by content hash, not by grep: a hash notices a deletion, a reordering and a silent
 * re-wording, and a grep for a name notices none of those. Only the three that name her are
 * pinned — the rest of docs/governance holds living documents that are appended to.
 */
const SIGNED_RECORDS = {
  'docs/governance/AISL-008-runtime-architecture.md': '1bde98a5c65daf26',
  'docs/governance/AISL-009-roadmap.md': '53d6c19ed0ed19c6',
  'docs/governance/AISL-v1.0.md': '9dda3b70097a5155'
}

test('*** signed governance records were not rewritten by the rename ***', () => {
  const crypto = require('node:crypto')
  for (const [rel, pin] of Object.entries(SIGNED_RECORDS)) {
    const p = path.join(ROOT, rel)
    assert.ok(fs.existsSync(p), `signed record is missing: ${rel}`)
    const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)
    assert.equal(got, pin,
      `${rel} changed. If this was deliberate, the change needs its own Owner sign-off and this ` +
      'pin updated in the same commit — never as a side effect of a rename.')
  }
})
