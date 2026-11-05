'use strict'
const { exclusionReason } = require('./capturePolicy')
const textOf=r=>typeof r?.text==='string'?r.text:typeof r?.content==='string'?r.content:''
function anchor(messages){
  if(!Array.isArray(messages)||messages.length<2)return {state:'unavailable'}
  const pair=messages.slice(-2)
  if(pair[0]?.role!=='user'||pair[1]?.role!=='assistant')return {state:'unavailable'}
  if(pair.some(r=>!textOf(r)||exclusionReason(textOf(r))))return {state:'excluded'}
  if(textOf(pair[0]).length>2000||textOf(pair[1]).length>4000)return {state:'too_large'}
  return {state:'available',beforeMessageCount:messages.length,rows:pair.map(r=>({role:r.role,text:textOf(r)}))}
}
// Canonical context identifies a confirmation's object, never Owner authority.
function precedingExchange(rows, source, current, readConversation) {
  const conversationId = source.details?.conversationId, before = Date.parse(source.source.at)
  if (source.source.kind !== 'conversation' || source.source.attribution !== 'owner_statement' ||
      typeof conversationId !== 'string' || !conversationId || !Number.isFinite(before)) return []
  let previous=source.details.learningAnchor
  if(!previous&&typeof readConversation==='function'){
    // Legacy recovery requires one exact occurrence in the same saved chat.
    // Repeated text is ambiguous; never guess an occurrence or use browser history.
    const messages=readConversation(conversationId)?.messages
    const hits=Array.isArray(messages)?messages.flatMap((r,i)=>r.role==='user'&&textOf(r)===source.text?[i]:[]):[]
    if(hits.length===1)previous=anchor(messages.slice(0,hits[0]))
  }
  if(previous?.state!=='available'||previous.rows?.length!==2)return []
  const owners = rows.filter(r => r.id !== source.id && current(r) && r.scope === source.scope &&
    r.type === 'episodic' && r.source.kind === 'conversation' && r.source.attribution === 'owner_statement' &&
    r.details?.conversationId === conversationId && /:received$/.test(r.source.id) &&
    Number.isFinite(Date.parse(r.source.at)) && Date.parse(r.source.at) < before)
    .sort((a,b) => Date.parse(b.source.at)-Date.parse(a.source.at))
  const prior = owners[0]
  // Never fall back past an incomplete or excluded latest exchange.
  if (!prior || before - Date.parse(prior.source.at) > 30 * 60000 || exclusionReason(prior.text) || prior.text.length > 2000) return []
  const answers = rows.filter(r => current(r) && r.scope === source.scope && r.type === 'episodic' &&
    r.source.kind === 'conversation' && r.source.attribution === 'assistant_claim' &&
    r.source.id === prior.source.id.replace(/:received$/, ':result') &&
    Date.parse(r.source.at) >= Date.parse(prior.source.at) && Date.parse(r.source.at) < before)
  if (answers.length !== 1 || exclusionReason(answers[0].text) || answers[0].text.length > 4000) return []
  if(previous.rows[0].role!=='user'||previous.rows[1].role!=='assistant'||previous.rows[0].text!==prior.text||previous.rows[1].text!==answers[0].text)return []
  return [prior, answers[0]]
}
module.exports = { precedingExchange, anchor }
