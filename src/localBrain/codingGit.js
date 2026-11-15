'use strict'
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{validatePackage}=require('../workers/execution/windowsSandbox')
function destination(directory){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('candidate_directory_unavailable')
  const absolute=path.resolve(directory)
  for(let p=absolute;;p=path.dirname(p)){
    if(fs.existsSync(p)){
      const stat=fs.lstatSync(p)
      if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(p).toLowerCase()!==p.toLowerCase())throw Error('candidate_directory_unavailable')
    }
    if(path.dirname(p)===p)break
  }
  return absolute
}
function retainCandidate({directory,order,changes}){
  validatePackage(order)
  directory=destination(directory)
  if(fs.existsSync(directory)||!Array.isArray(changes)||!changes.length)throw Error('candidate_directory_unavailable')
  const files={...order.files}
  for(const c of changes){if(!order.editable.includes(c.file)||c.before!==files[c.file]||typeof c.after!=='string')throw Error('candidate_scope_changed');files[c.file]=c.after}
  validatePackage({...order,files})
  fs.mkdirSync(directory,{recursive:true});const empty=path.join(directory,'empty-hooks');fs.mkdirSync(empty)
  const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'}
  const git=args=>cp.execFileSync('git',['-c','core.hooksPath='+empty,'-c','core.autocrlf=false',...args],{cwd:directory,env,encoding:'utf8',windowsHide:true,timeout:15000,stdio:['ignore','pipe','pipe']}).trim()
  function write(data){for(const [name,text]of Object.entries(data)){const target=path.join(directory,...name.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text)}}
  git(['init','--template='+empty]);write(order.files);git(['add','--',...Object.keys(order.files)]);git(['-c','user.name=Xiangxiang isolated candidate','-c','user.email=offline@example.invalid','commit','-m','Preserve synthetic original source']);const original=git(['rev-parse','HEAD'])
  write(files);git(['add','--',...order.editable]);git(['-c','user.name=Xiangxiang isolated candidate','-c','user.email=offline@example.invalid','commit','-m','Retain tested local candidate; not deployed']);const candidate=git(['rev-parse','HEAD'])
  if(git(['remote'])||git(['status','--porcelain']))throw Error('candidate_git_unconfirmed')
  const changed=git(['diff','--name-only',original,candidate]).split('\n');if(changed.some(n=>!order.editable.includes(n)))throw Error('candidate_scope_changed')
  return{directory,original,candidate,changed,remotes:[],appliedToLive:false,restore:'Use the original commit only inside this disposable repository; never apply it to a production repository.'}
}
module.exports={retainCandidate}
