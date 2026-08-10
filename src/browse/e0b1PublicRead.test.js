'use strict'

/**
 * e0b1PublicRead.test.js — the conversational public read, and what counts as finishing it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ NOT ONE TEST HERE OPENS A BROWSER, TOUCHES A NETWORK OR CALLS A MODEL.
 *
 * The entrance, the registry, the order and the result contract are all pure. The session is
 * exercised with an injected fake chromium, so 「profile-less」 and 「GET-only」 are proven by
 * what the code DOES rather than by reading it.
 *
 * The Owner's own sentence is the acceptance case and is written out verbatim, once, so a
 * future edit to the entrance has to face it.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { detectBrowseRequest, OUTCOME } = require('./browseIntent')
const { resolveSite, isRegisteredOrigin, SITES, searchUrlFor } = require('./siteRegistry')
const { buildBrowseOrder, REFUSED, FORBIDDEN_INPUT_KEYS, BROWSE_BUDGET } = require('./browseOrder')
const { openEphemeralBrowseSession, OPEN_REFUSED } = require('./ephemeralBrowseSession')
const R = require('./browseResult')
const { browseOfferFor } = require('./browseOffer')

/** ⛔ THE ACCEPTANCE UTTERANCE. Verbatim, and it must keep working. */
const OWNER_UTTERANCE = '香香，幫我去superstore網站查下peanut butter多少錢？'

const SUPERSTORE = SITES.superstore.origin
const NOW = '2026-08-10T20:00:00.000Z'
const browserPrice = (over = {}) => Object.assign({
  source: R.SOURCE.BROWSER,
  product: 'Kraft Peanut Butter Smooth',
  packageSize: '1kg',
  price: '$6.99',
  sourceOrigin: SUPERSTORE,
  pageUrl: SUPERSTORE + '/p/kraft-peanut-butter',
  observedAt: NOW
}, over)

/* ═══ 1 — THE OWNER'S SENTENCE ═════════════════════════════════════════ */

test('*** 1 — ACCEPTANCE: the exact Owner utterance is detected deterministically ***', () => {
  const d = detectBrowseRequest(OWNER_UTTERANCE)
  assert.equal(d.isBrowse, true, '⛔ the acceptance sentence stopped being recognised')
  assert.equal(d.siteKey, 'superstore')
  assert.equal(d.field, 'price', 'the Owner asked what it COSTS')
  assert.match(d.query, /peanut butter/i, 'the subject survives the framing')
  // ⛔ DETERMINISTIC: same words in, same answer out, ten times, with no provider anywhere.
  for (let i = 0; i < 10; i++) assert.deepEqual(detectBrowseRequest(OWNER_UTTERANCE), d)

  // And it becomes an OFFER, not an action.
  const o = browseOfferFor({ message: OWNER_UTTERANCE })
  assert.equal(o.offered, true)
  assert.equal(o.offer.order.allowedOrigins.length, 1)
  assert.equal(o.offer.order.allowedOrigins[0], SUPERSTORE)
  assert.deepEqual(o.offer.order.allowedWrites, [])
})

/* ═══ 11 — REACH IS THE REGISTRY'S, NEVER THE CALLER'S ═════════════════ */

test('*** 11 — the model/client cannot supply or widen a target origin ***', () => {
  // ⛔ A TOKEN, NOT AN ADDRESS. Anything address-shaped is refused before interpretation.
  for (const attempt of ['https://evil.example', 'evil.example', '//evil.example',
    'http://www.realcanadiansuperstore.ca', 'javascript:alert(1)', 'superstore.com']) {
    const r = resolveSite(attempt)
    assert.equal(r.ok, false, '⛔ resolveSite accepted an address: ' + attempt)
  }
  assert.equal(resolveSite('superstore').ok, true)
  assert.equal(resolveSite('unknownshop').ok, false)

  // ⛔ AND THE ORDER BUILDER REFUSES A CALLER THAT EVEN TRIES.
  for (const key of FORBIDDEN_INPUT_KEYS) {
    const r = buildBrowseOrder({ siteKey: 'superstore', query: 'peanut butter', [key]: 'https://evil.example' })
    assert.equal(r.ok, false, '⛔ order builder accepted caller-supplied «' + key + '»')
    assert.equal(r.reason, REFUSED.CALLER_SUPPLIED_REACH)
  }
  assert.equal(buildBrowseOrder({ siteKey: 'nope', query: 'x' }).reason, REFUSED.UNKNOWN_SITE)

  // The entry URL keeps the Owner's words in an encoded query param — never in the path or host.
  const built = buildBrowseOrder({ siteKey: 'superstore', query: 'peanut butter' })
  const u = new URL(built.order.entryUrl)
  assert.equal(u.origin, SUPERSTORE, '⛔ the query escaped into the host')
  assert.equal(u.pathname, '/search')
  assert.equal(u.searchParams.get('search-bar'), 'peanut butter')
  assert.equal(isRegisteredOrigin('https://evil.example'), false)
})

test('*** the order is SERVER-BUILT: one origin, no writes, a small budget ***', () => {
  const { order } = buildBrowseOrder({ siteKey: 'superstore', query: 'peanut butter' })
  assert.equal(order.kind, 'public_read')
  assert.deepEqual(order.allowedOrigins, [SUPERSTORE])
  assert.deepEqual(order.allowedWrites, [], '⛔ a public read may never carry a write permit')
  assert.equal(order.maxActions, BROWSE_BUDGET.maxActions)
  assert.equal(order.maxSeconds, BROWSE_BUDGET.maxSeconds)
  assert.equal(order.locationDependent, true, 'this retailer prices per store')
  assert.equal(Object.isFrozen(order), true, 'the order cannot be widened after it is sealed')
})

/* ═══ 9 / 10 — WHAT MUST *NOT* TRIGGER ═════════════════════════════════ */

test('*** 9 — near-miss sentences do NOT trigger a browse ***', () => {
  const nearMisses = [
    ['superstore 嘅嘢好貴', 'an opinion about a registered site'],
    ['superstore 個網站好慢', 'names the site and the web, asks for nothing'],
    ['幫我查下我哋牛肉入貨價', 'a lookup with NO registered site — this is internal, A4 owns it'],
    ['幫我去買樽花生醬', 'no site, and it is buying'],
    ['查下今日天氣', 'a lookup with no site at all'],
    ['我噚日去咗superstore', 'a place he went, not an errand'],
    ['', 'nothing at all']
  ]
  for (const [msg, why] of nearMisses) {
    const d = detectBrowseRequest(msg)
    assert.equal(d.isBrowse, false, '⛔ FALSE TRIGGER on «' + msg + '» — ' + why)
    assert.equal(browseOfferFor({ message: msg }).offered, false)
  }
})

test('*** 10 — a purchase request is REFUSED, never downgraded into a read ***', () => {
  // ⛔ Quietly turning 「買」 into 「睇下幾錢」 answers a question he did not ask, and teaches him
  // that buying words are safe here.
  for (const msg of ['幫我去superstore買樽peanut butter', '去superstore網站幫我落單買花生醬',
    'add peanut butter to my superstore cart']) {
    const d = detectBrowseRequest(msg)
    assert.equal(d.isBrowse, false, '⛔ a purchase became a browse: ' + msg)
    assert.equal(d.outcome, OUTCOME.PURCHASE_REFUSED)
  }
})

test('*** 10b — generic chat is untouched: the entrance is pure and imports no provider ***', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'browseIntent.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const forbidden of ['adapter', 'complete(', 'fetch(', 'openai', 'anthropic', 'claude', 'llm', 'prompt']) {
    assert.equal(src.toLowerCase().includes(forbidden), false, '⛔ the entrance consults «' + forbidden + '»')
  }
})

/* ═══ 12 / 13 — PROFILE AND WRITES ═════════════════════════════════════ */

/** A fake chromium that records exactly how the browser was started. */
function fakeChromium () {
  const calls = { launch: 0, launchPersistentContext: 0, newContext: 0, routes: [], goto: [] }
  const page = {
    route: async (glob, handler) => { calls.routes.push({ glob, handler }) },
    goto: async (url) => { calls.goto.push(url) },
    on: () => {}, evaluate: async () => ({}), screenshot: async () => Buffer.from('')
  }
  const ctx = {
    pages: () => [page],
    newPage: async () => page,
    newCDPSession: async () => ({ send: async () => ({ nodes: [] }) }),
    close: async () => {}
  }
  return {
    calls,
    launch: async () => { calls.launch++; return { newContext: async () => { calls.newContext++; return ctx }, close: async () => {} } },
    launchPersistentContext: async () => { calls.launchPersistentContext++; return ctx }
  }
}

test('*** 12 — the session is PROFILE-LESS, and the credential path is unreachable ***', async () => {
  const { order } = buildBrowseOrder({ siteKey: 'superstore', query: 'peanut butter' })
  const cr = fakeChromium()
  const s = await openEphemeralBrowseSession({ order, chromium: cr })

  assert.equal(s.opened, true)
  assert.equal(s.profileless, true)
  // ⛔ MEASURED, NOT READ: a persistent profile was never opened.
  assert.equal(cr.calls.launchPersistentContext, 0, '⛔ the Owner\'s Chrome profile was opened')
  assert.equal(cr.calls.launch, 1)
  assert.equal(cr.calls.newContext, 1, 'a fresh, non-persistent context')
  assert.equal(s.liveLayers().profile, 'NONE — non-persistent context, no credentials reachable')
  await s.close()

  // ⛔ AND THERE IS NO PARAMETER TO PASS ONE THROUGH. Handing it a profileDir changes nothing.
  const cr2 = fakeChromium()
  const s2 = await openEphemeralBrowseSession({ order, chromium: cr2, profileDir: 'C:/Users/louis/AppData/Local/Google/Chrome/User Data' })
  assert.equal(cr2.calls.launchPersistentContext, 0, '⛔ a caller-supplied profile was honoured')
  await s2.close()

  // Statically: this module never names the persistent path or the profile probes.
  const src = fs.readFileSync(path.resolve(__dirname, 'ephemeralBrowseSession.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const forbidden of ['launchPersistentContext', 'profileDir', 'profileProbe', 'writeProfileDefaults', 'browserSession']) {
    assert.equal(src.includes(forbidden), false, '⛔ «' + forbidden + '» is reachable from the public-read session')
  }
})

test('*** 13 — writes stay blocked by the EXISTING fence, and a write-bearing order is refused ***', async () => {
  const { buildRequestFence, FENCE } = require('../governance/requestFence')
  const { order } = buildBrowseOrder({ siteKey: 'superstore', query: 'peanut butter' })

  // The real fence, with this real order: GET/HEAD/OPTIONS continue; everything else aborts.
  const fence = buildRequestFence({ order })
  const seen = []
  const route = (method) => ({
    request: () => ({ method: () => method, url: () => SUPERSTORE + '/x', resourceType: () => 'fetch' }),
    continue: async () => seen.push({ method, action: 'continue' }),
    abort: async () => seen.push({ method, action: 'abort' })
  })
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE', 'TRACE']) {
    await fence.handle(route(method))
  }
  for (const m of FENCE.ALLOWED_METHODS) {
    assert.equal(seen.find((s) => s.method === m).action, 'continue', m + ' is a read')
  }
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE']) {
    assert.equal(seen.find((s) => s.method === m).action, 'abort', '⛔ ' + m + ' was allowed through')
  }
  assert.equal(fence.report().allowedWrites, 0)

  // ⛔ AND AN ORDER THAT CARRIES A WRITE PERMIT NEVER OPENS A BROWSER AT ALL.
  const writeOrder = Object.assign({}, order, { allowedWrites: [{ origin: SUPERSTORE, pathPrefix: '/cart', method: 'POST' }] })
  const refused = await openEphemeralBrowseSession({ order: writeOrder, chromium: fakeChromium() })
  assert.equal(refused.opened, false)
  assert.equal(refused.reason, OPEN_REFUSED.ORDER_ALLOWS_WRITES)
})

test('*** an order naming an unregistered or blocked origin never opens ***', async () => {
  const { order } = buildBrowseOrder({ siteKey: 'superstore', query: 'x' })
  const off = await openEphemeralBrowseSession({ order: Object.assign({}, order, { allowedOrigins: ['https://evil.example'] }), chromium: fakeChromium() })
  assert.equal(off.opened, false)
  assert.equal(off.reason, OPEN_REFUSED.ORIGIN_NOT_IN_REGISTRY)

  assert.equal((await openEphemeralBrowseSession({ order: null, chromium: fakeChromium() })).reason, OPEN_REFUSED.NO_ORDER)
  assert.equal((await openEphemeralBrowseSession({ order: Object.assign({}, order, { kind: 'errand' }), chromium: fakeChromium() })).reason, OPEN_REFUSED.NOT_A_PUBLIC_READ)
})

/* ═══ 2–6 — THE TASK COMPLETION CONTRACT ═══════════════════════════════ */

test('*** 3 — COMPLETED requires a browser-observed product AND price ***', () => {
  const r = R.classifyBrowseResult({
    observations: [browserPrice()], searchPerformed: true, locationDependent: true, field: 'price'
  })
  assert.equal(r.status, R.STATUS.COMPLETED)
  assert.equal(R.isSuccess(r), true)
  const e = r.evidence[0]
  // ⛔ EVERY REQUIRED FIELD, PRESENT AND FROM THE PAGE.
  assert.equal(e.product, 'Kraft Peanut Butter Smooth')
  assert.equal(e.packageSize, '1kg')
  assert.equal(e.price, '$6.99')
  assert.equal(e.sourceOrigin, SUPERSTORE)
  assert.equal(e.observedAt, NOW)
})

test('*** 2 — related product text but NO price is INCOMPLETE, never success ***', () => {
  const r = R.classifyBrowseResult({
    observations: [{ source: R.SOURCE.BROWSER, product: 'Kraft Peanut Butter', sourceOrigin: SUPERSTORE, observedAt: NOW }],
    searchPerformed: true, field: 'price'
  })
  assert.equal(r.status, R.STATUS.INCOMPLETE)
  assert.equal(R.isSuccess(r), false, '⛔ finding related text was treated as finishing the task')
  assert.equal(r.reason, R.REASON.NO_PRICE)
  assert.deepEqual(r.evidence, [])
})

test('*** 4 — a blocked navigation or fence is BLOCKED, and outranks everything else ***', () => {
  const r = R.classifyBrowseResult({
    navigation: { blocked: true, reason: 'origin not in the order' },
    // Even with a perfect-looking observation in hand: we never reached the page.
    observations: [browserPrice()], searchPerformed: true, field: 'price'
  })
  assert.equal(r.status, R.STATUS.BLOCKED)
  assert.equal(R.isSuccess(r), false)
  assert.deepEqual(r.evidence, [])
})

test('*** 5 — a bounded search with no matching product is NOT_FOUND ***', () => {
  const r = R.classifyBrowseResult({ observations: [], searchPerformed: true, field: 'price' })
  assert.equal(r.status, R.STATUS.NOT_FOUND)
  assert.equal(R.isSuccess(r), false)
  assert.equal(r.reason, R.REASON.NO_PRODUCT)
})

test('*** 6 — a PLAUSIBLE price from model text can never reach COMPLETED ***', () => {
  /**
   * ⛔ THE MOST IMPORTANT TEST IN THE FILE. A hallucinated $4.99 is indistinguishable from a
   * real one at the exact moment you most want it to be true, so the source is decided
   * structurally and no amount of well-formedness can substitute for it.
   */
  for (const source of [R.SOURCE.MODEL_TEXT, R.SOURCE.FALLBACK, R.SOURCE.SEARCH_SUMMARY, undefined, 'browser_ish']) {
    const r = R.classifyBrowseResult({
      observations: [
        { source: R.SOURCE.BROWSER, product: 'Peanut Butter Smooth', sourceOrigin: SUPERSTORE, observedAt: NOW },
        Object.assign(browserPrice({ price: '$4.99' }), { source })
      ],
      searchPerformed: true, field: 'price'
    })
    assert.notEqual(r.status, R.STATUS.COMPLETED, '⛔ «' + String(source) + '» text was accepted as browser evidence')
    assert.equal(r.status, R.STATUS.INCOMPLETE)
    assert.equal(r.reason, R.REASON.ONLY_UNVERIFIED_TEXT)
    assert.equal(JSON.stringify(r.evidence).includes('4.99'), false, '⛔ the unverified number reached the evidence')
  }
  // Malformed browser prices are refused too — the shape is checked, not just the source.
  for (const price of ['about $5', 'from $4.99', '', '   ', '$', 'free']) {
    assert.equal(R.isBrowserPrice(browserPrice({ price })), false, 'accepted a non-price: ' + JSON.stringify(price))
  }
  // And a browser observation missing its provenance is not evidence either.
  assert.equal(R.isBrowserPrice(browserPrice({ sourceOrigin: undefined })), false)
  assert.equal(R.isBrowserPrice(browserPrice({ observedAt: undefined })), false)
})

/* ═══ 7 / 8 — THE ANSWER THE OWNER READS ═══════════════════════════════ */

test('*** 7 — a successful answer LEADS with the price he asked for ***', () => {
  const r = R.classifyBrowseResult({
    observations: [browserPrice(), browserPrice({ product: 'Skippy Creamy', packageSize: '750g', price: '$5.49' })],
    searchPerformed: true, locationDependent: true, storeContext: 'Winnipeg — Grant Park', field: 'price'
  })
  const answer = R.renderOwnerAnswer(r, 'Superstore')
  assert.match(answer.split('\n')[0], /^Superstore 查到：Kraft Peanut Butter Smooth 1kg — \$6\.99/,
    '⛔ the first line must answer the question that was asked')
  assert.ok(answer.includes('Winnipeg — Grant Park'), 'a per-store price says which store')
  assert.ok(answer.includes('Skippy Creamy 750g — $5.49'), 'comparison comes AFTER the answer')
})

test('*** 7b — a per-store price with no store chosen says so, rather than implying universal ***', () => {
  const r = R.classifyBrowseResult({ observations: [browserPrice()], searchPerformed: true, locationDependent: true, field: 'price' })
  const answer = R.renderOwnerAnswer(r, 'Superstore')
  assert.ok(answer.includes('未揀分店'), '⛔ a store-dependent price was presented as universal')
})

test('*** 8 — an incomplete or blocked answer says the price was NOT verified ***', () => {
  for (const [input, mustMention] of [
    [{ observations: [{ source: R.SOURCE.BROWSER, product: 'Peanut Butter', sourceOrigin: SUPERSTORE, observedAt: NOW }], searchPerformed: true }, '冇顯示可信價格'],
    [{ navigation: { blocked: true, reason: 'blocked' } }, '去唔到'],
    [{ observations: [], searchPerformed: true }, '搵唔到相關商品'],
    [{ observations: [{ source: R.SOURCE.MODEL_TEXT, product: 'PB', price: '$4.99' },
      { source: R.SOURCE.BROWSER, product: 'PB', sourceOrigin: SUPERSTORE, observedAt: NOW }], searchPerformed: true }, '唔可以當數']
  ]) {
    const answer = R.renderOwnerAnswer(R.classifyBrowseResult(input), 'Superstore')
    // ⛔ THE EXACT PHRASE. Not a hedge, not a paraphrase.
    assert.ok(answer.startsWith('未能核實價格。'), '⛔ a failed run did not say the price was unverified: ' + answer)
    assert.ok(answer.includes(mustMention), 'and it states the real reason: ' + answer)
    assert.equal(/\$\d/.test(answer), false, '⛔ a price appeared in an answer that verified none')
  }
})

test('*** ⛔ the forbidden non-answers cannot be produced by the renderer ***', () => {
  // The shapes that read like completion and contain no price.
  const bad = ['價格因品牌和容量不同', '有幾個數值無法核對', '有相關產品']
  const results = [
    R.classifyBrowseResult({ observations: [{ source: R.SOURCE.BROWSER, product: 'PB', sourceOrigin: SUPERSTORE, observedAt: NOW }], searchPerformed: true }),
    R.classifyBrowseResult({ observations: [], searchPerformed: true }),
    R.classifyBrowseResult({ navigation: { blocked: true } })
  ]
  for (const r of results) {
    const answer = R.renderOwnerAnswer(r, 'Superstore')
    for (const phrase of bad) assert.equal(answer.includes(phrase), false, '⛔ produced a non-answer: ' + phrase)
    assert.equal(R.isSuccess(r), false)
  }
})

/* ═══ ISOLATION — BUILT, NOT WIRED ═════════════════════════════════════ */

test('*** ⛔ E0-B1 is not wired into the runtime, and builds no second browser engine ***', () => {
  const repo = path.resolve(__dirname, '..', '..')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const p of ['src/intake/intakeService.js', 'src/routes/demoRouter.js', 'src/routes/intakeRouter.js', 'src/app.js', 'src/index.js']) {
    const code = strip(fs.readFileSync(path.join(repo, p), 'utf8'))
    assert.equal(/browse\//.test(code) || /browseIntent|browseOffer|browseOrder|ephemeralBrowseSession|browseResult/.test(code),
      false, '⛔ ' + p + ' wires E0-B1 into the runtime')
  }
  // ⛔ A FLAG NAME, NOT THE WORD 「browser」 — the launcher legitimately mentions opening one.
  const launcher = fs.readFileSync(path.join(repo, 'scripts/launcher/xiangxiang-body.ps1'), 'utf8')
  assert.equal(/$env:[A-Z_]*(BROWSE|PUBLIC_READ|E0_B1)[A-Z_]*/i.test(launcher), false, '⛔ a launcher flag appeared')

  /**
   * ⛔ AND NO SECOND ENGINE: the session composes the existing layers and implements none.
   *
   * The comment filter here is LINE-BASED on purpose. The regex stripper used elsewhere in
   * this repo mangles this particular file twice over: the page-route glob `'**' + '/*'`
   * contains a comment terminator inside a string, and an apostrophe in ordinary prose
   * ("the Owner's profile") opens a string literal that never closes. Either way half the file
   * disappears and the assertions then cheerfully report that everything is absent — a
   * stripper that damages its input can only produce confident nonsense.
   */
  const rawSess = fs.readFileSync(path.resolve(__dirname, 'ephemeralBrowseSession.js'), 'utf8')
  const sess = rawSess.split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t === '')
    })
    .join('\n')
  // The import paths live inside string literals, so they are checked on the RAW source.
  for (const reused of ['requestFence', 'originPolicy', 'browser/navigate', 'browser/click', 'browser/session', 'browser/launch']) {
    assert.ok(rawSess.includes(reused), 'must REUSE ' + reused)
  }
  // ⛔ IT DELEGATES RATHER THAN DECIDES. Naming a layer in `liveLayers()` is reporting; what
  // would be re-implementation is a method allowlist, payment keywords, or URL parsing of its
  // own. The assertion targets the LOGIC, not the vocabulary — an over-broad substring check
  // fails on the honest label 「L1_paymentStop: inside click()」 and teaches nothing.
  assert.equal(/ALLOWED_METHODS|\[\s*'GET'|methods?\s*=\s*\[/.test(sess), false,
    '⛔ the session defines its own method policy instead of using the fence')
  assert.equal(/\bnew URL\(|\.hostname|\.protocol/.test(sess), false,
    '⛔ the session parses origins itself instead of using navigate/originPolicy')
  assert.equal(/card|cvv|checkout|\bpay\b/i.test(sess.replace(/L1_paymentStop[^\n]*/g, '')), false,
    '⛔ the session implements payment logic instead of relying on click()\'s L1')
  // And every verb it exposes comes from a builder it imported.
  for (const verb of ['buildClick({', 'buildType({', 'buildSession({', 'buildRequestFence({']) {
    assert.ok(sess.includes(verb), 'must delegate to ' + verb)
  }
})
