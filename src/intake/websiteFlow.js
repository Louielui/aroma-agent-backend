'use strict'
const { t } = require('../i18n/t')
const { candidate } = require('./websiteIntent')
const { publicUrl, validTarget } = require('../subscription/websitePolicy')

async function runWebsiteFlow ({ message, history = [], classify, search, record = () => {}, readEnabled = true, onClassification = () => {} }) {
  if (!candidate(message)) return null
  // History contains prior turns, even when their text matches the current input.
  // Keep repetitions; the current input belongs only in latestOwnerTurn below.
  const previous = (Array.isArray(history) ? history : []).filter(h => h && h.role === 'user').map(h => h.text || h.content).filter(s => typeof s === 'string').slice(-4).map(s => s.slice(0, 450))
  const owner = [...previous, message]
  // Bounded owner context only; assistant claims and memory cannot become search targets.
  const evidence = { events: [], state: 'classifying', provider: 'codex', model: null }
  const step = (state, facts = {}) => { Object.assign(evidence, facts, { state }); evidence.events.push({ state, at: new Date().toISOString() }); record(structuredClone(evidence)) }
  const answer = reply => ({ blocked: false, intent: 'question', mode: 'chat', demoOutcome: 'chat', reply, tasks: [], decision: null, proposals: [], website: evidence })
  try {
    step('classifying')
    if (!readEnabled) { step('not_applicable', { reason: 'read_disabled' }); return null }
    if (owner.some(s => require('./redlinePolicy').checkRedLine(s).blocked)) {
      step('needs_input', { reason: 'sensitive_context' }); return answer(t('website.sensitiveContext'))
    }
    const plan = await classify(JSON.stringify({ previousOwnerTurn: previous.at(-1) || null, previousOwnerTurns: previous, latestOwnerTurn: message }))
    onClassification(plan)
    // Navigation is a link deliverable, not a shortcut around factual retrieval.
    // Conflicting/missing output evidence falls through to the existing query chain.
    if(plan?.intent==='navigate' && plan.requestedOutput!=='website_url'){step('not_applicable');return null}
    if (plan?.intent === 'other') { step('not_applicable'); return null }
    // This specialist cannot establish ambiguity for the whole conversation. The
    // ordinary brain has working context, memory and self facts that it lacks.
    if (plan?.intent === 'clarify') { step('not_applicable', { reason: 'requires_full_understanding' }); return null }
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
    if(error.code==='subscription_login_required'){
      try{step('failed',{reason:'subscription_login_required'})}catch(_){}
      return answer(t('website.subscriptionLoginRequired'))
    }
    const stage = evidence.state === 'searching' ? 'search' : 'classification'
    const reason = error.code === 'subscription_limit_reached' ? 'subscription_limit_reached'
      : error.message === 'invalid_target' ? 'invalid_target'
        : stage === 'classification' ? 'classification_failed' : 'website_lookup_failed'
    try { step('failed', { stage, reason }) } catch (_) {}
    return answer(stage === 'classification' ? t('website.classificationFailed') : t('website.failed'))
  }
}
module.exports = { runWebsiteFlow, candidate, publicUrl }
