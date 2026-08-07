'use strict'
/**
 * traditionalGuard.test.js — the language rule stops being prose.
 *
 * > **Owner: 「Detect, record, flag — do not rewrite. Your mapping argument settles it: wrong
 * > Chinese that looks deliberate is worse than right Chinese in the wrong script.」**
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { enforceTraditional, VERDICT, NOTE } = require('./traditionalGuard')

describe('⛔ the reply that started this is caught', () => {
  test('the real Simplified sentence from 2026-08-07', () => {
    const r = enforceTraditional('查不到是因为系统里还没有它的历史比较基准')
    assert.strictEqual(r.verdict, VERDICT.SIMPLIFIED_FOUND)
    assert.ok(r.found.length > 0, 'it must name what it found, not just say something is wrong')
    assert.strictEqual(r.flagged, true)
  })

  test('an ordinary Traditional reply passes untouched', () => {
    const s = '查唔到係因為系統裡面仲未有佢嘅歷史比較基準。'
    const r = enforceTraditional(s)
    assert.strictEqual(r.verdict, VERDICT.CLEAN)
    assert.strictEqual(r.reply, s, 'a clean reply must be byte-identical')
  })
})

describe('⛔ it does not rewrite — ever', () => {
  test('the original text survives in full; only a note is appended', () => {
    const s = '这个系统还没有数据'
    const r = enforceTraditional(s)
    assert.ok(r.reply.startsWith(s), 'the reply he receives must still be what she wrote')
    assert.ok(r.reply.includes(NOTE.trim().slice(0, 8)))
  })

  test('⛔ no character of the original is substituted', () => {
    // 发 → 發/髮 and 干 → 乾/幹/干 are why. A wrong conversion looks deliberate.
    const s = '这个还没有'
    const r = enforceTraditional(s)
    for (const ch of s) assert.ok(r.reply.includes(ch), ch + ' was altered — the guard must not convert')
  })
})

describe('⛔ it passes on uncertainty, and says which uncertainty', () => {
  test('a reply with no Han characters is NO_EVIDENCE, not CLEAN', () => {
    // Not the same claim: an English reply was never in scope, and calling it clean would be
    // asserting something the guard never checked.
    const r = enforceTraditional('OK, done — 12 items.')
    assert.strictEqual(r.verdict, VERDICT.NO_EVIDENCE)
    assert.strictEqual(r.flagged, false)
  })

  test('a short reply of shared characters passes', () => {
    // 「好」 and 「一二三」 exist identically in both. There is nothing to act on.
    for (const s of ['好', '一二三', '我知道了']) {
      assert.notStrictEqual(enforceTraditional(s).verdict, VERDICT.SIMPLIFIED_FOUND, s + ' must not be flagged')
    }
  })

  test('⛔ SEEN TO FAIL — the guard is capable of missing, and this proves it', () => {
    // A Simplified sentence built ONLY from shared characters. The guard passes it, and that
    // is the documented residual: this narrows the surface, it does not close it.
    const sharedOnly = '我知道你的意思'
    assert.strictEqual(enforceTraditional(sharedOnly).verdict, VERDICT.CLEAN,
      'if this ever flags, the character set has grown into a maintained list')
  })

  test('an empty or non-string reply does not throw', () => {
    for (const v of ['', null, undefined, 42]) {
      assert.doesNotThrow(() => enforceTraditional(v))
    }
  })
})

describe('the record', () => {
  test('it names the characters it found, capped', () => {
    const r = enforceTraditional('这个系统还没有数据来说时会对开关问题实现发现电话语言书写学习')
    assert.ok(r.found.length <= 12, 'a record is evidence, not a dump')
    assert.ok(r.found.every((c) => typeof c === 'string' && c.length === 1))
  })

  test('⛔ a flagged reply is distinguishable from a clean one by a FIELD, not by reading it', () => {
    assert.strictEqual(enforceTraditional('这个还没有').flagged, true)
    assert.strictEqual(enforceTraditional('這個仲未有').flagged, false)
  })
})
