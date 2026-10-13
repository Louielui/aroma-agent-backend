'use strict'
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{ID}=require('./contract')
function createStore(dir){
 const get=id=>{if(!ID.test(id||''))throw Error('invalid_request');try{const r=JSON.parse(fs.readFileSync(path.join(dir,id+'.json'),'utf8'));if(r.id!==id||r.workflow!=='browser_context_read'||!Array.isArray(r.timeline))throw Error();return r}catch(e){if(e.code==='ENOENT')return null;throw Error('audit_unavailable')}}
 const all=()=>{try{return fs.readdirSync(dir).filter(n=>n.endsWith('.json')&&ID.test(n.slice(0,-5))).map(n=>get(n.slice(0,-5)))}catch(e){if(e.code==='ENOENT')return [];throw Error('audit_unavailable')}}
 const save=r=>{if(!ID.test(r.id||'')||r.workflow!=='browser_context_read'||Object.hasOwn(r,'text')||Object.hasOwn(r,'prompt'))throw Error('audit_unavailable');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,r.id+'.json'),tmp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(r),{flag:'wx',mode:0o600});fs.renameSync(tmp,file)}catch{try{fs.unlinkSync(tmp)}catch{}throw Error('audit_unavailable')}}
 return{get,all,save}
}
module.exports={createStore}
