'use strict'

/**
 * cantoneseComprehension.test.js — her OUTPUT changes; her EAR does not.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * The Owner Language Policy changes what 香香 WRITES. Several tables in this codebase hold
 * Cantonese for the opposite reason: to UNDERSTAND what the Owner writes, and to recognise
 * what a model wrote. A tidy-minded style pass over "all the Cantonese in the repo" would
 * delete them, and every one of those deletions is a silent capability loss:
 *
 *   requestInference politeness prefix   — 「唔該幫我改…」 would keep its opening as part of
 *                                          the file description
 *   INSTRUCTION_MARKERS                  — 「讀唔到嘅直接講讀唔到」 would be sent to Drive as
 *                                          a SEARCH TERM instead of recognised as an
 *                                          instruction to her
 *   CJK_PARTICLES                        — clause segmentation for Cantonese input
 *   UNREADABLE_CLAIM (Cantonese half)    — THE MOST DANGEROUS ONE. It judges the MODEL's
 *                                          reply. The model can still emit 讀唔到 whatever
 *                                          the contract says, and if this regex stops
 *                                          matching, the honesty layer goes blind while
 *                                          every one of its tests still passes.
 *   MockAdapter greetings                — test fixture input
 *   scopeNotes keyword tables            — detect HER OWN scope wording, past and future
 *
 * These are BEHAVIOURAL assertions wherever the module exports enough to make them
 * behavioural — what the function does with Cantonese input, not how a constant is spelled.
 * A test that only checked the spelling would pass a refactor that broke the behaviour.
 *
 * DO NOT "CLEAN UP" ANY OF THIS. Owner instruction, 2026-08-04: only her output changes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/* ═══ 1. THE OWNER'S OWN WORDS — request parsing ════════════════════════════ */

test('*** a Cantonese request still has its politeness prefix stripped ***', () => {
  const { inferWorkRequest } = require('../agent/requestInference')
  for (const opener of ['唔該', '幫我', '你可唔可以', '麻煩']) {
    const out = inferWorkRequest({ message: opener + '改 src/demo/assets/app.js 嗰句歡迎語', conversation: '' })
    assert.ok(out && typeof out === 'object', opener + ' must still parse')
    const blob = JSON.stringify(out)
    assert.equal(blob.includes(opener), false, `'${opener}' leaked into the work request — the prefix table lost it`)
  }
})

/* ═══ 2. AN INSTRUCTION IS NOT A SEARCH TERM ═══════════════════════════════ */

test('*** 「讀唔到嘅直接講讀唔到」 is recognised as an instruction, never searched for ***', () => {
  const { extractKeywords } = require('../context/readContext')
  const kws = extractKeywords('Drive 有冇中央廚房設備嘅文件? 每項請講出處同日期,讀唔到嘅直接講讀唔到。')
  const blob = kws.join(' ')
  for (const leak of ['讀唔到', '出處', '每項', '請講']) {
    assert.equal(blob.includes(leak), false, `INSTRUCTION_MARKERS lost '${leak}' — it is now a search term`)
  }
  assert.ok(kws.length > 0, 'and the real terms still survive: ' + blob)
})

test('Cantonese particles still segment a clause', () => {
  const { extractKeywords } = require('../context/readContext')
  // 嘅/嗰/喺 as boundaries: without them the whole clause becomes one useless term.
  const kws = extractKeywords('中央廚房嘅設備喺邊個倉')
  assert.ok(kws.some((k) => k.includes('中央廚房') || k.includes('設備')), 'segmented, not one blob: ' + kws.join(' '))
})

/* ═══ 3. THE HONESTY LAYER MUST STILL HEAR CANTONESE ═══════════════════════ */

test('*** UNREADABLE_CLAIM keeps BOTH spellings — this one goes blind silently ***', () => {
  const { UNREADABLE_CLAIM, detectFalseReadClaim } = require('../intake/readStateGuard')
  const live = [{ source: 'calendar', trust: 'live', count: 3, usedFallback: false }]
  // Cantonese — what she said before the policy, and what the model may still emit.
  for (const claim of ['我目前讀唔到你的日曆。', '我睇唔到你的日曆。', '個日曆我攞唔到。']) {
    assert.ok(UNREADABLE_CLAIM.test(claim), 'regex lost the Cantonese form: ' + claim)
    assert.equal(detectFalseReadClaim(claim, live).violated, true, 'and the guard must still catch it: ' + claim)
  }
  // Written Chinese — what she will say after it. Both must work, forever.
  for (const claim of ['我目前讀不到你的日曆。', '我看不到你的日曆。', '無法讀取你的日曆。']) {
    assert.ok(UNREADABLE_CLAIM.test(claim), 'regex missing the written form: ' + claim)
    assert.equal(detectFalseReadClaim(claim, live).violated, true, 'the guard must catch it too: ' + claim)
  }
})

/* ═══ 4. FIXTURES AND KEYWORD TABLES ═══════════════════════════════════════ */

test('the MockAdapter still recognises Cantonese greetings', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../adapters/MockAdapter.js'), 'utf8')
  for (const g of ['哈囉', '你好']) assert.ok(src.includes(g), 'greeting fixture lost: ' + g)
})

test('*** the scope-note tables keep their Cantonese forms ***', () => {
  // She has already written seven turns of these. The conversation history on disk is
  // Cantonese, and suppression compares against it — dropping these forms would make every
  // stored conversation stop matching.
  const { CONCEPTS } = require('./scopeNotes')
  const words = CONCEPTS.flatMap((c) => c.words)
  for (const w of ['邊個倉', '幾時更新', '幾時嘅', '淨係顯示', '唔係全部']) {
    assert.ok(words.includes(w), 'scopeNotes lost the Cantonese form: ' + w)
  }
})
