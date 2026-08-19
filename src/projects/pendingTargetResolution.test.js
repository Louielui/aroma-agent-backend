'use strict'

/**
 * pendingTargetResolution.test.js — the ticket, and everything it is not.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY A TICKET AT ALL. When the Owner is shown two files and picks one, something must carry
 * that choice back. The obvious way — send the path — hands target selection to the browser,
 * which is the single thing the chain from work request to sealed Work Order exists to prevent.
 * So the candidates stay server-side and the page gets an opaque ticket.
 *
 * ⛔ A TICKET IS NOT A CREDENTIAL. It is accepted only when the Owner's own login session and
 * the conversation agree, and only once. Every test below is one of the ways that could quietly
 * stop being true.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createPendingTargetResolutions, KIND, OUTCOME, DEFAULT_TTL_MS } = require('./pendingTargetResolution')

const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const SRC = codeOf(fs.readFileSync(path.join(__dirname, 'pendingTargetResolution.js'), 'utf8'))

let clock = 1000
const store = () => createPendingTargetResolutions({ ttlMs: 1000, now: () => clock })
const twoFiles = [{ kind: KIND.FILE, file: 'src/a.js' }, { kind: KIND.FILE, file: 'src/b.js' }]
const make = (s, over) => s.create(Object.assign({
  ownerSessionId: 'S1',
  conversationId: 'C1',
  originalOwnerMessage: '幫我改 src/a.js 同 src/b.js，加一句',
  originalIntent: '加一句',
  source: 'explicit_file_candidates',
  candidates: twoFiles
}, over))

test('*** the TTL is ten minutes by default ***', () => {
  assert.equal(DEFAULT_TTL_MS, 10 * 60 * 1000)
})

test('*** ⛔ IDS ARE OPAQUE — not an index, not a path, not a targetId ***', () => {
  const s = store()
  const r = make(s)
  assert.ok(r.resolutionId.length >= 20, 'a resolution id is unguessable')
  for (const c of r.candidates) {
    assert.ok(c.candidateId.length >= 20)
    assert.equal(/src|a\.js|b\.js|^[01]$/.test(c.candidateId), false, '⛔ the ticket carries meaning: ' + c.candidateId)
  }
  assert.notEqual(r.candidates[0].candidateId, r.candidates[1].candidateId)
})

test('*** ⛔ A VALID SELECTION RETURNS THE SERVER\'S OWN FILE AND THE OWNER\'S OWN WORDS ***', () => {
  const s = store()
  const r = make(s)
  const out = s.select({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1', candidateId: r.candidates[0].candidateId })
  assert.equal(out.ok, true)
  assert.equal(out.outcome, OUTCOME.SELECTED)
  assert.equal(out.candidate.file, 'src/a.js', 'the path came from the store, not from the caller')
  assert.equal(out.originalOwnerMessage, '幫我改 src/a.js 同 src/b.js，加一句')
  assert.equal(out.originalIntent, '加一句', '⛔ the goal is what he asked for, never the file he picked')
})

test('*** ⛔ MEMBERSHIP: A TICKET FROM NOWHERE IS NOT A CHOICE ***', () => {
  const s = store()
  const r = make(s)
  for (const bad of ['made-up', '', null, r.resolutionId]) {
    const out = s.select({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1', candidateId: bad })
    assert.equal(out.ok, false, '⛔ an unknown candidateId was accepted: ' + bad)
    assert.equal(out.outcome, OUTCOME.INVALID)
  }
})

test('*** ⛔ THE OWNER\'S SESSION MUST MATCH ***', () => {
  const s = store()
  const r = make(s)
  const out = s.select({ resolutionId: r.resolutionId, ownerSessionId: 'SOMEONE_ELSE', conversationId: 'C1', candidateId: r.candidates[0].candidateId })
  assert.equal(out.outcome, OUTCOME.WRONG_SESSION)
  // and the resolution is still usable by its real owner — a wrong attempt does not burn it
  assert.equal(s.select({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1', candidateId: r.candidates[0].candidateId }).ok, true)
})

test('*** ⛔ CONVERSATION A CANNOT COMPLETE CONVERSATION B ***', () => {
  const s = store()
  const r = make(s)
  const out = s.select({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C2', candidateId: r.candidates[0].candidateId })
  assert.equal(out.outcome, OUTCOME.WRONG_CONVERSATION)
})

test('*** ⛔ ONE-TIME: A CHOICE CANNOT BE REPLAYED ***', () => {
  const s = store()
  const r = make(s)
  assert.equal(s.select({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1', candidateId: r.candidates[0].candidateId }).ok, true)
  const again = s.select({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1', candidateId: r.candidates[1].candidateId })
  assert.equal(again.outcome, OUTCOME.CONSUMED, '⛔ a consumed resolution answered a second time')
})

test('*** ⛔ EXPIRY: A STALE CHOICE FAILS CLOSED ***', () => {
  const s = store()
  const r = make(s)
  clock += 2000
  assert.equal(s.select({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1', candidateId: r.candidates[0].candidateId }).outcome, OUTCOME.EXPIRED)
  clock = 1000
})

test('*** ⛔ A NEW REQUEST RETIRES THE OLD CARD ***', () => {
  /**
   * ⛔ Without this, a card left on screen from two minutes ago could still be pressed — and it
   * would complete against the ORIGINAL message stored with it, not the one he has since typed.
   */
  const s = store()
  const old = make(s)
  make(s) // a new turn, same Owner, same conversation
  const out = s.select({ resolutionId: old.resolutionId, ownerSessionId: 'S1', conversationId: 'C1', candidateId: old.candidates[0].candidateId })
  assert.equal(out.outcome, OUTCOME.SUPERSEDED)
})

test('*** a different conversation is NOT superseded by another one\'s new turn ***', () => {
  const s = store()
  const other = make(s, { conversationId: 'C9' })
  make(s) // new turn in C1
  assert.equal(s.select({ resolutionId: other.resolutionId, ownerSessionId: 'S1', conversationId: 'C9', candidateId: other.candidates[0].candidateId }).ok, true)
})

test('*** cancel is one-time and creates nothing ***', () => {
  const s = store()
  const r = make(s)
  assert.equal(s.cancel({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1' }).outcome, OUTCOME.CANCELLED)
  assert.equal(s.cancel({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1' }).ok, false)
  assert.equal(s.select({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'C1', candidateId: r.candidates[0].candidateId }).ok, false)
})

test('*** cancel obeys the same three bindings ***', () => {
  const s = store()
  const r = make(s)
  assert.equal(s.cancel({ resolutionId: r.resolutionId, ownerSessionId: 'X', conversationId: 'C1' }).outcome, OUTCOME.WRONG_SESSION)
  assert.equal(s.cancel({ resolutionId: r.resolutionId, ownerSessionId: 'S1', conversationId: 'X' }).outcome, OUTCOME.WRONG_CONVERSATION)
})

test('*** an unknown resolutionId is refused, not guessed ***', () => {
  const s = store()
  assert.equal(s.select({ resolutionId: 'nope', ownerSessionId: 'S1', conversationId: 'C1', candidateId: 'x' }).outcome, OUTCOME.UNKNOWN)
})

test('*** ⛔ MEMORY ONLY — no disk, no env, no network ***', () => {
  assert.equal(/fs\.|readFileSync|writeFileSync|process\.env|fetch\(|child_process/.test(SRC), false,
    '⛔ a choice in a conversation started persisting itself')
  const requires = [...SRC.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(requires, ['node:crypto'], 'only the id source')
  assert.equal(/nonce|password|token|repoRoot/i.test(SRC), false, '⛔ it names a credential concept')
})

test('*** a resolution must be bound at creation, or it is not created ***', () => {
  const s = store()
  assert.throws(() => make(s, { ownerSessionId: '' }), /Owner session/)
  assert.throws(() => make(s, { conversationId: '' }), /conversation/)
  assert.throws(() => s.create({ ownerSessionId: 'S1', conversationId: 'C1', candidates: [] }), /candidates/)
})
