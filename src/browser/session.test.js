'use strict'
/**
 * session.test.js — `read → act → read → act`, enforced rather than documented.
 *
 * > **Owner: 「a rule that lives in a document will be broken by whoever writes the first real
 * > errand — probably you, probably next week. If the runner can refuse a plan that acts twice
 * > on refs from one read, it should.」**
 *
 * Measured on en.wikipedia.org: clicking Search re-rendered the header and
 * `link "Jump to content"` changed backendDOMNodeId 8001 -> 20437 while staying on the page.
 * A ref is valid for the READ that produced it, and this file is the fence.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { buildSession, SESSION_REFUSAL } = require('./session')

const fakeDeps = (opts = {}) => {
  const log = []
  return {
    log,
    read: async () => { log.push('read'); return { nodes: [{ ref: 'r1', domId: 1, role: 'button', name: 'A' }, { ref: 'r2', domId: 2, role: 'link', name: 'B' }], text: 'x', truncated: false } },
    click: async (t) => { log.push('click:' + t.ref); return { outcome: opts.clickOutcome || 'CLICKED', record: { ref: t.ref } } },
    type: async (t) => { log.push('type:' + t.ref); return { outcome: 'TYPED', record: { ref: t.ref, length: 3, shape: 'text' } } },
    waitFor: async () => { log.push('wait'); return { outcome: 'HAPPENED', waitedMs: 5 } },
    screenshot: async () => { log.push('shot'); return { outcome: 'CAPTURED', bytes: 10, isPrimaryRecord: false } }
  }
}

describe('the composition rule is a MECHANISM, not a note', () => {
  test('read -> act -> read -> act is allowed', async () => {
    const d = fakeDeps()
    const s = buildSession(d)
    const v1 = await s.read()
    assert.strictEqual((await s.click(v1.nodes[0])).outcome, 'CLICKED')
    const v2 = await s.read()
    assert.strictEqual((await s.click(v2.nodes[1])).outcome, 'CLICKED')
    assert.deepStrictEqual(d.log, ['read', 'click:r1', 'read', 'click:r2'])
  })

  test('⛔ read -> act -> act is REFUSED — the second ref is from a spent read', async () => {
    const d = fakeDeps()
    const s = buildSession(d)
    const v = await s.read()
    await s.click(v.nodes[0])
    const second = await s.click(v.nodes[1])
    assert.strictEqual(second.outcome, 'REFUSED')
    assert.strictEqual(second.reason, SESSION_REFUSAL.STALE_READ)
    assert.deepStrictEqual(d.log, ['read', 'click:r1'], 'the second click never reached the browser')
  })

  test('the refusal happens BEFORE any browser call — not after a failed attempt', async () => {
    const d = fakeDeps()
    const s = buildSession(d)
    const v = await s.read()
    await s.type({ ...v.nodes[0], text: 'abc' })
    const before = d.log.length
    await s.type({ ...v.nodes[1], text: 'abc' })
    assert.strictEqual(d.log.length, before, 'nothing was attempted')
  })

  test('it names WHICH read the ref came from and how many acts have happened since', async () => {
    const s = buildSession(fakeDeps())
    const v = await s.read()
    await s.click(v.nodes[0])
    const r = await s.click(v.nodes[1])
    assert.match(r.detail, /read #1/)
    assert.match(r.detail, /re-read/i, 'and it says what to do about it')
  })

  test('a ref that was never read at all is refused too', async () => {
    const s = buildSession(fakeDeps())
    await s.read()
    const r = await s.click({ ref: 'r-invented', domId: 9, role: 'button', name: 'X' })
    assert.strictEqual(r.reason, SESSION_REFUSAL.UNKNOWN_REF)
  })

  test('acting before ANY read is refused', async () => {
    const s = buildSession(fakeDeps())
    const r = await s.click({ ref: 'r1', domId: 1, role: 'button', name: 'A' })
    assert.strictEqual(r.reason, SESSION_REFUSAL.NO_READ)
  })
})

describe('what does and does not spend a read', () => {
  test('wait_for spends it — waiting for a change means the DOM changed', async () => {
    const d = fakeDeps()
    const s = buildSession(d)
    const v = await s.read()
    await s.waitFor({ condition: 'element_visible', ref: v.nodes[0].ref })
    const r = await s.click(v.nodes[0])
    assert.strictEqual(r.reason, SESSION_REFUSAL.STALE_READ)
  })

  test('screenshot does NOT spend it — it changes nothing', async () => {
    const d = fakeDeps()
    const s = buildSession(d)
    const v = await s.read()
    await s.screenshot({})
    assert.strictEqual((await s.click(v.nodes[0])).outcome, 'CLICKED')
  })

  test('a REFUSED action does not spend the read — nothing happened, so nothing changed', async () => {
    const d = fakeDeps({ clickOutcome: 'REFUSED' })
    const s = buildSession(d)
    const v = await s.read()
    await s.click(v.nodes[0])
    const r = await s.click(v.nodes[1])
    assert.strictEqual(r.outcome, 'REFUSED')
    assert.notStrictEqual(r.reason, SESSION_REFUSAL.STALE_READ,
      'a refused act must not cost the caller its read')
  })
})

describe('the plan check — a whole errand can be refused before it starts', () => {
  test('a plan that acts twice on one read is refused without running', async () => {
    const s = buildSession(fakeDeps())
    const v = await s.checkPlan([
      { verb: 'read_page' }, { verb: 'click' }, { verb: 'click' }
    ])
    assert.strictEqual(v.ok, false)
    assert.strictEqual(v.reason, SESSION_REFUSAL.STALE_READ)
    assert.match(v.detail, /step 3/)
  })

  test('a correctly alternating plan passes', async () => {
    const s = buildSession(fakeDeps())
    const v = await s.checkPlan([
      { verb: 'navigate' }, { verb: 'read_page' }, { verb: 'click' },
      { verb: 'read_page' }, { verb: 'type' }, { verb: 'wait_for' }
    ])
    assert.strictEqual(v.ok, true)
  })

  test('screenshot between two acts does not rescue a plan', async () => {
    const s = buildSession(fakeDeps())
    const v = await s.checkPlan([
      { verb: 'read_page' }, { verb: 'click' }, { verb: 'screenshot' }, { verb: 'click' }
    ])
    assert.strictEqual(v.ok, false, 'a screenshot is not a read')
  })
})
