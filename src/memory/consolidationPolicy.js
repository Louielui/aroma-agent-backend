'use strict'
const { exclusionReason } = require('./capturePolicy')
const kinds = Object.freeze({ preference: 'preference', decision: 'decision', experience: 'semantic', todo: 'semantic' })
function eligible(row) {
  return Boolean(row && row.status === 'active' && row.type === 'episodic' && row.scope === 'private:owner' &&
    ['owner_statement', 'measured_result'].includes(row.source.attribution) && row.text.length >= 2 && row.text.length <= 12000 && !exclusionReason(row.text))
}
function validate(result, source, existing) {
  const invalid = validationCode => { const error=Error('invalid_consolidation');error.validationCode=validationCode;throw error }
  if (!result || Object.keys(result).some(k => k !== 'candidates') || !Array.isArray(result.candidates) || result.candidates.length > 4) invalid('invalid_result_shape')
  return result.candidates.map(p => {
    if (!p || Object.keys(p).some(k => !['kind','subject','text','reason','quote','supersedes','taskState'].includes(k)) || !Object.hasOwn(kinds, p.kind)) invalid('invalid_candidate_shape')
    for (const [key, max] of [['subject',240],['text',2000],['reason',600],['quote',2000]]) if (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > max) invalid('invalid_candidate_field')
    if (exclusionReason(JSON.stringify(p)) || p.quote.length < 2 || !source.text.includes(p.quote)) invalid('unsupported_quote')
    if (p.kind !== 'experience' && source.source.attribution !== 'owner_statement') invalid('invalid_attribution')
    if (p.kind === 'todo' ? !['open','completed'].includes(p.taskState) : p.taskState !== null) invalid('invalid_task_state')
    if (p.supersedes !== null) {
      const old = existing.find(r => r.id === p.supersedes)
      if (!old || old.type !== kinds[p.kind] || (old.details.category && old.details.category !== p.kind)) invalid('invalid_supersession')
      p = { ...p, subject: old.subject }
    }
    return { ...p, type: kinds[p.kind] }
  })
}
const schema = { type: 'object', additionalProperties: false, required: ['candidates'], properties: { candidates: { type: 'array', maxItems: 4,
  items: { type: 'object', additionalProperties: false, required: ['kind','subject','text','reason','quote','supersedes','taskState'], properties: {
    kind: { type: 'string', enum: Object.keys(kinds) }, subject: { type: 'string', maxLength: 240 }, text: { type: 'string', maxLength: 2000 },
    reason: { type: 'string', maxLength: 600 }, quote: { type: 'string', maxLength: 2000 }, supersedes: { type: ['string','null'] }, taskState: { enum: ['open','completed',null] }
  } } } } }
module.exports = { eligible, validate, schema }
