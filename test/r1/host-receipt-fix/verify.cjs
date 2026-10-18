'use strict'
// Explicit local focused verification, not an application/VM entry point.
// The fixture is materialized from pinned external driver patches by the Owner run.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),vm=require('node:vm')
const root=process.env.R1_HOST_RECEIPT_FIXTURE
assert.ok(root&&path.isAbsolute(root),'explicit disposable receipt fixture required')
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),source=fs.readFileSync(root+'/attempt.cjs','utf8'),before=fs.readFileSync(root+'/attempt.before.cjs','utf8'),lines=source.split('\n')
const loop=lines.find(l=>l.includes("for(const [n,label] of [['guest.cjs','driver-syntax-guest'],['monitorDiagnostics.cjs','driver-syntax-monitor']])"))
assert.ok(loop,'unique deterministic syntax labels are required before any child execution')
const commandLine=lines.find(l=>l.startsWith('async function command(')),saveLine=lines.find(l=>l.startsWith('const hash=')),oldLoop=before.split('\n').find(l=>l.includes("for(const n of ['guest.cjs','monitorDiagnostics.cjs'])"))
const allowedFiles=['guest.cjs','monitorDiagnostics.cjs'].map(n=>path.resolve(root+'/tools/'+n)),children=[],calls=[]
const hostEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>['systemroot','windir','path','temp','tmp'].includes(k.toLowerCase())))
const restrictedCp={execFile(executable,args,options,callback){assert.equal(executable,process.execPath);assert.equal(args.length,2);assert.equal(args[0],'--check');assert.ok(allowedFiles.includes(path.resolve(args[1])));const child=cp.execFile(executable,args,options,callback);children.push(child.pid);return child}}
const context=vm.createContext({fs,path,crypto,cp:restrictedCp,E:root,hostEnv,process:{execPath:process.execPath},setTimeout,clearTimeout,Error,Buffer})
vm.runInContext(saveLine+'\n'+commandLine+'\nglobalThis.receiptSave=save;',context)
const actualCommand=context.command;context.command=async(...args)=>{const result=await actualCommand(...args);calls.push({args,receiptSha256:hash(fs.readFileSync(root+'/'+args[2]+'.json')),result});return result}
const namesBlock=source.slice(source.indexOf('const names=new Set('),source.indexOf('async function canary('))
vm.runInContext(namesBlock+'\nglobalThis.outputNames=[...names];',context)

test('A/B/H — both exact source files execute real Node syntax checks and produce distinct receipts',async()=>{
 await vm.runInContext('(async()=>{'+loop+'})()',context)
 assert.equal(children.length,2);assert.ok(children.every(Number.isInteger));assert.equal(calls.length,2)
 assert.deepEqual(calls.map(x=>x.args[2]),['driver-syntax-guest','driver-syntax-monitor'])
 assert.equal(fs.existsSync(root+'/driver-syntax.json'),false)
 assert.ok(fs.existsSync(root+'/driver-syntax-guest.json'));assert.ok(fs.existsSync(root+'/driver-syntax-monitor.json'))
 fs.writeFileSync(root+'/syntax-command-evidence.json',JSON.stringify({executable:process.execPath,executableSha256:hash(fs.readFileSync(process.execPath)),children,calls,sourceFiles:allowedFiles.map(file=>({file,sha256:hash(fs.readFileSync(file))}))},null,2)+'\n',{flag:'wx'})
})
test('C — each receipt retains exact executable/argv, PID, timing, stdout/stderr and terminal exit 0',()=>{
 for(let i=0;i<2;i++){const label=['driver-syntax-guest','driver-syntax-monitor'][i],r=JSON.parse(fs.readFileSync(root+'/'+label+'.json'));assert.equal(r.executable,process.execPath);assert.deepEqual(r.argv,['--check',root+'/tools/'+['guest.cjs','monitorDiagnostics.cjs'][i]]);assert.equal(r.pid,children[i]);assert.equal(r.exit,0);assert.equal(r.signal,null);assert.equal(r.terminal,true);assert.equal(r.killed,false);assert.equal(r.error,null);assert.equal(typeof r.stdout,'string');assert.equal(typeof r.stderr,'string');assert.ok(Date.parse(r.end)>=Date.parse(r.start))}
})
test('D — completing the monitor syntax check does not overwrite the guest receipt',()=>{
 assert.equal(hash(fs.readFileSync(root+'/driver-syntax-guest.json')),calls[0].receiptSha256)
 assert.equal(hash(fs.readFileSync(root+'/driver-syntax-monitor.json')),calls[1].receiptSha256)
})
test('E — original exclusive writer still rejects duplicate writes without changing bytes',()=>{
 for(const name of ['driver-syntax-guest.json','driver-syntax-monitor.json']){const b=fs.readFileSync(root+'/'+name);assert.throws(()=>context.receiptSave(name,{mustNotReplace:true}),{code:'EEXIST'});assert.deepEqual(fs.readFileSync(root+'/'+name),b)}
})
test('F — immediate Host consumer checks both returned exits; receipts remain Host-local',()=>{
 assert.match(loop,/if\(r\.exit!==0\)throw Error\('driver_syntax'\)/)
 assert.equal(lines.filter(l=>l.includes('driver-syntax')).length,1)
 for(const name of ['driver-syntax-guest.json','driver-syntax-monitor.json'])assert.equal(context.outputNames.includes(name),false)
})
test('G — complete Guest output allowlist and limits are byte-identical; unrelated files remain rejected',()=>{
 const oldBlock=before.slice(before.indexOf('const names=new Set('),before.indexOf('async function canary('));assert.equal(namesBlock,oldBlock)
 fs.writeFileSync(root+'/output/monitor-stdout.log','synthetic evidence only',{flag:'wx'});assert.equal(context.outputCheck().length,1)
 for(const name of ['driver-syntax-guest.json','driver-syntax-monitor.json','unexpected.exe']){const other=vm.createContext({fs:{...fs,readdirSync:()=>[name]},E:root,Error});vm.runInContext(namesBlock,other);assert.throws(()=>other.outputCheck(),/unexpected_output_member/)}
})
test('scope — executable driver delta is exactly one syntax-loop line; writer and all other controls unchanged',()=>{
 assert.ok(oldLoop);assert.equal(source.replace(loop,oldLoop),before)
 assert.equal(commandLine,before.split('\n').find(l=>l.startsWith('async function command(')))
 assert.equal(saveLine,before.split('\n').find(l=>l.startsWith('const hash=')))
})
