'use strict'
const { digest } = require('./windowsSandbox'), browser = require('./browserEvidence')
const visual = require('../../design/visualReview'), design = require('../../design/uiDesign')
function validate (order, packet) {
  const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.slice().sort().join(',')
  const fail = () => { throw Error('accepted_evidence_changed') }
  const guide = design.forFiles(order.editable)
  if (!guide || !exact(packet, ['changes', 'patchHash', 'visual', 'browser']) || !Array.isArray(packet.changes) || packet.changes.length !== order.editable.length || new Set(packet.changes.map(c => c?.file)).size !== order.editable.length || digest(JSON.stringify(packet.changes)) !== packet.patchHash || !browser.complete(packet.browser)) fail()
  for (const c of packet.changes) {
    if (!exact(c, ['file','before','after','beforeHash','afterHash']) || !order.editable.includes(c.file) || c.before !== order.files[c.file] || typeof c.after !== 'string' || !c.after || c.before === c.after || Buffer.byteLength(c.after) > require('./packageLimits').fileLimit(c.file) || digest(c.before) !== c.beforeHash || digest(c.after) !== c.afterHash) fail()
  }
  const r = packet.visual
  try { visual.validate({ verdict: r.verdict, summary: r.summary, inspected: r.inspected, findings: r.findings }, browser.NAMES) } catch (_) { fail() }
  if (r.verdict !== 'changes_requested' || r.patchHash !== packet.patchHash || r.model !== 'gpt-6.1-sol' || r.billing !== 'chatgpt-subscription' || !Number.isFinite(Date.parse(r.reviewedAt)) || JSON.stringify(r.design) !== JSON.stringify(guide.receipt) || !Array.isArray(r.screenshots) || r.screenshots.length !== 4 || browser.NAMES.some(name => {
    const a = r.screenshots.filter(p => p?.name === name), b = packet.browser.filter(p => p.name === name)
    return a.length !== 1 || b.length !== 1 || a[0].screenshotHash !== b[0].screenshotHash
  })) fail()
  // Opinion data cannot replace source, scope, tests, credentials or approval.
  return structuredClone(packet)
}
function fromReview (order, result, review) {
  if (review?.verdict !== 'changes_requested' || review.billing !== 'claude-subscription' || result?.appliedToLive !== false || result.billing !== 'chatgpt-subscription') throw Error('accepted_evidence_changed')
  return validate(order, { changes: result.changes, patchHash: result.patchHash, visual: review.visual, browser: result.tests?.browser })
}
module.exports = { validate, fromReview }
