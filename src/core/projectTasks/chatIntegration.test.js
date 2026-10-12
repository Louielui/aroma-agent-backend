'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto')
const {CHAT_FILES,CHAT_DEPENDENCIES,BROWSER_TEST}=require('./chatProfile'),{createTasks}=require('./service'),{createRegistry}=require('./contract'),{createMemoryRunStore}=require('../operating/runStore')
const {createSource}=require('../projectWork/source'),{createProjectWork}=require('../projectWork/service'),{createRepository}=require('../projectWork/adoptionRepository'),{validateAccepted,createAdoption}=require('../projectWork/adoption')
const {createIsolatedCoding}=require('../../workers/execution/isolatedCoding'),{digest,validatePackage}=require('../../workers/execution/windowsSandbox')
const OWNER={id:'owner',role:'owner'},CSS=CHAT_FILES[2]
test('chat task retains fixed browser tests and dependencies through approved coding, adoption and rollback',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chat-task-')),git=a=>execFileSync('git',['-C',root,'-c','core.hooksPath=','-c','commit.gpgsign=false',...a],{encoding:'utf8',windowsHide:true})
 t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());fs.rmSync(root,{recursive:true,force:true})})
 git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);git(['config','core.autocrlf','false'])
 const files=Object.fromEntries([...CHAT_FILES,...CHAT_DEPENDENCIES].map(n=>[n,fs.readFileSync(path.join(__dirname,'../../..',n),'utf8').replace(/\r\n/g,'\n')]))
 const before=files[CSS],after=before+'\n#chat-level { min-height:44px; }\n'
 for(const [n,s]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,n)),{recursive:true});fs.writeFileSync(path.join(root,n),s)}
 fs.writeFileSync(path.join(root,'outside.txt'),'preserve');git(['add','.']);git(['commit','-qm','fixture']);const head=()=>git(['rev-parse','HEAD']).trim();let boot=head()
 const taskStore=createMemoryRunStore(),workStore=createMemoryRunStore(),registry=createRegistry(taskStore),health=async()=>({status:'ok',bootCommit:boot}),source=createSource({root,health,resolveRecipe:registry.resolve})
 const boundary=Object.fromEntries(['noExternalInterfaces','hostReadDenied','hostWriteDenied','readonlyInputDenied','readonlyToolsDenied','loopbackDenied','ipv6LoopbackDenied','internetDenied','cleanIdentity','secretsAbsent'].map(k=>[k,true]))
 const browser=['zh','en'].flatMap(locale=>[1280,390].map(width=>({name:`browser-${locale}-${width}.png`,engine:'edge-headless-offline-v1',browserVersion:'Edg/154.0',locale,width,height:900,failedReads:locale==='zh'&&width===390,pageHash:'a'.repeat(64),screenshotHash:'b'.repeat(64),screenshotBytes:2000,checks:Object.fromEntries(['startup','labels','fiveDepths','mediumDefault','solDefault','layout','keyboard','picker','chatScope','explicitConfirmation','noPageErrors','onlyFixtureRequests'].map(k=>[k,true])),routes:['/demo']})))
 // Deterministic executor/model fixtures; actual OS/browser acceptance is separate.
 const receipt=passed=>({total:7,passed,failed:7-passed,skipped:0,cancelled:0,exitCode:passed===7?0:1,engine:'windows-sandbox-offline-v1',boundary,browser})
 const packs=[],executor={isBusy:()=>false,readiness:async()=>({ready:true}),run:async p=>{validatePackage(p);packs.push(structuredClone(p));return receipt(p.files[CSS]===after?7:6)}}
 let isolated,calls=0
 const coder=createIsolatedCoding({root:path.join(root,'receipts'),executor,provider:{preflight:async()=>{},complete:async()=>{calls++;return{model:'gpt-6.1-sol',billing:'chatgpt-subscription',text:JSON.stringify({changes:[{file:CSS,content:after}],summary:'Accessible composer'})}}}})
 const providers={isolation:executor.readiness,status:async()=>({codex:{ready:true},claude:{ready:true}}),codeOrder:async({order})=>{isolated=await coder.execute({actor:'owner',approval:coder.prepare(order,'owner')});return{...isolated,execution:'windows_sandbox_offline',changedFiles:[CSS],isolatedRunId:isolated.id}},reviewOrder:async packet=>({verdict:'pass',billing:'claude-subscription',visual:{verdict:'pass',summary:'Fixture visual receipt',findings:[],inspected:browser.map(p=>p.name),screenshots:browser.map(p=>({name:p.name,screenshotHash:p.screenshotHash})),design:packet.design,patchHash:packet.patchHash,model:'gpt-6.1-sol',billing:'chatgpt-subscription',reviewedAt:new Date().toISOString()}})}
 const work=createProjectWork({source,providers,store:workStore,enabled:()=>true,resolveRecipe:registry.resolve,catalogueRecipes:registry.catalogue})
 const generated={expectedTests:3,testCode:"const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const read=n=>fs.readFileSync(require('node:path').join(__dirname,'../src/demo/assets',n),'utf8');test('target size',()=>assert.match(read('app.css'),/#chat-level \\{ min-height:44px; \\}/));test('HTML control',()=>assert.match(read('index.html'),/id=\"chat-level\"/));test('JS default',()=>assert.match(read('app.js'),/gpt-6.1-sol/));"}
 const tasks=createTasks({store:taskStore,enabled:()=>true,sourceFor:d=>createSource({root,health,resolveRecipe:()=>d}),provider:{preflight:async()=>({model:'gpt-6.1-sol',billing:'chatgpt-subscription'}),complete:async(_,o)=>{assert.match(o.system,/chat page/);return{model:'gpt-6.1-sol',billing:'chatgpt-subscription',text:JSON.stringify(generated)}}},review:async()=>({verdict:'pass',billing:'claude-subscription'}),prepareWork:i=>work.prepare(OWNER,i)})
 const started=tasks.start(OWNER,{bootCommit:boot,requestId:randomUUID(),goal:'Accessible chat depth control',criteria:['The depth control has a 44px minimum height'],editable:[CSS]});await tasks.settled();const v=tasks.get(OWNER,started.run.id);assert.equal(v.run.state,'awaiting_approval');assert.equal(calls,0)
 const ticket=a=>({id:a.id,hash:a.hash,nonce:a.nonce})
 await tasks.approve(OWNER,ticket(v.approval));const p=await tasks.prepare(OWNER,{id:v.run.id,requestId:randomUUID()});assert.equal(calls,0);work.approve(OWNER,ticket(p.work.approval));await work.settled();const r=work.get(OWNER,p.work.run.id);assert.equal(r.state,'completed');assert.equal(calls,1)
 const accepted=validateAccepted(r,isolated,registry.resolve)
 assert.equal(packs.length,2);assert.equal(packs[0].files[BROWSER_TEST],packs[1].files[BROWSER_TEST]);assert.equal(packs[1].expectedTests,7)
 for(const [n,s]of Object.entries(files))if(n!==CSS)assert.equal(accepted.dependencies[n],s)
 const missing=structuredClone(r);delete missing.result.tests.browser;assert.throws(()=>validateAccepted(missing,isolated,registry.resolve),/accepted_evidence_changed/)
 const unreviewed=structuredClone(r);delete unreviewed.review.visual;assert.throws(()=>validateAccepted(unreviewed,isolated,registry.resolve),/accepted_evidence_changed/)
 const adoption=createAdoption({source,repository:{apply:async()=>assert.fail('Missing browser evidence must not write')},executor:{isBusy:()=>false,run:async()=>({...receipt(7),browser:[]})},work:{get:()=>r},isolated:async()=>isolated,store:createMemoryRunStore(),loader:async()=>{},enabled:()=>true,resolveRecipe:registry.resolve})
 const a=await adoption.prepare(OWNER,{action:'adopt',runId:r.id,requestId:randomUUID(),bootCommit:boot});adoption.approve(OWNER,ticket(a.approval));await adoption.settled();assert.equal(adoption.get(OWNER,a.run.id).reason,'acceptance_failed')
 fs.writeFileSync(path.join(root,'outside.txt'),'pending outside');const repository=createRepository({root,source,resolveRecipe:registry.resolve}),recipe=r.workOrder.recipe
 const change=await repository.apply({snapshot:await source.read(boot,undefined,recipe),before:accepted.before,after:accepted.after,id:randomUUID(),action:'adopt'});boot=head();await repository.verifyLoaded({source:r.source,commit:boot,after:accepted.after,change})
 await repository.apply({snapshot:await source.read(boot,undefined,recipe),before:accepted.after,after:accepted.before,id:randomUUID(),action:'rollback'});boot=head()
 assert.equal(fs.readFileSync(path.join(root,CSS),'utf8'),before);assert.equal(fs.readFileSync(path.join(root,'outside.txt'),'utf8'),'pending outside')
 for(const [n,s]of Object.entries(accepted.dependencies))assert.equal(fs.readFileSync(path.join(root,n),'utf8'),s)
})
