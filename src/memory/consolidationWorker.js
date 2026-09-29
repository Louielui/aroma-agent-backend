'use strict'
const fs = require('node:fs'), path = require('node:path')
const { eligible } = require('./consolidationPolicy')
const { OWNER } = require('./governed')
function createWorker({ gateway, dir, allowed, clock = Date.now }) {
  let busy = false, lastError = null
  const file = path.join(dir, 'settings.json')
  function enabled() {
    try { return JSON.parse(fs.readFileSync(file,'utf8')).enabled === true }
    catch (e) { if(e.code === 'ENOENT') return true; throw Error('consolidation_setting_unavailable') }
  }
  function configure(value) {
    if (typeof value !== 'boolean') throw Error('invalid_request')
    fs.mkdirSync(dir,{recursive:true}); const temp=file+'.tmp'
    fs.writeFileSync(temp,JSON.stringify({enabled:value}),{mode:0o600}); fs.renameSync(temp,file)
    return { enabled:value }
  }
  async function tick() {
    if (busy) return
    busy=true
    try {
      if (!allowed() || !enabled()) return
      const rows=await gateway.list(OWNER)
      if(rows.filter(r=>r.status==='candidate'&&r.source.kind==='consolidation').length>=20)return
      const now=clock()
      const last=Math.max(0,...rows.map(r=>Date.parse(r.details.consolidation?.checkedAt)||0))
      if(now-last<60000)return
      const source=rows.filter(eligible).filter(r=>{
        const c=r.details.consolidation
        return !c || (c.state==='running'&&now-Date.parse(c.checkedAt)>180000) ||
          (c.state==='failed'&&c.attempts<3&&c.nextRetryAt&&Date.parse(c.nextRetryAt)<=now)
      }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
      if(source)await gateway.consolidate(OWNER,source.id)
      lastError=null
    } catch (_) { lastError='consolidation_unavailable' }
    finally { busy=false }
  }
  return { tick, configure, status:()=>({enabled:enabled(),captureEnabled:allowed(),busy,error:lastError,intervalSeconds:60,reviewLimit:20}) }
}
module.exports={createWorker}
