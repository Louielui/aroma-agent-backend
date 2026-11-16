'use strict'
// Reviewed source configuration only, never an intake/model/caller option.
// It authorizes a closed control connection, not inference or any usage grant.
function apply(env,profile){
 const value=env.XIANGXIANG_CONTROLLED_DISPATCH
 if(value!==undefined&&!['on','off'].includes(value))throw Error('controlled_dispatch_configuration_invalid')
 if(profile.controlledDispatch==='owner_scoped_subscription'&&value===undefined)env.XIANGXIANG_CONTROLLED_DISPATCH='on'
 if(env.XIANGXIANG_LOCAL_CODING!==undefined&&!['on','off'].includes(env.XIANGXIANG_LOCAL_CODING))throw Error('local_coding_configuration_invalid')
 if(profile.localCoding==='registered_node_v1'&&env.XIANGXIANG_LOCAL_CODING===undefined)env.XIANGXIANG_LOCAL_CODING='on'
 return env
}
module.exports={apply}
