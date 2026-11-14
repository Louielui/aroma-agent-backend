'use strict'
function assertLocalRecovery(repository,row){
 const file='src/localBrain/deploymentProfile.json'
 function mode(commit){
  if(!repository.git(['ls-tree',commit,'--',file]).trim())return 'cloud'
  const value=JSON.parse(repository.git(['show',commit+':'+file]))
  if(!['local','cloud'].includes(value.mode))throw Error('local_recovery_profile_unconfirmed')
  return value.mode
 }
 if(mode(row.committed.commit)==='local'&&mode(row.runtimeSnapshot.head)!=='local')throw Error('local_cloud_recovery_requires_owner')
}
module.exports={assertLocalRecovery}
