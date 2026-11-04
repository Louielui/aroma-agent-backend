'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process')

function fixture(t){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'installer-packaging-')),repo=path.join(temp,'repo'),release=path.join(temp,'release'),root=path.resolve(__dirname,'../..')
 t.after(()=>{assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true})})
 fs.mkdirSync(repo);fs.mkdirSync(release)
 const source=fs.readFileSync(path.join(root,'scripts/browser/install-read-host.ps1'),'utf8'),names=[...source.match(/\$browserNames=@\(([^\n]+)\)/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1])
 assert.equal(names.length,16)
 for(const name of names){fs.mkdirSync(path.dirname(path.join(repo,name)),{recursive:true});fs.copyFileSync(path.join(root,name),path.join(repo,name))}
 const git=(...args)=>cp.execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','-C',repo,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
 git('init','-b','main');git('config','core.autocrlf','true');git('add','.');git('commit','-m','isolated installer inputs');const commit=git('rev-parse','HEAD')
 return{temp,repo,release,source,names,commit}
}
test('actual Windows installer packaging copies all reviewed blobs into an isolated fixture without registration',t=>{
 if(process.platform!=='win32'){t.diagnostic('Windows packaging is measured on the Owner host.');return}
 const {temp,repo,release,source,names,commit}=fixture(t),begin=source.indexOf('function Read-BrowserGitBlob'),end=source.indexOf('$browserManifest=');assert.ok(begin>0&&end>begin)
 const packaging=source.slice(begin,end);assert.ok(!/HKCU:|Set-Item|Add-Type|PublishClient/.test(packaging))
 const quote=s=>s.replace(/'/g,"''"),code=`$ErrorActionPreference='Stop';function Get-FileHash {throw 'FixtureGetFileHashUnavailable'};$browserRepo='${quote(repo)}';$browserCommit='${commit}';$browserRelease='${quote(release)}';. ([scriptblock]::Create('${quote(packaging)}'));Write-Output ('packaged='+$browserPins.Count)`
 const r=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',code],{cwd:temp,encoding:'utf8',shell:false,windowsHide:true,timeout:30000})
 assert.equal(r.status,0,JSON.stringify({errorCode:r.error?.code||null,signal:r.signal||null,stderr:r.stderr}));assert.match(r.stdout,/packaged=16/)
 for(const name of names){const copied=path.join(release,name.startsWith('extensions/')?'extension':'',path.basename(name)),expected=cp.execFileSync('git',['-C',repo,'show',commit+':'+name]);assert.deepEqual(fs.readFileSync(copied),expected,name)}
})

test('the complete Windows installer prepares real compiled host artifacts in a private profile with registry access fenced',t=>{
 if(process.platform!=='win32'){t.diagnostic('Windows preparation is measured on the Owner host.');return}
 const {temp,repo,source,commit}=fixture(t),profile=path.join(temp,'profile');fs.mkdirSync(profile)
 cp.execFileSync('git',['-C',repo,'remote','add','origin','https://github.com/Louielui/aroma-agent-backend.git'],{stdio:'pipe'})
 const literal="$browserRepo='C:\\Aroma\\aroma-agent-backend'";assert.equal(source.split(literal).length,2)
 const quote=s=>s.replace(/'/g,"''"),isolated=source.replace(literal,"$browserRepo='"+quote(repo)+"'")
 const fence=String.raw`function Test-Path {param([string]$LiteralPath,[string]$Path);$p=if($LiteralPath){$LiteralPath}else{$Path};if($p.StartsWith('HKCU:')){return $false};Microsoft.PowerShell.Management\Test-Path -LiteralPath $p};function Set-Item {throw 'RegistryWriteForbidden'};function Remove-Item {throw 'RemovalForbidden'};`
 const code=`$ErrorActionPreference='Stop';function Get-FileHash {throw 'FixtureGetFileHashUnavailable'};${fence}. ([scriptblock]::Create('${quote(isolated)}')) -PrepareOnly`
 const r=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',code],{cwd:temp,env:{...process.env,USERPROFILE:profile,LOCALAPPDATA:path.join(profile,'AppData/Local'),APPDATA:path.join(profile,'AppData/Roaming')},encoding:'utf8',shell:false,windowsHide:true,timeout:45000})
 assert.equal(r.status,0,JSON.stringify({errorCode:r.error?.code||null,signal:r.signal||null,stderr:r.stderr}));const receipt=JSON.parse(r.stdout);assert.equal(receipt.commit,commit);assert.equal(receipt.preparedOnly,true);assert.equal(receipt.registrationVerified,undefined);assert.ok(path.resolve(receipt.hostManifest).startsWith(path.resolve(profile)+path.sep));assert.ok(fs.statSync(path.join(path.dirname(receipt.hostManifest),'ImagineBrowserInput.exe')).size>0);assert.ok(fs.statSync(path.join(path.dirname(receipt.hostManifest),'ImagineBrowserReadHost.exe')).size>0)
 const host=JSON.parse(fs.readFileSync(receipt.hostManifest,'utf8'));assert.deepEqual(host.allowed_origins,['chrome-extension://agbdknicgbpppabdlhmchijhnbmagiff/']);assert.equal(receipt.hashes['nativeHost.cjs'],require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(path.dirname(receipt.hostManifest),'nativeHost.cjs'))).digest('hex'))
})

test('actual installer failure reporting emits only a fixed stage and allowlisted error metadata',()=>{
 if(process.platform!=='win32')return
 const file=path.resolve(__dirname,'../../scripts/browser/install-read-host.ps1').replace(/'/g,"''")
 const code=String.raw`$ErrorActionPreference='Stop';$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$tokens,[ref]$errors);if($errors.Count){throw 'InstallerParseFailed'};$main=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]});if($main.Count -ne 1){throw 'FailureHandlerUnavailable'};$body=$main[0].CatchClauses[0].Body.Extent.Text;$handler=[scriptblock]::Create($body.Substring(1,$body.Length-2));$browserStage='copy_sources';$browserNames=@('src/browserRead/nativeHost.cjs');$browserSourceName=$browserNames[0];try{throw 'credential=fixture-secret'}catch{. $handler}`
 const r=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',shell:false,windowsHide:true,timeout:15000})
 assert.equal(r.status,1);assert.equal(r.stdout,'');assert.ok(!r.stderr.includes('fixture-secret'));const diagnostic=JSON.parse(r.stderr.trim().replace(/^IMAGINE_CLIENT_INSTALL /,''));assert.equal(diagnostic.stage,'copy_sources');assert.equal(diagnostic.reason,'client_install_unconfirmed');assert.equal(diagnostic.errorId,'unconfirmed');assert.equal(diagnostic.sourceName,'src/browserRead/nativeHost.cjs')
})
