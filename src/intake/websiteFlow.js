'use strict'
const { t } = require('../i18n/t')
const { candidate } = require('./websiteIntent')
const { publicUrl, validTarget } = require('../subscription/websitePolicy')

async function runWebsiteFlow ({ message, history = [], classify, search, record = () => {}, readEnabled = true }) {
  if (!candidate(message)) return null
  const previous = history.filter(h => h && h.role === 'user').map(h => h.text || h.content).filter(s => typeof s === 'string' && s !== message).slice(-1)
  const owner = [...previous, message]
  // Current and one preceding owner turn only; no assistant output, memory or attachments.
  const evidence = { events: [], state: 'classifying', provider: 'codex', model: null }
  const step = (state, facts = {}) => { Object.assign(evidence, facts, { state }); evidence.events.push({ state, at: new Date().toISOString() }); record(structuredClone(evidence)) }
  const answer = reply => ({ blocked: false, intent: 'question', mode: 'chat', demoOutcome: 'chat', reply, tasks: [], decision: null, proposals: [], website: evidence })
  try {
    step('classifying')
    if (!readEnabled) { step('failed', { reason: 'read_disabled' }); return answer(t('website.disabled')) }
    if (owner.some(s => require('./redlinePolicy').checkRedLine(s).blocked)) {
      step('needs_input', { reason: 'sensitive_context' }); return answer(t('website.clarify'))
    }
    const plan = await classify(JSON.stringify({ previousOwnerTurn: previous[0] || null, latestOwnerTurn: message }))
    if (plan?.intent === 'other') { step('not_applicable'); return null }
    if (plan?.intent === 'clarify') { step('needs_input'); return answer(t('website.clarify')) }
    if (plan?.intent !== 'navigate' || !validTarget(plan.target) || !owner.some(s => s.includes(plan.target))) throw Error('invalid_target')
    step('searching', { target: plan.target })
    if (require('./redlinePolicy').checkRedLine(plan.target).blocked) throw Error('invalid_target')
    const result = await search(plan.target)
    const url = publicUrl(result?.url)
    if (result?.status !== 'found' || !url || !Number.isInteger(result.searchCalls) || result.searchCalls < 1) throw Error('website_not_verified')
    step('completed', { url, model: result.model, searchCalls: result.searchCalls })
    return answer(t('website.found', { url }))
  } catch (error) {
    // No provider text or false progress promises cross the failure boundary.
    try { step('failed', { reason: error.code === 'subscription_limit_reached' ? 'subscription_limit_reached' : 'website_unavailable' }) } catch (_) {}
    return answer(t('website.failed'))
  }
}
module.exports = { runWebsiteFlow, candidate, publicUrl }
