'use strict'
/**
 * traditionalGuard.test.js — the language rule stops being prose.
 *
 * > **Owner: 「Detect, record, flag — do not rewrite. Your mapping argument settles it: wrong
 * > Chinese that looks deliberate is worse than right Chinese in the wrong script.」**
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { enforceTraditional, logTraditionalFlag, VERDICT, SIMPLIFIED_ONLY, RETIRED_NOTE } = require('./traditionalGuard')

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
  test('*** ⛔ A FLAGGED REPLY IS RETURNED BYTE-IDENTICAL — NOTHING IS APPENDED ***', () => {
    const s = '这个系统还没有数据'
    const r = enforceTraditional(s)
    assert.strictEqual(r.flagged, true, 'the evidence is real — this must still be detected')
    assert.strictEqual(r.reply, s, 'the reply he receives must be EXACTLY what she wrote')
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

/* ═══════════════════════════════════════════════════════════════════════════
 * E1 — THE DIAGNOSTIC STOPPED SPEAKING TO HIM
 *
 * Proven by the C0 forensic on conversation 2f42f099 (2026-08-21): the appended note
 * reached the Owner as 香香's own prose on two of four turns, and — because a reply is
 * pushed back into live history as her prior turn — RE-ENTERED the model's context as
 * something she had said. Both halves are closed below.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('⛔ E1 — the Owner never sees the instrument', () => {
  test('*** ⛔ THE RETIRED NOTE IS ABSENT FROM EVERY REPLY, FLAGGED OR NOT ***', () => {
    const inputs = ['这个系统还没有数据', '這個仲未有', '出面好凍', 'OK, done.', '', null, undefined, 42, {}, []]
    for (const v of inputs) {
      assert.ok(!enforceTraditional(v).reply.includes(RETIRED_NOTE),
        JSON.stringify(v) + ' — the diagnostic sentence must never reach him again')
    }
  })

  test('*** ⛔ flagged === true MUST NOT IMPLY A MUTATED REPLY ***', () => {
    // The whole defect in one assertion: detection is a FACT ABOUT the turn, never a
    // CHANGE TO it. If this ever fails, the note has grown back.
    for (const s of ['这个还没有', '因为时间不够', '查不到是因为系统里还没有它的历史比较基准']) {
      const r = enforceTraditional(s)
      assert.strictEqual(r.flagged, true, s + ' is genuine evidence and must still flag')
      assert.strictEqual(r.reply, s, s + ' — flagged, but returned byte-identical')
    }
  })

  test('*** ⛔ HISTORY POLLUTION IS CLOSED — the reply passed onward is the model reply alone ***', () => {
    // The output boundary ONLY. What the pipeline hands onward becomes the assistant turn,
    // and the assistant turn is what re-enters live history on the next message. If the reply
    // is byte-identical to the model's text, no diagnostic can become a second paragraph and
    // no diagnostic can come back as her prose. Conversation history itself is not touched here.
    const modelReply = '这个系统还没有数据，我需要先看一下'
    const onward = enforceTraditional(modelReply).reply

    assert.strictEqual(onward, modelReply, 'the assistant turn must be the model reply alone')
    assert.ok(!onward.includes('⚠'), 'no warning glyph may enter the assistant turn')
    assert.strictEqual(onward.split('\n\n').length, 1, 'no second paragraph may be manufactured')

    // And the turn after it: history carries `onward` as her prior turn, unpolluted.
    const nextTurnHistory = [{ role: 'user', text: '點呀' }, { role: 'assistant', text: onward }]
    assert.ok(!nextTurnHistory.some((h) => h.text.includes(RETIRED_NOTE)),
      'the diagnostic must not re-enter the model context as something she said')
  })

  test('*** ⛔ NO CODE PATH CONCATENATES ANYTHING ONTO reply ***', () => {
    // Structural, because a behavioural test only covers the inputs it thought of. Comments are
    // stripped first — the E1 block above DISCUSSES the append, and prose is not code.
    const src = fs.readFileSync(path.join(__dirname, 'traditionalGuard.js'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

    assert.ok(!/reply:\s*text\s*\+/.test(code), 'reply must never be built by concatenation')
    assert.ok(!/RETIRED_NOTE/.test(code.replace(/const RETIRED_NOTE[^\n]*\n/, '').replace(/module\.exports[\s\S]*/, '')),
      'RETIRED_NOTE may be declared and exported — never referenced by the logic')
  })
})

describe('⛔ E1 — two characters that were never evidence', () => {
  test('*** ⛔ 出 AND 外 ARE IDENTICAL IN BOTH SCRIPTS AND MUST NOT BE IN THE SET ***', () => {
    assert.ok(!SIMPLIFIED_ONLY.includes('出'), '出 is written the same in Traditional — not evidence')
    assert.ok(!SIMPLIFIED_ONLY.includes('外'), '外 is written the same in Traditional — not evidence')
  })

  test('*** ⛔ 出 alone does not flag ***', () => {
    for (const s of ['出', '出面好凍', '我哋出去食飯', '開發出來']) {
      const r = enforceTraditional(s)
      assert.strictEqual(r.flagged, false, s + ' must not flag on 出 alone')
      assert.ok(!r.found.includes('出'), '出 must never appear as found evidence')
    }
  })

  test('*** ⛔ 外 alone does not flag ***', () => {
    for (const s of ['外', '外賣單', '外判服務', '出面同外面']) {
      const r = enforceTraditional(s)
      assert.strictEqual(r.flagged, false, s + ' must not flag on 外 alone')
      assert.ok(!r.found.includes('外'), '外 must never appear as found evidence')
    }
  })

  test('*** ⛔ THE OWNER\'S OWN SENTENCE, WHICH FIRED TWICE IN PRODUCTION ***', () => {
    // 「開發出來」 in his turn; 出 in her reply. requestIds f6d39840 and 9403aab5, both
    // logged [AROMA-LANG] found:["出"]. Neither may flag again.
    const s = '我需要把 Aroma System 開發出來, 給我們管理的容易點'
    const r = enforceTraditional(s)
    assert.strictEqual(r.verdict, VERDICT.CLEAN)
    assert.strictEqual(r.reply, s)
  })

  test('the distinct neighbours it drifted in beside are UNTOUCHED', () => {
    // 进/内 ARE distinct (進/內) and must keep working — the removal was surgical, not a purge.
    for (const ch of ['进', '内', '见', '观', '点', '认', '为', '这']) {
      assert.ok(SIMPLIFIED_ONLY.includes(ch), ch + ' is genuinely Simplified-only and must remain')
    }
  })
})

describe('⛔ E1 — the audit trail survives in the log, not on his screen', () => {
  test('*** ⛔ [AROMA-LANG] STILL EMITS EXACTLY ONCE WHEN EVIDENCE IS FOUND ***', () => {
    const lines = []
    const real = console.log
    console.log = (...a) => lines.push(a)
    try {
      logTraditionalFlag(enforceTraditional('这个系统还没有数据'), 'req-e1-test')
    } finally { console.log = real }

    assert.strictEqual(lines.length, 1, 'detection must remain countable')
    assert.strictEqual(lines[0][0], '[AROMA-LANG]')
    const payload = JSON.parse(lines[0][1])
    assert.strictEqual(payload.event, 'SIMPLIFIED_IN_REPLY')
    assert.strictEqual(payload.requestId, 'req-e1-test')
    assert.ok(Array.isArray(payload.found) && payload.found.length > 0)
    assert.ok(typeof payload.timestamp === 'string')

    // ⛔ AND IT CARRIES NO CONTENT. The fields are the whole allowlist.
    assert.deepStrictEqual(Object.keys(payload).sort(), ['event', 'found', 'requestId', 'timestamp'])
  })

  test('a clean reply logs nothing at all', () => {
    const lines = []
    const real = console.log
    console.log = (...a) => lines.push(a)
    try {
      logTraditionalFlag(enforceTraditional('這個仲未有'), 'req-e1-clean')
    } finally { console.log = real }
    assert.strictEqual(lines.length, 0)
  })
})
