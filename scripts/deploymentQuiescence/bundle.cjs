'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const ROOT=path.resolve(__dirname,'../..')
const FILES=Object.freeze(['src/repositoryPromotion/quiescence.js','src/repositoryPromotion/quiescenceRuntime.js','src/repositoryPromotion/quiescenceFence.js','src/repositoryPromotion/quiescenceHost.js','src/repositoryPromotion/checks.js','src/repositoryPromotion/repository.js','src/repositoryPromotion/policy.js','src/governance/ownerAuth.js'])
const digest=b=>crypto.createHash('sha256').update(b).digest('hex')
function createBundle(directory){
 if(!path.isAbsolute(directory))throw Error('absolute_bundle_directory_required')
 const files=[...FILES.map(file=>({file,bytes:fs.readFileSync(path.join(ROOT,file))})),{file:'launch.cjs',bytes:fs.readFileSync(path.join(__dirname,'launch.cjs'))}]
 const manifest=Buffer.from(JSON.stringify({schema:'quiescence-host-bundle-v1',files:files.map(({file,bytes})=>({file,sha256:digest(bytes)}))})+'\n'),sha256=digest(manifest),target=path.join(directory,sha256)
 fs.mkdirSync(target,{recursive:true})
 for(const {file,bytes}of files){const p=path.join(target,file);fs.mkdirSync(path.dirname(p),{recursive:true});if(fs.existsSync(p)){if(digest(fs.readFileSync(p))!==digest(bytes))throw Error('bundle_identity_changed')}else fs.writeFileSync(p,bytes,{flag:'wx'})}
 const file=path.join(target,'manifest.json');if(fs.existsSync(file)){if(digest(fs.readFileSync(file))!==sha256)throw Error('bundle_identity_changed')}else fs.writeFileSync(file,manifest,{flag:'wx'})
 return{directory:target,sha256,launcher:path.join(target,'launch.cjs'),files:JSON.parse(manifest).files}
}
module.exports={createBundle,FILES}
