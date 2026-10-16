'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),{randomUUID,createHash}=require('node:crypto')
const http=require('node:http'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..'),psQuote=s=>"'"+s.replace(/'/g,"''")+"'"
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
function buildPackage(){
 const dir=fs.mkdtempSync(path.join(process.env.AROMA_ARTIFACT_DIR||os.tmpdir(),'e1-package-')),repo=path.join(dir,'repo'),installer=path.join(root,'scripts/browser/install-read-host.ps1'),source=fs.readFileSync(installer,'utf8')
 const names=source.match(/\$browserNames=@\(([^\r\n]+)\)/)[1].match(/'([^']+)'/g).map(s=>s.slice(1,-1))
 fs.mkdirSync(repo);for(const name of names){const dest=path.join(repo,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,name),dest)}
 const git=args=>cp.execFileSync('git',['-c','core.hooksPath=','-c','core.autocrlf=false','-c','user.name=Offline Fixture','-c','user.email=fixture@example.test',...args],{cwd:repo,windowsHide:true,stdio:'pipe'})
 git(['init']);git(['config','core.autocrlf','false']);git(['remote','add','origin','https://github.com/Louielui/aroma-agent-backend.git']);git(['add','.']);git(['commit','-m','Synthetic Native Host package fixture'])
 // Execute the real installer body, including its Git checks, C# compilation,
 // hashes, manifest and receipt. Rebind only its three fixed path assignments
 // in this test copy. PrepareOnly prevents registry writes and publication.
 const wrapper=path.join(dir,'build.ps1'),releaseRoot=path.join(dir,'packages'),script=path.join(dir,'installer.ps1')
 fs.writeFileSync(wrapper,`$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$text=[IO.File]::ReadAllText(${psQuote(installer)})
$ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'InstallerParseFailed'}
$replacements=@{'$browserRepo'=${psQuote(repo)};'$browserRoot'=${psQuote(releaseRoot)};'$browserNode'=${psQuote(process.execPath)}}
$nodes=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $replacements.ContainsKey($n.Left.Extent.Text)},$true))
if($nodes.Count -ne 3){throw 'InstallerFixtureRebindingChanged'}
foreach($n in ($nodes | Sort-Object {$_.Extent.StartOffset} -Descending)){
 $value=$replacements[$n.Left.Extent.Text].Replace("'","''")
 $text=$text.Substring(0,$n.Extent.StartOffset)+$n.Left.Extent.Text+"='"+$value+"'"+$text.Substring($n.Extent.EndOffset)
}
[IO.File]::WriteAllText(${psQuote(script)},$text,(New-Object Text.UTF8Encoding($false)))
& ${psQuote(script)} -PrepareOnly
`)
 const env=isolatedEnv();delete env.PSModulePath
 const result=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',wrapper],{env,windowsHide:true,encoding:'utf8',timeout:60000});assert.equal(result.status,0,result.stderr)
 const receipt=JSON.parse(result.stdout),pkg=path.dirname(receipt.hostManifest);assert.equal(receipt.preparedOnly,true);assert.equal(receipt.registrationVerified,undefined);assert.equal(receipt.managedExtensionPath,undefined);assert.ok(pkg.startsWith(releaseRoot+path.sep));assert.ok(fs.existsSync(path.join(pkg,'ImagineBrowserReadHost.exe')));assert.ok(fs.existsSync(path.join(pkg,'ImagineBrowserInput.exe')))
 for(const [name,hash]of Object.entries(receipt.hashes)){const file=path.join(name==='manifest.json'||name==='release.js'||name.startsWith('sidepanel.')||['worker.js','collector.js','operator.js','operator-panel.js'].includes(name)?receipt.extensionPath:pkg,name);assert.equal(sha(fs.readFileSync(file)),hash,name)}
 return {dir,pkg,receipt,installerHash:sha(Buffer.from(source))}
}
function isolatedEnv(){const env={...process.env};delete env.NODE_PATH;delete env.NODE_OPTIONS;delete env.HUB_TOKEN;delete env.CODEX_CHAT_BRIDGE_TOKEN;return env}
function runInPackage(pkg,script){return cp.spawnSync(process.execPath,['-e',script],{cwd:pkg,env:isolatedEnv(),windowsHide:true,encoding:'utf8',timeout:15000})}
test('actual offline Native Host package resolves E1 and legacy requests without repository dependencies',async t=>{
 if(process.platform!=='win32'){t.diagnostic('Actual installer and native executables require Windows.');return}
 const f=buildPackage(),source={url:'https://mail.google.com/mail/u/0/',tabId:10,windowId:20,documentId:'synthetic-gmail',frameId:0,capturedAt:new Date().toISOString(),contentHash:sha('Synthetic message only'),truncated:false,gmail:{kind:'gmail_message',accountEmail:'chef@example.test',messageId:'abc123',threadId:'def456',routeToken:'FMfcgSyntheticMessage'}}
 t.diagnostic('offline_package='+f.pkg+'; installer_sha256='+f.installerHash)
 await t.test('packaged Gmail contract and broker accept only the verified fixed request shape',()=>{
  const body={op:'prepare',requestId:randomUUID(),question:'Reply to this email',source,taskVersion:3},result=runInPackage(f.pkg,`const assert=require('node:assert/strict');const b=${JSON.stringify(body)};const calls=[];const broker=require('./nativeHost.cjs').createBroker({request:async x=>{calls.push(x);return x}});(async()=>{assert.deepEqual(await broker(b),b);const old={...b,source:{...b.source},taskVersion:2};delete old.source.gmail;assert.deepEqual(await broker(old),old);await assert.rejects(broker({...b,source:{...b.source,gmail:{...b.source.gmail,threadId:null}}}),/invalid_source/);assert.equal(calls.length,2);console.log('packaged_E1_and_legacy_verified')})().catch(e=>{console.error(e.code||e.message);process.exitCode=1})`)
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/packaged_E1_and_legacy_verified/)
 })
 await t.test('packaged local dependencies resolve in place and backend-only Express remains lazy',()=>{
  const result=runInPackage(f.pkg,`const fs=require('node:fs'),path=require('node:path'),{builtinModules}=require('node:module'),assert=require('node:assert/strict'),external=[];for(const name of fs.readdirSync('.').filter(n=>/\\.(?:cjs|js)$/.test(n))){for(const m of fs.readFileSync(name,'utf8').matchAll(/require\\(['"]([^'"]+)['"]\\)/g)){if(m[1].startsWith('.')){const resolved=require.resolve(path.resolve(m[1]));assert.ok(resolved.startsWith(process.cwd()+path.sep),name+':'+m[1])}else if(!builtinModules.includes(m[1])&&!m[1].startsWith('node:'))external.push(name+':'+m[1])}require('./'+name)}assert.deepEqual(external,['clientUpdate.js:express']);console.log('dependency_closure_verified')`)
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/dependency_closure_verified/)
 })
 await t.test('actual Browser worker crosses compiled Native Host to a synthetic Backend and prepares an unsaved Gmail reply',async()=>{
  const backend=require('./gmailReplyFixtures.cjs').fixture(),requests=[],server=http.createServer(async(q,s)=>{try{assert.equal(q.url,'/api/v1/browser-read');assert.equal(q.method,'POST');assert.equal(q.headers.authorization,'Bearer offline-fixture-token');let bytes='';for await(const chunk of q)bytes+=chunk;const body=JSON.parse(bytes);requests.push(body);s.setHeader('content-type','application/json');s.end(JSON.stringify(await backend.service.handle(body)))}catch(e){s.statusCode=409;s.end(JSON.stringify({error:'synthetic_backend_refused'}))}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  const preload=path.join(f.dir,'offline-transport.cjs'),target='http://127.0.0.1:'+server.address().port
  fs.writeFileSync(preload,`const assert=require('node:assert/strict'),cp=require('node:child_process'),Module=require('node:module');const originalLoad=Module._load;Module._load=function(name,...args){if(name==='express')throw Error('backend_only_dependency_in_native_path');return originalLoad.call(this,name,...args)};cp.execFileSync=(exe,args)=>{assert.ok(exe.endsWith('powershell.exe'));assert.deepEqual(args,['-NoProfile','-NonInteractive','-Command',"[Environment]::GetEnvironmentVariable('HUB_TOKEN','User')"]);return 'offline-fixture-token'};const originalFetch=fetch;global.fetch=(url,options)=>{assert.equal(url,'http://127.0.0.1:8090/api/v1/browser-read');return originalFetch(${JSON.stringify(target)}+'/api/v1/browser-read',options)};`)
  const child=cp.spawn(path.join(f.pkg,'ImagineBrowserReadHost.exe'),['chrome-extension://'+f.receipt.extensionId+'/'],{cwd:f.pkg,env:{...isolatedEnv(),NODE_OPTIONS:'--require '+JSON.stringify(preload)},windowsHide:true,stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',b=>{stderr+=b});child.stdin.on('error',()=>{})
  const protocol=require(path.join(f.pkg,'nativeProtocol.js')),listeners={},storage={get:async()=>({}),set:async()=>{},remove:async()=>{}},port={onMessage:{addListener:fn=>{port.receive=fn}},onDisconnect:{addListener:fn=>{port.lost=fn}},postMessage:m=>child.stdin.write(protocol.encode(m)),disconnect:()=>child.stdin.end()}
  child.stdout.on('data',protocol.createReader(value=>port.receive?.(value),()=>{throw Error('invalid_fixture_native_frame')}))
  const chrome={action:{onClicked:{addListener:()=>{}}},sidePanel:{setPanelBehavior:async()=>{},setOptions:async()=>{},open:async()=>{}},storage:{local:storage,session:storage},tabs:{get:async()=>({id:10,windowId:20,url:source.url}),query:async()=>[{id:10,windowId:20,url:source.url}],onActivated:{addListener:()=>{}},onAttached:{addListener:()=>{}},onUpdated:{addListener:()=>{}},onRemoved:{addListener:()=>{}}},scripting:{executeScript:async()=>[{frameId:0,documentId:source.documentId,result:{url:source.url,title:'Synthetic Gmail',text:backend.text,truncated:false,gmail:source.gmail}}]},runtime:{id:f.receipt.extensionId,getURL:name=>'chrome-extension://'+f.receipt.extensionId+'/'+name,onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}},onMessage:{addListener:fn=>{listeners.message=fn}},connectNative:()=>port}}
  const timers=new Set(),context=vm.createContext({chrome,URL,crypto:require('node:crypto').webcrypto,TextEncoder,importScripts:()=>{},collectVisiblePage:()=>{},setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);timers.add(id);return id},clearTimeout:id=>{clearTimeout(id);timers.delete(id)}});vm.runInContext(fs.readFileSync(path.join(f.receipt.extensionPath,'worker.js'),'utf8'),context)
  const send=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture_worker_timeout')),10000);listeners.message(message,{id:chrome.runtime.id,url:chrome.runtime.getURL('sidepanel.html')+'?tabId=10&windowId=20'},r=>{clearTimeout(timer);resolve(r)})})
  try{
   const captured=await send({type:'capture',windowId:20});assert.equal(captured.error,undefined);assert.equal(captured.result.source.gmail.messageId,'abc123')
   const prepared=await send({type:'rpc',body:{op:'prepare',requestId:randomUUID(),question:'Reply to this email',source:captured.result.source,taskVersion:3}});assert.equal(prepared.error,undefined,stderr);assert.equal(prepared.result.state,'awaiting_consent');assert.equal(backend.calls.length,0)
   const done=await send({type:'rpc',body:{op:'read',id:prepared.result.id,consent:true,source:captured.result.source,text:backend.text}});assert.equal(done.error,undefined,stderr);assert.equal(done.result.result.taskEvidence.gmailDraftCreated,false);assert.equal(done.result.result.taskEvidence.sent,false);assert.equal(done.result.result.taskEvidence.previewPrepared,true);assert.match(done.result.result.text,/reply@example.test/);assert.deepEqual(backend.calls,['message','thread']);assert.equal(backend.models.length,1);assert.deepEqual(requests.map(r=>r.op),['prepare','read']);assert.deepEqual(requests[0].source.gmail,source.gmail)
  }finally{
   for(const timer of timers)clearTimeout(timer);child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve()},3000);child.once('close',()=>{clearTimeout(timer);resolve()})});await new Promise(resolve=>server.close(resolve))
  }
 })
 await t.test('missing pinned dependency is refused by the actual compiled launcher before broker startup',()=>{
  const file=path.join(f.pkg,'contract.js');fs.renameSync(file,file+'.fixture-missing');try{const result=cp.spawnSync(path.join(f.pkg,'ImagineBrowserReadHost.exe'),['chrome-extension://'+f.receipt.extensionId+'/'],{env:isolatedEnv(),windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(result.status,3);assert.equal(result.stdout,'')}finally{fs.renameSync(file+'.fixture-missing',file)}
 })
 await t.test('package loading check detects an absent transitive module instead of falling back to repository code',()=>{
  const file=path.join(f.pkg,'contract.js'),saved=fs.readFileSync(file);try{fs.appendFileSync(file,"\nrequire('./missing-e1-fixture.cjs')\n");const result=runInPackage(f.pkg,"require('./nativeHost.cjs')");assert.equal(result.status,1);assert.match(result.stderr,/MODULE_NOT_FOUND/);assert.match(result.stderr,/missing-e1-fixture/)}finally{fs.writeFileSync(file,saved)}
 })
})
