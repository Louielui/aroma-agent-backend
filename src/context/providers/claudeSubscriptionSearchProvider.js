'use strict'
const { localRequest } = require('../../adapters/CodexSubscriptionAdapter')
const { PROVIDER,MODEL,validInput } = require('../../subscription/publicSearch')
const { makeSearchResult,UNAVAILABLE_REASON } = require('./publicSearchProvider')
function createClaudeSubscriptionSearchProvider ({env=process.env,request=localRequest}={}) {
  return {provider:PROVIDER,model:MODEL,readTimeoutMs:120000,async search({query,freshness=null,location=null,replyLanguage=null}){
    const input={query,freshness,location,...(replyLanguage?{replyLanguage}:{})}
    try {
      if(!validInput(input)) throw Error('invalid')
      const out=await request('/public-search',input,env,AbortSignal.timeout(115000))
      if(out?.provider!==PROVIDER || out?.billing!=='claude-subscription' || out?.model!==MODEL || !Number.isFinite(Date.parse(out.retrievedAt)))throw Error('invalid')
      const normalized=makeSearchResult({...out,unavailable:out.status==='unavailable',sourcesSeen:out.status==='live'?1:0})
      return {...normalized,model:MODEL,webSearchCalls:Number.isSafeInteger(out.webSearchCalls)?out.webSearchCalls:0,cache:out.cache || null,
        usage:out.cache==='hit' || out.cache==='shared'?null:require('../../investigation/invocations').projectUsage(out.usage)}
    }catch{return makeSearchResult({provider:PROVIDER,query,retrievedAt:new Date().toISOString(),unavailable:true,reason:UNAVAILABLE_REASON.NETWORK})}
  }}
}
module.exports={createClaudeSubscriptionSearchProvider}
