'use strict'
// Copy with bundle.cjs to an external content-addressed directory. Both the new
// entry and old rollback entry are arguments in the Owner-pinned host record;
// no product code executes before this independent interlock.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
function main([configuration,expectedHash,role,...entryArguments]){
 const raw=fs.readFileSync(path.join(__dirname,'manifest.json')),manifest=JSON.parse(raw)
 if(hash(raw)!==path.basename(__dirname))throw Error('bundle_manifest_changed')
 for(const pin of manifest.files){const file=path.join(__dirname,pin.file),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||hash(fs.readFileSync(file))!==pin.sha256)throw Error('bundle_source_changed')}
 const bytes=fs.readFileSync(configuration)
 if(hash(bytes)!==expectedHash)throw Error('host_configuration_changed')
 const config=JSON.parse(bytes)
 if(config.bundleDigest!==hash(raw)||!['backend','bridge','native'].includes(role)||!path.isAbsolute(config.entries?.[role]||'')||!path.isAbsolute(config.directory||'')||!Array.isArray(config.participants)||!['backend','bridge','native','external-memory'].every(p=>config.participants.includes(p)))throw Error('host_configuration_invalid')
 function serviceToken(){
  const key=role==='bridge'?'CODEX_CHAT_BRIDGE_TOKEN':'HUB_TOKEN'
  if(process.env[key])return process.env[key]
  if(!path.isAbsolute(config.environmentFile||''))return null
  const values=fs.readFileSync(config.environmentFile,'utf8').split(/\r?\n/).map(line=>line.match(new RegExp('^\\s*'+key+'\\s*=\\s*["\x27]?([a-f0-9]{64})["\x27]?\\s*(?:#.*)?$'))).filter(Boolean)
  return values.length===1?values[0][1]:null
 }
 const host=require('./src/repositoryPromotion/quiescenceHost')
 let timer
 const attempt=()=>{
  const result=host.launch({directory:config.directory,participants:config.participants,participant:role,ownerPassword:()=>null,entry:config.entries[role],entryArguments,serviceToken,park:state=>({parked:true,...state})})
  if(result.parked){if(!timer){process.stderr.write('[QUIESCENCE] '+role+' parked before application import.\n');timer=setInterval(attempt,1000)}return}
  if(timer){clearInterval(timer);timer=null}
  result.started.catch(()=>{process.stderr.write('[QUIESCENCE] startup refused.\n');process.exitCode=1})
 }
 attempt()
}
if(require.main===module){try{main(process.argv.slice(2))}catch(_){process.stderr.write('[QUIESCENCE] invalid or unavailable host interlock.\n');process.exitCode=1}}
module.exports={main}
