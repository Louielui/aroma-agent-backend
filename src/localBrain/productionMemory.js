'use strict'
const path=require('node:path')
function createProductionMemory({store,dir,productionDataDir,adapter,readConversation}){
 if(!store||typeof store.commit!=='function')throw Error('canonical_memory_required')
 const learning=require('./learning').createLearning({dir,adapter,canonicalStore:store,productionDataDir,
  outboxDir:productionDataDir?path.join(productionDataDir,'memory-outbox'):path.join(dir,'memory-outbox'),readConversation})
 return {...learning,store}
}
module.exports={createProductionMemory}
