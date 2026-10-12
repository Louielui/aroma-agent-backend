'use strict'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process')
const {SHA,preflightDecision}=require('./policy')
const REMOTE='https://github.com/Louielui/aroma-agent-backend.git'
const digest=value=>crypto.createHash('sha256').update(value).digest('hex')
function safeGitArgs (args) {
  if(!Array.isArray(args)||args.some(x=>typeof x!=='string'||x.includes('\0')))throw Error('invalid_git_command')
  if(args.includes('--force')||args.includes('-f')||args.some(x=>x.startsWith('--force-with-lease'))||args.includes('reset')||args.includes('clean')||args.includes('-D')||args.includes('--delete')||(args[0]==='update-ref'&&args.includes('-d'))||(args[0]==='stash'&&args.some(x=>['drop','pop','clear'].includes(x))))throw Error('destructive_history_forbidden')
  if(args[0]==='push'&&args.some(x=>x.startsWith('+')||x.startsWith(':')||/:(?:refs\/heads\/)?main$/.test(x)))throw Error('direct_main_push_forbidden')
}
function command (root,args,{input,env,buffer=false,timeout=120000}={}) {
  safeGitArgs(args)
  const childEnv={...process.env}
  for(const key of Object.keys(childEnv))if(/^GIT_/i.test(key))delete childEnv[key]
  Object.assign(childEnv,env||{}, {GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'})
  const value=cp.execFileSync('git',['--no-replace-objects','--no-optional-locks','-c',`safe.directory=${root}`,'-c','core.fsmonitor=false','-c','core.hooksPath=','-C',root,...args],{env:childEnv,input,windowsHide:true,timeout,maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']})
  return buffer?value:value.toString('utf8').trim()
}
function parseStatus (raw) {
  const fields=raw.split('\0'),rows=[]
  for(let i=0;i<fields.length;i++){
    if(!fields[i])continue
    const status=fields[i].slice(0,2),name=fields[i].slice(3)
    if(!name||name.startsWith('/')||name.split('/').includes('..')||name.includes('\\'))throw Error('unsafe_working_path')
    rows.push({status,path:name,...(/[RC]/.test(status)?{originalPath:fields[++i]}:{})})
  }
  return rows
}
function secretPath (p) {return /(^|\/)(?:\.env(?:\.|$)|browser-profile|data|\.aroma|credentials?(?:\.|\/)|password\.txt|[^/]+\.creds$)/i.test(p)}
function scanObjects (root,targets,remoteTips) {
  const rows=command(root,['rev-list','--objects',...targets,'--not',...remoteTips]).split('\n').filter(Boolean)
  if(!rows.length)return{objects:0,blobs:0,findings:[]}
  const names=new Map(rows.map(line=>{const i=line.indexOf(' ');return[i<0?line:line.slice(0,i),i<0?'':line.slice(i+1)]}))
  const bytes=command(root,['cat-file','--batch'],{input:[...names.keys()].join('\n')+'\n',buffer:true})
  const patterns=[['private_key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],['provider_key',/\bsk-(?:(?:proj-|svcacct-)|(?:ant-))?[A-Za-z0-9_-]{32,}\b/],['github_token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],['google_key',/\bAIza[0-9A-Za-z_-]{35}\b/],['aws_key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],['credential_url',/https?:\/\/[^\s/:]{2,}:[^\s/@]{12,}@/]]
  const findings=[];let offset=0,blobs=0
  while(offset<bytes.length){
    const end=bytes.indexOf(10,offset);if(end<0)throw Error('publication_scan_unavailable')
    const [sha,type,sizeText]=bytes.subarray(offset,end).toString().split(' '),size=Number(sizeText)
    if(!Number.isSafeInteger(size)||size<0||end+1+size>=bytes.length)throw Error('publication_scan_unavailable')
    const data=bytes.subarray(end+1,end+1+size);offset=end+size+2
    if(type!=='blob')continue
    blobs++;const name=names.get(sha)||''
    if(secretPath(name))findings.push({sha,path:name,rule:'sensitive_path'})
    const text=data.toString('utf8')
    for(const [rule,pattern]of patterns)if(pattern.test(text))findings.push({sha,path:name,rule})
  }
  return{objects:rows.length,blobs,findings}
}
function createRepository ({root,runtimeRoot=root,artifacts,remote=REMOTE,runtimeReader,privateRefs=[]}) {
  root=path.resolve(root);runtimeRoot=path.resolve(runtimeRoot);artifacts=path.resolve(artifacts)
  if(artifacts===root||artifacts.startsWith(root+path.sep))throw Error('preservation_must_be_external')
  fs.mkdirSync(artifacts,{recursive:true})
  const git=(args,options)=>command(root,args,options)
  const runtimeGit=(args,options)=>command(runtimeRoot,args,options)
  function identity () {
    if(git(['remote','get-url','origin'])!==remote||runtimeGit(['remote','get-url','origin'])!==remote)throw Error('repository_identity_mismatch')
    if(path.resolve(git(['rev-parse','--path-format=absolute','--git-common-dir'])).toLowerCase()!==path.resolve(runtimeGit(['rev-parse','--path-format=absolute','--git-common-dir'])).toLowerCase())throw Error('runtime_repository_mismatch')
  }
  function remoteRefs () {
    const refs=git(['ls-remote','--heads','--tags','origin']).split('\n').filter(Boolean).map(line=>{const[sha,ref]=line.split(/\s+/);return{sha,ref}})
    const tips=[...new Set(refs.filter(r=>r.ref.startsWith('refs/heads/')||r.ref.endsWith('^{}')).map(r=>r.sha))]
    for(const sha of tips){try{git(['cat-file','-e',sha+'^{commit}'])}catch{git(['fetch','--no-tags','origin',sha])}}
    const main=refs.find(r=>r.ref==='refs/heads/main')?.sha
    if(!SHA.test(main||''))throw Error('remote_main_unavailable')
    return{refs,tips,main}
  }
  async function inspect () {
    identity();const remoteState=remoteRefs()
    let tracking;try{tracking=git(['rev-parse','refs/remotes/origin/main'])}catch{}
    if(tracking!==remoteState.main)git(['fetch','--no-tags','origin','refs/heads/main:refs/remotes/origin/main'])
    const head=git(['rev-parse','HEAD']),branch=git(['symbolic-ref','--quiet','--short','HEAD'])
    const [behind,ahead]=git(['rev-list','--left-right','--count',remoteState.main+'...'+head]).split(/\s+/).map(Number)
    const branches=git(['for-each-ref','--format=%(refname) %(objectname)','refs/heads']).split('\n').map(line=>{const[ref,sha]=line.split(' ');return{ref,sha}})
    const publishedCandidates=branches.filter(r=>!privateRefs.includes(r.ref)&&!r.ref.startsWith('refs/heads/backup/private-checkpoint-'))
    const unpublished=git(['rev-list',...publishedCandidates.map(r=>r.sha),'--not',...remoteState.tips]).split('\n').filter(Boolean)
    const dirty=parseStatus(command(root,['status','--porcelain=v1','-z','--untracked-files=all'],{buffer:true}).toString('utf8'))
    const runtimeExpected=runtimeGit(['rev-parse','HEAD'])
    const observed=await runtimeReader()
    const f={branch,head,originMain:remoteState.main,remoteMain:remoteState.main,ahead,behind,unpublished,dirty,branches,remoteRefs:remoteState.refs,remoteTips:remoteState.tips,remoteInventoryComplete:true,runtimeExpected,runtimeObserved:observed.bootCommit,runtime:observed,privateCheckpointRefs:branches.filter(r=>privateRefs.includes(r.ref)||r.ref.startsWith('refs/heads/backup/private-checkpoint-')).map(r=>r.ref)}
    return{...f,...preflightDecision(f)}
  }
  function preserve (inspection,scopeRoot=root) {
    identity();const stamp=new Date().toISOString().replace(/[^0-9]/g,'')+'-'+crypto.randomBytes(3).toString('hex')
    const directory=path.join(artifacts,stamp);fs.mkdirSync(directory)
    const sourceGit=(args,options)=>command(scopeRoot,args,options)
    const head=sourceGit(['rev-parse','HEAD']),originalRefs=git(['for-each-ref','--format=%(refname) %(objectname)']).split('\n')
    const dirty=parseStatus(command(scopeRoot,['status','--porcelain=v1','-z','--untracked-files=all'],{buffer:true}).toString('utf8'))
    const files=[]
    for(const row of dirty){
      if(secretPath(row.path))throw Error('credential_secret_change')
      const full=path.join(scopeRoot,row.path)
      if(!fs.existsSync(full)){files.push({...row,deleted:true,sha256:null});continue}
      const stat=fs.lstatSync(full)
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('unsafe_working_path')
      const bytes=fs.readFileSync(full),target=path.join(directory,'files',row.path)
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes)
      files.push({...row,sha256:digest(bytes),bytes:bytes.length})
    }
    fs.writeFileSync(path.join(directory,'dirty.patch'),sourceGit(['diff','--binary','--no-ext-diff','HEAD'],{buffer:true}))
    let checkpoint=head,checkpointRef=null
    if(dirty.length){
      const env={GIT_INDEX_FILE:path.join(directory,'checkpoint.index')}
      sourceGit(['read-tree',head],{env})
      sourceGit(['add','--',...dirty.map(r=>r.path)],{env})
      checkpoint=sourceGit(['commit-tree',sourceGit(['write-tree'],{env}),'-p',head,'-m','Preserve accounted working files before repository promotion'])
      checkpointRef='refs/heads/backup/private-checkpoint-'+stamp
      sourceGit(['update-ref',checkpointRef,checkpoint,'0000000000000000000000000000000000000000'])
    }
    const bundle=path.join(directory,'repository.bundle');git(['bundle','create',bundle,'--all']);git(['bundle','verify',bundle])
    const live=remoteRefs(),targets=[]
    const refs=inspection.branches || git(['for-each-ref','--format=%(refname) %(objectname)','refs/heads']).split('\n').map(line=>{const[ref,sha]=line.split(' ');return{ref,sha}})
    for(const r of refs){
      if(privateRefs.includes(r.ref)||r.ref.startsWith('refs/heads/backup/private-checkpoint-'))continue
      if(!git(['rev-list','--count',r.sha,'--not',...live.tips])||Number(git(['rev-list','--count',r.sha,'--not',...live.tips]))===0)continue
      if(!targets.some(x=>x.sha===r.sha))targets.push({sha:r.sha,ref:'refs/heads/backup/auto-'+stamp+'-'+r.sha.slice(0,10),originalRef:r.ref})
    }
    const scan=targets.length?scanObjects(root,targets.map(t=>t.sha),live.tips):{objects:0,blobs:0,findings:[]}
    const manifest={version:1,createdAt:new Date().toISOString(),scopeRoot,head,files,originalRefs,checkpoint,checkpointRef,remoteBackups:targets,scan,bundleSha256:digest(fs.readFileSync(bundle))}
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
    if(scan.findings.length)throw Error('publication_scan_blocked')
    if(targets.length)git(['push','--atomic','origin',...targets.map(t=>t.sha+':'+t.ref)])
    const after=remoteRefs()
    if(targets.some(t=>!after.refs.some(r=>r.ref===t.ref&&r.sha===t.sha)))throw Error('remote_preservation_unconfirmed')
    for(const file of files){if(!file.deleted&&digest(fs.readFileSync(path.join(scopeRoot,file.path)))!==file.sha256)throw Error('working_tree_changed')}
    manifest.verified=true;manifest.verifiedAt=new Date().toISOString();manifest.snapshotHash=digest(JSON.stringify(files));manifest.directory=directory
    fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
    return manifest
  }
  function reconcile (f) {
    const id=crypto.randomUUID(),branch='reconcile/auto-'+id,target=path.join(artifacts,'worktree-'+id)
    git(['worktree','add','-b',branch,target,f.head])
    try{command(target,['merge','--no-commit','--no-ff',f.remoteMain])}catch{
      const conflicts=command(target,['diff','--name-only','--diff-filter=U']).split('\n').filter(Boolean)
      return{state:'needs_attention',reason:'material_merge_conflict',branch,worktree:target,conflicts,local:f.head,remote:f.remoteMain}
    }
    return{state:'candidate_ready',branch,worktree:target,local:f.head,remote:f.remoteMain,testsRequired:true,reviewRequired:true}
  }
  return{root,runtimeRoot,artifacts,git,runtimeGit,identity,remoteRefs,inspect,preserve,reconcile}
}
module.exports={REMOTE,digest,command,safeGitArgs,parseStatus,scanObjects,secretPath,createRepository}
