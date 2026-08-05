'use strict'

/**
 * negationDoubleCheck.test.js — the deliberate exception to "one concept, one implementation".
 *
 * Owner ruling 2026-08-05, approved with his reasoning recorded: 「every other misread costs
 * me an unwanted offer, but asking 「要唔要」 after I said 「唔好」 is offensive regardless of
 * how inert the button is.」
 *
 * So negation is checked TWICE, by two implementations that do not share code, and EITHER
 * refusing stops the offer:
 *
 *   requestShape.NEGATED   a flat alternation over the whole sentence
 *   offerFor's own check   proximity-based — a refusal marker BEFORE the verb it governs
 *
 * They are built differently on purpose. Two copies of the same regex would be one
 * implementation typed twice and would fail together.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { offerFor, refusesChange } = require('./workRequestOffer')
const { isChangeRequest } = require('../agent/requestShape')

/* ═══ 1. THE SECOND CHECK EXISTS AND IS INDEPENDENT ══════════════════════ */

test('*** the double-check is a different implementation, not a copied regex ***', () => {
  const fs = require('fs')
  const shape = fs.readFileSync(require.resolve('../agent/requestShape'), 'utf8')
  const offer = fs.readFileSync(require.resolve('./workRequestOffer'), 'utf8')
  const shapeNegated = /const NEGATED = (\/.*\/i)/.exec(shape)
  assert.ok(shapeNegated, 'requestShape.NEGATED not found')
  assert.equal(offer.includes(shapeNegated[1]), false,
    'the same regex appears in both files — that is one implementation typed twice')
  assert.equal(offer.includes("require('./requestShape')") && offer.includes('NEGATED'), false,
    'the second check must not import the first one\'s pattern')
})

test('*** either check refusing is enough ***', () => {
  for (const m of ['唔好改 docs/notes.md', '唔使改 docs/notes.md 第三行', '暫時唔好改 docs/notes.md 第三行']) {
    assert.equal(offerFor({ message: m, conversation: '', hasProposal: false }), null, m)
  }
})

/* ═══ 2. THE SECOND CHECK ON ITS OWN ═════════════════════════════════════ */

test('*** it catches a refusal the first check would miss ***', () => {
  // The point of a second implementation: it must be able to catch something the first
  // cannot. A refusal marker the flat alternation does not list, sitting right before the
  // verb, is caught by proximity.
  assert.equal(refusesChange('千祈唔好改 docs/notes.md'), true)
  assert.equal(refusesChange('搞掂之前咪住改 docs/notes.md'), true)
})

test('it does not fire on a plain request', () => {
  for (const m of ['幫我改 docs/canary/agent-canary.md，第二行改成 line 3', '唔該幫我加一行入 docs/notes.md']) {
    assert.equal(refusesChange(m), false, m)
  }
})

test('*** 唔該 is politeness and must never read as a refusal ***', () => {
  // 唔該 opens with the same character as 唔好. Getting this wrong would refuse the most
  // ordinary polite request the Owner types.
  assert.equal(refusesChange('唔該幫我改 docs/notes.md 第二行'), false)
  assert.equal(isChangeRequest('唔該幫我改 docs/notes.md 第二行').ok, true)
})

/* ═══ 3. THE EXCEPTION IS DOCUMENTED WHERE IT WILL BE SEEN ═══════════════ */

test('*** both files carry the exception and its reasoning at the top ***', () => {
  // The Owner asked for this explicitly: whoever later "consolidates" these two must see
  // why they are deliberately separate before they merge them.
  const fs = require('fs')
  for (const f of ['../agent/requestShape', './workRequestOffer']) {
    const src = fs.readFileSync(require.resolve(f), 'utf8')
    const header = src.slice(0, src.indexOf('*/') + 2)
    assert.ok(/DELIBERATELY SEPARATE|TWO IMPLEMENTATIONS ON PURPOSE/.test(header),
      f + ': the exception is not stated in the header')
    assert.ok(/negation|NEGATION/.test(header), f + ': the header does not say what is doubled')
  }
})
