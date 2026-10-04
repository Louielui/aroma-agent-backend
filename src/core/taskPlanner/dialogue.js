'use strict'
const { hash, PROFILES } = require('./contract')
const { t } = require('../../i18n/t')
const { seal, validContext } = require('./dialogueContext')
const { ID, createMemoryRunStore } = require('../operating/runStore')
const INTENTS = ['discuss', 'refine', 'start', 'draft', 'status', 'cancel', 'other', 'clarify']
const SCHEMA = { type: 'object', additionalProperties: false, required: ['intent', 'profile', 'targetQuote', 'language', 'reply'], properties: {
  intent: { type: 'string', enum: INTENTS }, profile: { type: 'string', enum: ['interface', 'chat', 'none'] }, targetQuote: { type: 'string' }, language: { type: 'string', enum: ['en', 'zh'] }, reply: { type: 'string' }
} }
const { SYSTEM, surface, forbidden } = require('./dialogueIntent')
function createDialogue ({ store, planner, revision, providerFor, receipts = createMemoryRunStore(), timeoutMs = 60000 }) {
  const running = new Map()
  const snapshot = id => store.get(id)
  const fingerprint = c => hash(JSON.stringify(c || null))
  function current (c, id) {
    const last = c?.messages?.at(-1)
    if (last?.role !== 'assistant') return null
    if (validContext(last.planningContext, revision, id)) return last
    // Upgrade an existing server-held advice receipt without trusting browser
    // history. The actual displayed proposal, missing in v1, travels with it.
    const offer = last.planningOffer
    if (require('./continuation').validOffer(offer, revision) && ['interface', 'chat'].includes(offer.profile) && typeof last.content === 'string' && last.content.length <= 4000) {
      return { ...last, planningContext: seal({ version: 1, profile: offer.profile, revision, conversationId: id, createdAt: offer.createdAt, ownerRequests: [offer.message], proposals: [last.content], language: /[\u3400-\u9fff]/u.test(last.content) ? 'zh' : 'en' }) }
    }
    return null
  }
  function candidate (message, conversationId) { return !!surface(message) || !!current(snapshot(conversationId), conversationId) }
  async function handle (actor, input) {
    if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied')
    const { message, conversationId, requestId, effort = 'medium', model = 'gpt-6.1-sol' } = input
    if (typeof message !== 'string' || !message.trim() || message.length > 2000 || !ID.test(requestId || '') || !/^[a-z0-9][a-z0-9-]{7,63}$/.test(conversationId || '')) throw Error('invalid_request')
    const identity = hash(JSON.stringify([conversationId, message, effort, model]))
    const previous = receipts.get(requestId)
    if (previous) {
      if (previous.identity !== identity) throw Error('request_conflict')
      if (previous.response) return structuredClone(previous.response)
      if (previous.state === 'unrelated') return null
      if (running.has(requestId)) return running.get(requestId)
      // An interrupted/uncertain dispatch is read back through its durable job.
      // It must never generate another model call or draft automatically.
      throw Error('request_conflict')
    }
    const before = snapshot(conversationId), last = current(before, conversationId)
    if (!surface(message) && !last) return null
    const receipt = { id: requestId, workflow: 'dialogue_request', steps: [], sections: [], identity, conversationId, state: 'interpreting', startedAt: new Date().toISOString() }
    receipts.save(receipt)
    const work = interpret(); running.set(requestId, work)
    try { return await work } finally { running.delete(requestId) }
    async function interpret () {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
      let abortListener
      try {
        const old = last?.planningContext || null
        let run = last?.taskPlanRunId ? planner.get(actor, last.taskPlanRunId) : null
        if (run && run.conversationId !== conversationId) throw Error('invalid_request')
        const provider = providerFor({ model, effort })
        const pending = provider.complete(JSON.stringify({ currentMessage: message, context: old, recentConversation: (before?.messages || []).slice(-8).map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })), job: run ? { id: run.id, state: run.state, goal: run.result?.goal, questions: run.result?.questions, taskRunId: run.taskRunId || null } : null }), { system: SYSTEM, signal: controller.signal, responseFormat: { type: 'json_schema', name: 'development_dialogue', schema: SCHEMA } })
        const stopped = new Promise((resolve, reject) => { abortListener = () => reject(Error('timed_out')); controller.signal.addEventListener('abort', abortListener, { once: true }) })
        const response = await Promise.race([pending, stopped])
        receipt.interpretationMs = Date.now() - Date.parse(receipt.startedAt)
        if (fingerprint(snapshot(conversationId)) !== fingerprint(before)) throw Error('conversation_changed')
        if (response?.model !== model || response.billing !== 'chatgpt-subscription' || typeof response.text !== 'string' || response.text.length > 20000) throw Error('invalid_worker_result')
        let v; try { v = JSON.parse(response.text) } catch (_) { throw Error('invalid_worker_result') }
        if (!v || Object.keys(v).sort().join() !== Object.keys(SCHEMA.properties).sort().join() || !INTENTS.includes(v.intent) || !['interface', 'chat', 'none'].includes(v.profile) || !['en', 'zh'].includes(v.language) || typeof v.targetQuote !== 'string' || v.targetQuote.length > 2000 || typeof v.reply !== 'string' || v.reply.length > 4000) throw Error('invalid_worker_result')
        let ctx = old ? structuredClone(old) : null
        const quotedProfile = v.targetQuote && message.includes(v.targetQuote) ? surface(v.targetQuote) : null
        const scoped = !forbidden(message) && (old ? v.profile === old.profile && (!v.targetQuote || quotedProfile === old.profile) : quotedProfile && quotedProfile === v.profile)
        let reply, mode = 'chat'
        if (v.intent === 'other') { receipt.state = 'unrelated'; receipts.save(receipt); return null }
        if (v.intent === 'cancel') {
          if (run && ['queued', 'running'].includes(run.state)) planner.cancel(actor, run.id)
          reply = t('dialogue.cancelled', undefined, v.language); ctx = null; run = null
        } else if (!scoped || v.intent === 'clarify') {
          reply = t('dialogue.scope', undefined, v.language); mode = 'ask'; ctx = null; run = null
        } else {
          if (!ctx) ctx = { version: 1, profile: v.profile, revision, conversationId, createdAt: new Date().toISOString(), ownerRequests: [], proposals: [], language: v.language }
          ctx.language = v.language
          if (['discuss', 'refine'].includes(v.intent) || !old) ctx.ownerRequests.push(message)
          if (['discuss', 'refine'].includes(v.intent)) {
            if (!v.reply.trim()) throw Error('invalid_worker_result')
            ctx.proposals.push(v.reply); reply = v.reply; mode = 'recommend'
          }
          if (ctx.ownerRequests.length > 12 || ctx.proposals.length > 12) throw Error('context_limit')
          ctx = seal(ctx)
          const replan = v.intent === 'refine' && run?.state === 'needs_clarification'
          if (v.intent === 'start' || replan) {
            const changed = run?.dialogue && run.dialogue.contextDigest !== ctx.digest
            if (run && !replan && (!changed || ['queued', 'running'].includes(run.state))) reply = t('dialogue.existing', undefined, v.language)
            else {
              const dialogue = { context: ctx, contextDigest: ctx.digest, ownerRequests: ctx.ownerRequests, proposals: ctx.proposals, confirmation: message, language: v.language }
              run = planner.start(actor, { message: ctx.profile === 'interface' ? 'plan Xiangxiang interface from agreed dialogue' : 'plan Xiangxiang chat page from agreed dialogue', conversationId, requestId, effort, dialogue })
              receipt.taskPlanRunId = run.id; receipt.state = 'planning_started'; receipts.save(receipt)
              reply = t('dialogue.started', undefined, v.language)
            }
          } else if (v.intent === 'draft') {
            if (!run || run.state !== 'completed') reply = t('dialogue.planFirst', undefined, v.language)
            else if (run.dialogue?.contextDigest !== ctx.digest) {
              const dialogue = { context: ctx, contextDigest: ctx.digest, ownerRequests: ctx.ownerRequests, proposals: ctx.proposals, confirmation: message, language: v.language }
              run = planner.start(actor, { message: ctx.profile === 'interface' ? 'plan Xiangxiang interface from agreed dialogue' : 'plan Xiangxiang chat page from agreed dialogue', conversationId, requestId, effort, dialogue })
              receipt.taskPlanRunId = run.id; receipt.state = 'planning_started'; receipts.save(receipt)
              reply = t('dialogue.replanning', undefined, v.language)
            } else if (run.taskRunId || run.registrationPreparation) reply = t('dialogue.existing', undefined, v.language)
            else {
              receipt.state = 'draft_requested'; receipt.taskPlanRunId = run.id; receipts.save(receipt)
              await planner.registerTask(actor, { id: run.id, requestId, goal: run.result.goal, criteria: run.result.acceptanceChecks, editable: [...PROFILES[ctx.profile]] })
              reply = t('dialogue.drafted', undefined, v.language)
            }
          } else if (v.intent === 'status') reply = run ? t('dialogue.existing', undefined, v.language) : t('dialogue.notStarted', undefined, v.language)
        }
        const output = { lane: 'chat', mode, reply, ...(run ? { taskPlanRunId: run.id } : {}), historySaved: true, servedBy: ['discuss', 'refine'].includes(v.intent) && mode === 'recommend' ? model : null }
        store.appendTurn({ id: conversationId, userText: message, replyText: reply, servedBy: output.servedBy, taskPlanRunId: run?.id, planningContext: ctx })
        receipt.state = 'completed'; receipt.response = output; receipts.save(receipt)
        return output
      } catch (e) { receipt.state = 'unconfirmed'; receipt.reason = ['invalid_worker_result', 'timed_out', 'conversation_changed', 'worker_busy', 'subscription_limit_reached', 'context_limit'].includes(e.message) ? e.message : 'dialogue_unavailable'; receipts.save(receipt); throw e }
      finally { clearTimeout(timer); if (abortListener) controller.signal.removeEventListener('abort', abortListener) }
    }
  }
  return { handle, candidate }
}
module.exports = { createDialogue, surface, SCHEMA }
