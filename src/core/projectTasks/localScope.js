'use strict'
// Bound the registered Node package before inference. Source text never selects
// commands, an endpoint, a model or a second repository.
function validateSnapshot(snapshot){
 const files=snapshot?.order?.files
 if(!files||Object.keys(files).length>11||Object.entries(files).some(([name,text])=>typeof text!=='string'||!(/\.(?:js|cjs|json)$/).test(name)||/(?:^|\/)(?:demo|assets|design)(?:\/|$)/.test(name))||Buffer.byteLength(JSON.stringify(files))>24576)throw Error('local_package_limit')
}
module.exports={validateSnapshot}
