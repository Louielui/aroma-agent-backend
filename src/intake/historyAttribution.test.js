'use strict'

/**
 * historyAttribution.test.js — whose words were those?
 *
 * ── THE FINDING ──────────────────────────────────────────────────────────────
 * buildDistillPrompt labelled every history line by testing `h.role === 'louie'`. The
 * client sends `role: 'user'`. NOTHING in this codebase has ever sent 'louie' as a chat
 * role — that string exists only as an owner id in the proposal and confirm layers. So
 * every line, including the Owner's own questions, was attributed to 香香:
 *
 *     對話歷史(舊到新):
 *     香香: HIS QUESTION
 *     香香: HER ANSWER
 *
 * She has been reading his questions as her own monologue since the feature shipped. A
 * prior exchange that reads as something she already said gives her no reason to answer
 * differently, which is why two near-identical answers arrived a minute apart — a
 * behaviour the Owner noticed and blamed on the architecture.
 *
 * THE GUARD THAT MATTERS MORE THAN THE FIX: a hardcoded role name that nothing produces is
 * how this survived. The test below compares the role literals the PROMPT branches on
 * against the role literals the CLIENT actually emits, so a future rename on either side
 * fails here instead of silently re-attributing his words to her.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { buildDistillPrompt } = require('./distillPrompt')
const APP_JS = fs.readFileSync(path.resolve(__dirname, '../demo/assets/app.js'), 'utf8')
const DISTILL = fs.readFileSync(path.resolve(__dirname, 'distillPrompt.js'), 'utf8')

/** Every role the client actually pushes into history. */
function clientRoles () {
  const out = new Set()
  for (const m of APP_JS.matchAll(/history\.push\(\{\s*role:\s*'([a-z]+)'/g)) out.add(m[1])
  return out
}

/* ═══ the attribution itself ════════════════════════════════════════════════ */

test('*** the Owner\'s words are attributed to the OWNER, not to her ***', () => {
  const { prompt } = buildDistillPrompt('新問題', [
    { role: 'user', text: 'HIS_QUESTION' },
    { role: 'assistant', text: 'HER_ANSWER' }
  ])
  const lines = prompt.split('\n')
  const his = lines.find((l) => l.includes('HIS_QUESTION'))
  const hers = lines.find((l) => l.includes('HER_ANSWER'))
  assert.ok(his.startsWith('Louie:'), 'THE DEFECT: his question was labelled 香香 — got: ' + his)
  assert.ok(hers.startsWith('香香:'), 'and hers is still hers — got: ' + hers)
})

test('an unknown or missing role is attributed to the OWNER, never to her', () => {
  // The safe direction. Mislabelling her words as his loses a little context; mislabelling
  // HIS words as hers is the defect above, and it changes how she answers.
  const { prompt } = buildDistillPrompt('x', [{ text: 'NO_ROLE' }, { role: 'weird', text: 'ODD_ROLE' }])
  for (const marker of ['NO_ROLE', 'ODD_ROLE']) {
    const line = prompt.split('\n').find((l) => l.includes(marker))
    assert.ok(line.startsWith('Louie:'), marker + ' must not be attributed to 香香 — got: ' + line)
  }
})

/* ═══ the guard: no role string that nothing produces ═══════════════════════ */

test('*** the prompt only branches on roles the client actually sends ***', () => {
  const roles = clientRoles()
  assert.ok(roles.has('user') && roles.has('assistant'), 'the client sends user + assistant: ' + [...roles])

  // Every role literal the attribution compares against must be one the client emits.
  const attribution = DISTILL.slice(DISTILL.indexOf('function buildDistillPrompt'), DISTILL.indexOf('// --- Slice A'))
  for (const m of attribution.matchAll(/h\.role\s*===\s*'([a-z]+)'/g)) {
    assert.ok(roles.has(m[1]),
      `the prompt branches on role '${m[1]}', which the client never sends — that is exactly how this bug survived`)
  }
})

test('*** and \'louie\' is not a chat role anywhere ***', () => {
  const attribution = DISTILL.slice(DISTILL.indexOf('function buildDistillPrompt'), DISTILL.indexOf('// --- Slice A'))
  assert.equal(/h\.role\s*===\s*'louie'/.test(attribution), false,
    "'louie' is an owner id in the proposal layer, never a chat role")
})

/* ═══ same family: the router's own history reader ══════════════════════════ */

test('*** historyTextOf reads the field the client actually sends ***', () => {
  const { historyTextOf } = require('../routes/demoRouter')
  // It read `h.content` while the client pushes `{ role, text }`, so work-order inference
  // was handed an empty conversation on every turn.
  const out = historyTextOf([{ role: 'user', text: 'FROM_TEXT' }, { role: 'assistant', content: 'FROM_CONTENT' }])
  assert.ok(out.includes('FROM_TEXT'), 'THE DEFECT: the client sends `text` and this ignored it')
  assert.ok(out.includes('FROM_CONTENT'), 'and the stored shape still works')
})
