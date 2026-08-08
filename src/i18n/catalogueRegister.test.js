'use strict'

/**
 * catalogueRegister.test.js — the INTERFACE is 書面中文. Her voice is not.
 *
 * The catalogue is what the Owner READS on screen: buttons, headings, status lines, refusals.
 * That register is written 書面, and it drifted — nine entries still carried oral markers
 * (「我做咗」,「開唔到」,「複製唔到」) after a batch that converted everything around them.
 * Nothing noticed, because register is invisible to every other check here: the strings
 * resolve, the punctuation is right, both locales are present, and the tests pass.
 *
 * ⛔ SCOPE, AND WHY IT IS THIS NARROW. Cantonese is CORRECT nearly everywhere else in this
 * repo and this fence must never reach those places:
 *   · 香香's own replies — she speaks the Owner's language; that is the product
 *   · the MODEL text she is TOLD (persona, contracts, prompts) — translating it changes behaviour
 *   · the MATCHING word lists (`requestShape.js`, `traditionalGuard.js`) — 唔好 / 冇 are the
 *     tokens being matched; rewriting them would silently delete a guard
 *   · the launcher and the notifier boxes, which live outside the catalogue entirely
 * So this reads `CATALOGUE[key].zh` and nothing else. A file-wide or repo-wide version of this
 * check would be wrong on its first run and switched off by its second.
 *
 * ⚠ WHAT IT CANNOT SEE: register is not only vocabulary. A sentence can be entirely 書面 in its
 * words and still read as speech in its rhythm, and no regex reaches that. This catches the
 * markers, which is how all nine actually looked.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { CATALOGUE } = require('./catalogue')

/**
 * Cantonese oral markers. Every one of these has a 書面 equivalent that means the same thing,
 * which is what makes them safe to forbid HERE — the fix is a swap, never a loss of meaning.
 */
const ORAL = [
  ['唔', '不 / 沒有'],
  ['冇', '沒有'],
  ['嘅', '的'],
  ['嗰', '那'],
  ['咗', '了'],
  ['喺', '在'],
  ['哋', '們'],
  ['乜', '什麼'],
  ['嘢', '東西 / 事情'],
  ['係咪', '是不是']
]

test('*** ⛔ no interface string is written in Cantonese oral register ***', () => {
  const hits = []
  for (const [key, entry] of Object.entries(CATALOGUE)) {
    if (!entry || typeof entry.zh !== 'string') continue
    for (const [marker, instead] of ORAL) {
      if (entry.zh.includes(marker)) {
        hits.push(key + '  「' + marker + '」→ ' + instead + '\n      ' + entry.zh.slice(0, 60))
        break
      }
    }
  }
  assert.deepEqual(hits, [],
    'the interface is 書面中文 — her replies are not, and this check deliberately cannot reach them')
})

/**
 * ⛔ SEEN TO FAIL. A register check that has never rejected anything is indistinguishable from
 * one whose marker list is empty, or whose loop never runs. This is the same fixture shape the
 * nine real entries had.
 */
test('*** the check rejects an entry that a human would call spoken ***', () => {
  const fixture = { 'fake.oral': { zh: '開唔到，我冇撳嗰個掣', en: 'Could not open it' } }
  const hits = []
  for (const [key, entry] of Object.entries(fixture)) {
    for (const [marker] of ORAL) {
      if (entry.zh.includes(marker)) { hits.push(key + ':' + marker); break }
    }
  }
  assert.equal(hits.length, 1, 'the marker list must actually match spoken Cantonese')
  assert.equal(hits[0], 'fake.oral:唔')
})
