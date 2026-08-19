'use strict'

/**
 * targetResolution.test.js (UI + wording) — what the screen is allowed to claim.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE SENTENCE IS THE SAFETY FEATURE. When the Owner names a page this build knows and
 * cannot change, the screen has to say BOTH things. Every nearby existing line would have
 * been cheaper and every one of them is false here: `approve.confirmedNotRun` says a work
 * order was CONFIRMED, and at this point there is no Proposal, no Work Order, no approval and
 * no run. A borrowed line would have asserted state that does not exist.
 *
 * ⛔ AND THE SCREEN MUST NOT LOOK DECIDED. This is pre-Proposal: nothing is sealed and nothing
 * is waiting for a signature. The Owner has said plainly that he had been approving from
 * memory rather than from what was in front of him, so a resolution must not borrow the
 * approval card's shape.
 *
 * ── HOW THIS FILE TESTS A BROWSER BUNDLE ────────────────────────────────────
 * This repo has no jsdom and adds no dependency, so the rendering half is STATIC assertion
 * over the served string, exactly as copyMessage.test.js and resultToConversation.test.js say
 * of themselves. The wording half is executed for real against the catalogue.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { CATALOGUE } = require('../i18n/catalogue')
const { t } = require('../i18n/t')
const { buildDemoHtml } = require('./demoHtml')

const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')
const NEW_KEYS = ['resolve.knownButUnavailable', 'resolve.whichOne', 'resolve.cancel', 'resolve.stale', 'resolve.cancelled']

/* ═══ the wording ══════════════════════════════════════════════════════════ */

test('*** every new key carries BOTH languages ***', () => {
  for (const k of NEW_KEYS) {
    const e = CATALOGUE[k]
    assert.ok(e, 'missing key: ' + k)
    assert.ok(typeof e.zh === 'string' && e.zh.trim() !== '', k + ' has no zh')
    assert.ok(typeof e.en === 'string' && e.en.trim() !== '', k + ' has no en')
  }
})

test('*** ⛔ THE UNAVAILABLE LINE CLAIMS NOTHING THAT DOES NOT EXIST ***', () => {
  /**
   * ⛔ At this moment there is no Proposal, no Work Order, no approval and no run. Any wording
   * that implies one would be the screen telling him a decision is due when none is.
   */
  const e = CATALOGUE['resolve.knownButUnavailable']
  for (const claim of ['工作單', '已確認', '已批准', '批准', '待批', '準備執行', '可以執行']) {
    assert.equal(e.zh.includes(claim), false, '⛔ the Chinese line claims: ' + claim)
  }
  for (const claim of ['work order', 'confirmed', 'approved', 'approval', 'ready to execute', 'pending']) {
    assert.equal(e.en.toLowerCase().includes(claim), false, '⛔ the English line claims: ' + claim)
  }
  // and both must still carry the two facts that matter
  assert.ok(/知道|指的是/.test(e.zh) && /還不能|不能/.test(e.zh), 'zh must say both known AND unavailable')
  assert.ok(/know/i.test(e.en) && /cannot/i.test(e.en), 'en must say both known AND unavailable')
})

test('*** ⛔ THE PAGE\'S OWN NAME AND PATH ARE DATA, INSERTED VERBATIM ***', () => {
  const out = t('resolve.knownButUnavailable', {
    label: 'Order Planning',
    file: 'client/src/pages/Replenishment.tsx',
    project: 'aroma-system'
  })
  assert.ok(out.includes('Order Planning'), 'the label survives translation untouched')
  assert.ok(out.includes('client/src/pages/Replenishment.tsx'), 'and so does the path')
  assert.ok(out.includes('aroma-system'))
  assert.equal(/\{label\}|\{file\}|\{project\}/.test(out), false, 'every slot was filled')

  // The English frame carries the same slots; the catalogue entry is asserted directly.
  const en = CATALOGUE['resolve.knownButUnavailable'].en
  assert.ok(en.includes('{label}') && en.includes('{file}') && en.includes('{project}'), 'the English frame has the same slots')
})

test('*** ⛔ NO LIVE TARGET IS HARDCODED AS INTERFACE WORDING ***', () => {
  for (const k of NEW_KEYS) {
    const e = CATALOGUE[k]
    for (const data of ['Order Planning', 'Replenishment', 'aroma-system', '.tsx', 'OrderPlanning']) {
      assert.equal(e.zh.includes(data) || e.en.includes(data), false,
        '⛔ ' + k + ' hardcodes a live target: ' + data)
    }
  }
})

test('*** the addition is minimal and introduces no duplicate key ***', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'i18n', 'catalogue.js'), 'utf8')
  for (const k of NEW_KEYS) {
    const n = (src.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length
    assert.equal(n, 1, '⛔ duplicate catalogue key: ' + k)
  }
  assert.equal(NEW_KEYS.length, 5, 'five keys, no more')
})

/* ═══ the rendering ════════════════════════════════════════════════════════ */

const renderer = () => {
  const i = APP_JS.indexOf('function renderTargetResolution (')
  assert.notEqual(i, -1, 'the resolution renderer is missing')
  return APP_JS.slice(i, APP_JS.indexOf('function renderWorkRequestClarification', i))
}

test('*** ⛔ NO LITERAL INTERFACE CHINESE ENTERED THE BUNDLE ***', () => {
  const code = APP_JS.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  const hits = [...code.matchAll(/(['"`])[^'"`]*[一-鿿][^'"`]*\1/g)].map((m) => m[0])
  assert.deepEqual(hits, [], '⛔ interface text bypassed the catalogue: ' + hits.join(' | '))
})

test('*** ⛔ IT IS PRE-PROPOSAL AND DOES NOT WEAR THE APPROVAL CARD\'S SHAPE ***', () => {
  const r = renderer()
  assert.equal(/proposalId\s*:/.test(r), false, '⛔ it mints a proposalId')
  assert.equal(r.includes("fetch('/api/v1/owner/work-orders'"), false, '⛔ it seals a Work Order')
  assert.equal(r.includes("fetch('/api/v1/owner/approve'"), false, '⛔ it approves something')
  assert.equal(/typedConfirmation|nonce|workOrderHash/.test(r), false, '⛔ it borrows approval machinery')
  assert.equal(/el\('div', 'order'\)/.test(r), false, '⛔ it reuses the approval card container')
})

test('*** ⛔ ONLY THE TICKET TRAVELS BACK ***', () => {
  const r = renderer()
  assert.ok(r.includes("fetch('/api/v1/demo/work-request-resolutions'"), 'it uses the resolution endpoint')
  // The four allowed fields, and nothing shaped like authority.
  assert.ok(/candidateId: c\.candidateId/.test(r), 'the opaque ticket is what is sent')
  for (const banned of ['file:', 'targetId:', 'projectId:', 'allowedFiles', 'repoRoot']) {
    assert.equal(new RegExp('body: JSON\\.stringify\\([^)]*' + banned).test(r), false,
      '⛔ the page sent an authority-shaped field: ' + banned)
  }
})

test('*** all four states are rendered, and completion rejoins the existing chain ***', () => {
  const r = renderer()
  assert.ok(r.includes("t('resolve.knownButUnavailable'"), 'EXACT + UNAVAILABLE')
  assert.ok(r.includes("t('resolve.whichOne')"), 'MULTIPLE')
  assert.ok(r.includes("t('resolve.cancel')") && r.includes("t('resolve.cancelled')"), 'CANCEL + confirmation')
  assert.ok(r.includes("t('resolve.stale')"), 'EXPIRED / REFUSED')
  assert.ok(r.includes('requestWorkOrder(o.body.goal, o.body.file, null, o.body.proposalId, o.body.intent, conv)'),
    'a completed file choice rejoins the unchanged Work Order path')
  assert.ok(/o\.status === 201 && o\.body\.proposalId/.test(r), 'and only on a real 201 + proposalId')
})

test('*** the resolution is offered BEFORE the generic question ***', () => {
  const iRes = APP_JS.indexOf('if (res.workRequestResolution) return renderTargetResolution(')
  const iClar = APP_JS.indexOf('if (res.workRequestClarification) return renderWorkRequestClarification(')
  assert.ok(iRes > -1 && iClar > -1)
  assert.ok(iRes < iClar, '⛔ 「你想改哪個檔？」 would be asked about a page the server already named')
})

test('*** P1-C1a and C1b1 renderers are untouched ***', () => {
  assert.ok(APP_JS.includes('function claimTerminalResult ('), 'C1a result presentation still present')
  assert.ok(APP_JS.includes('var presentedResults = {}'))
  assert.ok(APP_JS.includes('function renderWorkRequestClarification ('), 'C1b1 clarification still present')
  assert.equal([...APP_JS.matchAll(/history\.push\(/g)].length, 4, '⛔ a new model-history entry point appeared')
  assert.equal(/history/.test(renderer()), false, 'the resolution never enters model history')
})

test('*** the served page really carries all of this ***', () => {
  const html = buildDemoHtml()
  assert.ok(html.includes('function renderTargetResolution ('))
  assert.ok(html.includes('if (res.workRequestResolution) return renderTargetResolution('))
})
