'use strict'
const {BOOT_COMMIT}=require('../../governance/bootCommit')
async function readDispatchStatus({diagnosis,env=process.env,bootCommit=BOOT_COMMIT,health=()=>require('../../actions/executionHealth').readHealth()}={}){
 const transport=await health()
 let capabilities=[],configured=false
 try{capabilities=diagnosis.catalogue({id:'owner',role:'owner'}).workers;configured=capabilities.some(w=>w.capability==='CodeDiagnosis'&&w.version===1)}catch{}
 const sameVersion=typeof bootCommit==='string'&&/^[a-f0-9]{40}$/.test(bootCommit)&&transport.bootCommit===bootCommit
 const reason=env.READ_ACCESS!=='on'?'read_access_disabled':!configured?'capability_unavailable':transport.state!=='ready'?'connection_unconfirmed':!sameVersion?'version_mismatch':null
 const busy=diagnosis?.isActive?.()===true
 return {...transport,transport:{component:'execution-bridge',...transport},backend:{component:'xiangxiang-backend',pid:process.pid,bootCommit},legacyAgentBridge:{enabled:env.AGENT_BRIDGE==='on'},dispatch:{enabled:reason===null,reason,scope:'dispatch-v1',githubRequired:false},capabilities,
  worker:{state:reason?'blocked':busy?'busy':'not_probed',canAccept:reason||busy?false:null,readinessBasis:'subscription_preflight_on_dispatch_only'}}
}
module.exports={readDispatchStatus}
