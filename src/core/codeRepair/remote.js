'use strict'
const {localRequest}=require('../../adapters/CodexSubscriptionAdapter'),{SOURCE_REVISION}=require('./workspace')
function createRemoteRepair({bootCommit,diagnosis,env=process.env,request=input=>localRequest('/code-repair',input,env)}){
 return {async start(actor,input){if(actor?.id!=='owner'||actor.role!=='owner')throw Error('permission_denied');if(env.READ_ACCESS!=='on')throw Error('read_access_disabled')
  let selected
  for(const row of diagnosis.list(actor)){if(row.state!=='completed')continue;const run=diagnosis.get(actor,row.id);if(run?.evidence?.revision===SOURCE_REVISION){selected=row.id;break}}
  if(!selected)throw Error('unsupported_diagnosis')
  const value=await request({op:'prepare',diagnosisId:selected,requestId:input.requestId,bootCommit});if(value.error||!value.run)throw Error(value.error||'workflow_unavailable');return value.run
 }}
}
module.exports={createRemoteRepair}
