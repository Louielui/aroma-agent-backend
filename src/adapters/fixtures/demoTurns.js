'use strict'

/**
 * demoTurns.js — B2-2 Xiang Xiang Conversation Demo (thin slice 1).
 *
 * The four canonical demo utterances, the distill output ({ mode, intent }) each
 * should yield, and the expected demo outcome. Two uses:
 *   1. Deterministic acceptance fixtures for demoOutcome.test.js (this slice).
 *   2. Later: canned MockAdapter responses so the four inputs classify
 *      deterministically in TESTS ONLY.
 *
 * IMPORTANT: these are TEST fixtures. The live first-conversation with Xiang
 * Xiang runs the REAL reasoning provider (claude) + persona + context card —
 * NOT these samples. Mock is for acceptance/regression determinism only.
 */

const DEMO_TURNS = Object.freeze([
  Object.freeze({
    id: 'speech',
    input: '今天先不要動程式，我想聊聊架構。',
    distilled: Object.freeze({ mode: 'chat', intent: 'chit_chat' }),
    expectedOutcome: 'speech'
  }),
  Object.freeze({
    id: 'context',
    input: '從今天開始，我們一起開發 Aroma System。',
    distilled: Object.freeze({ mode: 'chat', intent: 'context' }),
    expectedOutcome: 'context'
  }),
  Object.freeze({
    id: 'clarification',
    input: '把聊天介面某個你真的不滿意的地方改善一下。',
    distilled: Object.freeze({ mode: 'ask', intent: 'unclear' }),
    expectedOutcome: 'clarification'
  }),
  Object.freeze({
    id: 'execution_proposal',
    input: '把 Timeline 到終止狀態後的輪詢停掉。',
    distilled: Object.freeze({ mode: 'commit', intent: 'task' }),
    expectedOutcome: 'execution_proposal'
  })
])

module.exports = { DEMO_TURNS }
