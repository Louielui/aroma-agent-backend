'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process')
test('actual native launcher compiles and refuses a different extension before opening the broker',t=>{
 if(process.platform!=='win32'){t.diagnostic('Windows native compilation is measured on the Owner host.');return}
 const file=path.join(__dirname,'../../scripts/browser/install-read-host.ps1').replace(/'/g,"''"),dir=fs.mkdtempSync(path.join(require('os').tmpdir(),'browser-launcher-test-')).replace(/'/g,"''")
 const code=String.raw`$ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'InstallerParseFailed'};$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$browserCsharp'},$true);$browserOrigin='chrome-extension://agbdknicgbpppabdlhmchijhnbmagiff/';$browserNode='C:\Program Files\nodejs\node.exe';$browserPinLiteral='{"host-config.json","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';. ([scriptblock]::Create($assignment.Extent.Text));$exe='${dir}/host.exe';Add-Type -TypeDefinition $browserCsharp -OutputAssembly $exe -OutputType ConsoleApplication;& $exe 'chrome-extension://wrong/';if($LASTEXITCODE -ne 3){throw 'OriginRefusalFailed'};Write-Output 'native_launcher_refusal_verified'`
 const r=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',shell:false,windowsHide:true,timeout:30000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/native_launcher_refusal_verified/)
})
test('host installer is restricted to one per-user registry key, reviewed blobs and fixed Node executable',()=>{const source=fs.readFileSync(path.join(__dirname,'../../scripts/browser/install-read-host.ps1'),'utf8');assert.match(source,/HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.imagine.browser_read/);assert.ok(!/HKLM:|RunAs|Set-ExecutionPolicy|COMPUTER_OPERATOR|New-Service/.test(source));assert.match(source,/allowed_origins=@\(\$browserOrigin\)/);assert.match(source,/Read-BrowserGitBlob/);assert.match(source,/previousManifest/);assert.match(source,/PrepareOnly/);assert.match(source,/if\(hash!=p.Value\)return 3/)} )

test('compiled native launcher returns each small frame before the persistent input pipe closes',async t=>{
 if(process.platform!=='win32'){t.diagnostic('Windows persistent native pipes are measured on the Owner host.');return}
 const dir=fs.mkdtempSync(path.join(require('os').tmpdir(),'browser-launcher-pipe-')),file=path.join(__dirname,'../../scripts/browser/install-read-host.ps1').replace(/'/g,"''"),exe=path.join(dir,'host.exe');
 const broker=String.raw`let b=Buffer.alloc(0);process.stdin.on('data',c=>{b=Buffer.concat([b,c]);while(b.length>=4&&b.length>=b.readUInt32LE(0)+4){const n=b.readUInt32LE(0)+4;process.stdout.write(b.subarray(0,n));b=b.subarray(n);}});process.stdin.on('end',()=>process.exit(0));`;
 fs.writeFileSync(path.join(dir,'nativeHost.cjs'),broker);
 const hash=require('node:crypto').createHash('sha256').update(broker).digest('hex');
 const code=String.raw`$ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'InstallerParseFailed'};$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$browserCsharp'},$true);$browserOrigin='chrome-extension://agbdknicgbpppabdlhmchijhnbmagiff/';$browserNode='C:\Program Files\nodejs\node.exe';$browserPinLiteral='{"nativeHost.cjs","${hash}"}';. ([scriptblock]::Create($assignment.Extent.Text));Add-Type -TypeDefinition $browserCsharp -OutputAssembly '${exe.replace(/'/g,"''")}' -OutputType ConsoleApplication`;
 const compile=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',shell:false,windowsHide:true,timeout:30000});assert.equal(compile.status,0,compile.stderr);
 const child=cp.spawn(exe,['chrome-extension://agbdknicgbpppabdlhmchijhnbmagiff/'],{stdio:['pipe','pipe','pipe'],windowsHide:true});let bytes=Buffer.alloc(0),pending=null;
 child.stdout.on('data',c=>{bytes=Buffer.concat([bytes,c]);if(pending&&bytes.length>=4&&bytes.length>=bytes.readUInt32LE(0)+4){const n=bytes.readUInt32LE(0)+4,v=JSON.parse(bytes.subarray(4,n));bytes=bytes.subarray(n);const resolve=pending;pending=null;resolve(v);}});
 child.stdin.on('error',()=>{});
 try{
  for(const id of ['first-small-frame','second-small-frame']){
   const reply=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending=null;reject(Error('launcher_waited_for_pipe_close'));},4000);pending=v=>{clearTimeout(timer);resolve(v);};});
   const body=Buffer.from(JSON.stringify({id})),header=Buffer.alloc(4);header.writeUInt32LE(body.length);child.stdin.write(Buffer.concat([header,body]));
   assert.deepEqual(await reply,{id});assert.equal(child.stdin.writableEnded,false);
  }
 }finally{child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve();},2000);child.once('close',()=>{clearTimeout(timer);resolve();});});}
})
