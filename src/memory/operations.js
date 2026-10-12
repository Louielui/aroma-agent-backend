'use strict'
const { OWNER } = require('./governed')
function createMemoryOperations ({ gateway, runtime, mailMemory, mailHistory, recovery, probe, clock = () => new Date().toISOString() }) {
  const services = probe || (() => require('./serviceHealth').probeMemoryServices())
  const read = async (work, absent) => {
    if (!work) return absent
    try { return await work() } catch (_) { return { state:'unavailable',reason:'read_failed' } }
  }
  async function status () {
    const [health, general, mail, history, backup] = await Promise.all([
      read(services,{state:'not_measured',services:null}),
      read(gateway && (()=>gateway.status(OWNER)),{state:'not_connected'}),
      read(mailMemory && (()=>mailMemory.status()),{state:'not_connected'}),
      read(mailHistory && (()=>mailHistory.status()),{state:'not_started'}),
      read(recovery && (()=>recovery.status()),{state:'not_measured'})
    ])
    let receipts
    try { receipts=runtime?.status() || {enabled:false,pending:null} } catch (_) { receipts={enabled:null,pending:null,error:'read_failed'} }
    return { checkedAt:clock(),state:health.state,services:health.services || null,
      general:general.state==='unavailable' ? {...general,counts:null,index:null,layers:null} : {
        state:general.state || 'ready',counts:general.counts || null,index:general.index || null,layers:general.layers || null,
        consolidation:general.consolidation || null,indexRebuild:general.indexRebuild || null,staleModels:general.staleModels?.length ?? null },
      receipts,mail,history,backup }
  }
  return { status }
}
module.exports={createMemoryOperations}
