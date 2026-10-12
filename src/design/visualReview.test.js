'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const names = ['zh','en'].flatMap(locale => [1280,390].map(width => `browser-${locale}-${width}.png`))
const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), Buffer.alloc(1500)])
const rows = names.map(name => ({ name, screenshotHash: require('node:crypto').createHash('sha256').update(bytes).digest('hex') }))
function fixture () {
  let called = 0, request
  const reviewer = require('./visualReview').createVisualReviewer({ readScreenshot: (_, name) => ({ name, content: bytes.toString('base64') }),
    client: { complete: async (options, input) => { called++; request = input; return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ verdict: 'pass', summary: 'Readable, compact navigation.', inspected: names, findings: [] }) } } }, options: {} })
  return { reviewer, counts: () => called, request: () => request }
}
const packet = () => ({ workOrder: { allowedFiles: ['src/demo/assets/sidebar.js','src/demo/assets/sidebar.css'], goal: 'Compact header' }, tests: { browser: structuredClone(rows) }, patchHash: 'a'.repeat(64) })
test('visual review sends verified pixels with provenance and keeps tools disabled', async () => {
  const f = fixture(), r = await f.reviewer(packet())
  assert.equal(f.counts(), 1); assert.equal(r.verdict, 'pass'); assert.equal(r.model, 'gpt-6.1-sol')
  assert.deepEqual(r.screenshots, rows); assert.equal(r.patchHash, 'a'.repeat(64))
  assert.deepEqual(f.request().images, names.map(() => 'data:image/png;base64,' + bytes.toString('base64')))
  assert.ok(f.request().system.includes('chat-first'))
})
test('missing, duplicate and changed screenshots stop before any model call', async () => {
  for (const change of [p => p.tests.browser.pop(), p => p.tests.browser[1] = p.tests.browser[0], p => p.tests.browser[0].screenshotHash = 'b'.repeat(64)]) {
    const f = fixture(), p = packet(); change(p); await assert.rejects(f.reviewer(p), /visual_evidence_unavailable/); assert.equal(f.counts(), 0)
  }
})
test('a pass requires all screenshots inspected; visual findings cannot be hidden by a pass', () => {
  const { validate } = require('./visualReview')
  const good = { verdict: 'changes_requested', summary: 'Header crowds chat.', inspected: names, findings: [{ screenshot: names[0], message: 'Reduce the header height.' }] }
  assert.deepEqual(validate(good, names), good)
  for (const r of [{ ...good, verdict: 'pass' }, { ...good, inspected: names.slice(1) }, { ...good, command: 'execute' }]) assert.throws(() => validate(r, names), /invalid_visual_review/)
})

test('adoption binds the visual verdict to the exact design, patch and screenshots', async () => {
  const f = fixture(), p = packet(), receipt = await f.reviewer(p)
  const { verifyReceipt } = require('./visualReview'), result = { design: receipt.design, tests: p.tests, patchHash: p.patchHash }
  assert.equal(verifyReceipt(receipt, result, result.design), true)
  for (const change of [v => v.verdict = 'changes_requested', v => v.patchHash = 'b'.repeat(64), v => v.design.hash = 'b'.repeat(64), v => v.screenshots.pop(), v => v.screenshots[0].screenshotHash = 'b'.repeat(64), v => v.billing = 'api', v => v.inspected.pop()]) {
    const v = structuredClone(receipt); change(v); assert.throws(() => verifyReceipt(v, result, result.design), /accepted_evidence_changed/)
  }
  assert.throws(() => verifyReceipt(null, result, result.design), /accepted_evidence_changed/)
})
