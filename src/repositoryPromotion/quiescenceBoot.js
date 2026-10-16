'use strict'
const fs=require('node:fs'),path=require('node:path')
function assertStartup(role){
 const file=path.join('C:/Aroma/aroma-agent-backend/data/.deployment-quiescence','host.json')
 const runtime=globalThis[Symbol.for('aroma.deploymentQuiescence.runtime')]
 if(runtime){if(runtime.participant!==role)throw Error('deployment_role_changed');return runtime}
 try{fs.lstatSync(file)}catch(e){if(e.code==='ENOENT')return null;throw Error('deployment_interlock_unavailable')}
 throw Error('deployment_interlock_required')
}
module.exports={assertStartup}
