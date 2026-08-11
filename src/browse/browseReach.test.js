'use strict'
/**
 * browseReach.test.js — the REACH layer: detection, the sealed order, and isolation.
 *
 * ⛔ NO NETWORK, NO MODEL, NO BROWSER.
 * ⛔ HR-57 is the reason this file is named for its layer. Its ancestor asserted 「the model or
 *    client cannot supply or widen a target origin」 against browseOrder, passed, and was
 *    believed about the whole system — while the result layer accepted a caller-supplied
 *    origin one module away. That property is now asserted at BOTH doors: here, and in
 *    browseEvidence.test.js against the sealed order.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { detectBrowseRequest, OUTCOME } = require('./browseIntent')
const { buildBrowseOrder } = require('./browseOrder')
const { browseOfferFor } = require('./browseOffer')

const OWNER_UTTERANCE = '香香，幫我去superstore網站查下peanut butter多少錢？'

test('*** REACH — the acceptance utterance is detected deterministically, with no model ***', () => {
  const d = detectBrowseRequest(OWNER_UTTERANCE)
  assert.equal(d.isBrowse, true)
  assert.equal(d.siteKey, 'superstore')
  assert.equal(d.field, 'price')
  assert.match(d.query, /peanut butter/i)
})

test('*** REACH — ⛔ a GENERIC shop word resolves to no site, and never picks one ***', () => {
  // 超市 means any supermarket. Binding it to one vendor made 「幫我去超市查下花生醬幾錢」 silently
  // choose Real Canadian Superstore and report its prices as though the Owner had named it —
  // while this module's own header claimed it refuses to invent destinations.
  const generic = detectBrowseRequest('幫我去超市查下花生醬幾錢')
  assert.equal(generic.isBrowse, false)
  assert.equal(generic.outcome, OUTCOME.NO_SITE, 'ask which shop; do not guess one')
  // A named site is unaffected.
  assert.equal(detectBrowseRequest('幫我去superstore查下花生醬幾錢').siteKey, 'superstore')
})

test('*** REACH — near-misses do not trigger, and a purchase is REFUSED not downgraded ***', () => {
  assert.equal(detectBrowseRequest('superstore 嘅嘢好貴').isBrowse, false)
  assert.equal(detectBrowseRequest('幫我查下我哋牛肉價').outcome, OUTCOME.NO_SITE)
  const buy = detectBrowseRequest('幫我去superstore買peanut butter')
  assert.equal(buy.isBrowse, false)
  assert.equal(buy.outcome, OUTCOME.PURCHASE_REFUSED, 'buying is not looking, and is not reinterpreted as looking')
})

test('*** REACH (browseOrder) — the ORDER cannot be supplied or widened by a caller ***', () => {
  // ⛔ THE LAYER IS IN THE NAME. This asserts browseOrder and nothing else; the same property
  // at the evidence layer is asserted separately, because that is where it was violated.
  for (const key of ['origin', 'origins', 'allowedOrigins', 'url', 'allowedWrites', 'permissions', 'maxActions']) {
    const r = buildBrowseOrder({ siteKey: 'superstore', query: 'peanut butter', [key]: 'https://evil.example' })
    assert.equal(r.ok, false, '⛔ ' + key + ' must be refused, not merged')
  }
  const ok = buildBrowseOrder({ siteKey: 'superstore', query: 'peanut butter' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.order.allowedWrites, [], 'a public read carries no write permits')
  assert.equal(ok.order.allowedOrigins.length, 1)
})

test('*** REACH — free text yields an OFFER, never an action ***', () => {
  const o = browseOfferFor({ message: OWNER_UTTERANCE })
  assert.equal(o.offered, true)
  assert.equal(o.offer.kind, 'public_read_offer')
  assert.ok(o.offer.refuses.some((r) => /cart|checkout|pay/i.test(r)))
  assert.ok(o.offer.order, 'the reach he is approving travels with the offer')
})

test('*** ⛔ E0-B1 is not wired into the runtime, and browseResult.js is GONE ***', () => {
  const SRC = path.resolve(__dirname, '..')
  const offenders = []
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      if (fs.statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'browse') walk(p); continue }
      if (!/\.js$/.test(n) || /\.test\.js$/.test(n)) continue
      if (/require\([^)]*browse\/(browseOffer|browseIntent|browseEvidence|browseAnswer|ephemeralBrowseSession)/.test(fs.readFileSync(p, 'utf8'))) {
        offenders.push(path.relative(SRC, p))
      }
    }
  }
  walk(SRC)
  assert.deepEqual(offenders, [], '⛔ E0-B1 reached production before it was proven')

  // ⛔ DELETED, NOT REFACTORED. Its STATUS/SOURCE/REASON enums said in a second vocabulary what
  // A1 already says, and its four statuses were two different A1 concepts wearing one enum.
  assert.equal(fs.existsSync(path.join(__dirname, 'browseResult.js')), false)
})
