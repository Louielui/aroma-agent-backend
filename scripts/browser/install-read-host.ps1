param([switch]$PrepareOnly,[switch]$PublishClient)
$ErrorActionPreference='Stop'
if($PrepareOnly -and $PublishClient){throw 'ConflictingInstallationMode'}
# Only this fixed Owner repository, per-user host and consent-bound extension.
$browserRepo='C:\Aroma\aroma-agent-backend'
$browserNode='C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $browserNode)) { throw 'NodeRuntimeUnavailable' }
$browserCommit=(& git -c "safe.directory=$browserRepo" -C $browserRepo rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $browserCommit -notmatch '^[a-f0-9]{40}$'){throw 'RepositoryIdentityUnavailable'}
$browserRemote=(& git -c "safe.directory=$browserRepo" -C $browserRepo remote get-url origin).Trim()
if($browserRemote -notin @('https://github.com/Louielui/aroma-agent-backend.git','git@github.com:Louielui/aroma-agent-backend.git')){throw 'RepositoryIdentityChanged'}
$browserRoot=Join-Path $env:USERPROFILE '.imagine/browser-context-read'
$browserRelease=Join-Path $browserRoot ($browserCommit+'-'+[Guid]::NewGuid().ToString())
if(Test-Path -LiteralPath $browserRelease){throw 'ReleaseAlreadyPrepared'}
New-Item -ItemType Directory -Path $browserRelease -Force | Out-Null
function Read-BrowserGitBlob([string]$name){
  $info=New-Object Diagnostics.ProcessStartInfo('git.exe')
  $info.Arguments='-c safe.directory="'+$browserRepo+'" -C "'+$browserRepo+'" show '+$browserCommit+':'+$name
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $process=New-Object Diagnostics.Process;$process.StartInfo=$info
  $buffer=New-Object IO.MemoryStream
  try{[void]$process.Start();$process.StandardOutput.BaseStream.CopyTo($buffer);$process.WaitForExit();if($process.ExitCode -ne 0){throw 'GitBlobUnavailable'};return $buffer.ToArray()}finally{$buffer.Dispose();$process.Dispose()}
}
$browserNames=@('src/browserRead/nativeHost.cjs','src/browserRead/clientUpdate.js','src/browserRead/contract.js','src/browserRead/nativeProtocol.js','src/browserRead/operatorBroker.cjs','src/browserRead/nativeInput.cjs','src/browserOperator/NativeBrowserInput.cs','extensions/browser-read/manifest.json','extensions/browser-read/worker.js','extensions/browser-read/collector.js','extensions/browser-read/operator.js','extensions/browser-read/operator-panel.js','extensions/browser-read/sidepanel.html','extensions/browser-read/sidepanel.js','extensions/browser-read/sidepanel.css','extensions/browser-read/release.js')
$browserPins=@{}
foreach($browserName in $browserNames){
  $browserSource=Join-Path $browserRepo $browserName
  $browserStat=Get-Item -LiteralPath $browserSource
  if($browserStat.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UnsafeSource'}
  # Compare exact Git blob bytes; do not publish an unreviewed local overlay.
  $browserExpected=(& git -c "safe.directory=$browserRepo" -C $browserRepo rev-parse ($browserCommit+':'+$browserName)).Trim()
  $browserActual=(& git -c "safe.directory=$browserRepo" -C $browserRepo hash-object $browserSource).Trim()
  if($LASTEXITCODE -ne 0 -or $browserActual -cne $browserExpected){throw 'UncommittedHostSource'}
  $browserDestination=if($browserName.StartsWith('extensions/')){Join-Path (Join-Path $browserRelease 'extension') ([IO.Path]::GetFileName($browserName))}else{Join-Path $browserRelease ([IO.Path]::GetFileName($browserName))}
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($browserDestination)) -Force | Out-Null
  [IO.File]::WriteAllBytes($browserDestination,(Read-BrowserGitBlob $browserName))
  $browserPins[[IO.Path]::GetFileName($browserDestination)]=(Get-FileHash -LiteralPath $browserDestination -Algorithm SHA256).Hash.ToLowerInvariant()
}
$browserManifest=Get-Content -LiteralPath (Join-Path $browserRelease 'extension/manifest.json') -Raw | ConvertFrom-Json
$browserWorkerHasher=[Security.Cryptography.SHA256]::Create()
try{$browserWorkerHash=([BitConverter]::ToString($browserWorkerHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes((@($browserPins['worker.js'],$browserPins['collector.js'],$browserPins['operator.js']) -join ':'))))).Replace('-','').ToLowerInvariant()}finally{$browserWorkerHasher.Dispose()}
$browserReleaseScript='globalThis.IMAGINE_CLIENT_RELEASE='+(@{commit=$browserCommit;workerHash=$browserWorkerHash}|ConvertTo-Json -Compress)+";`n"
[IO.File]::WriteAllText((Join-Path $browserRelease 'extension/release.js'),$browserReleaseScript,(New-Object Text.UTF8Encoding($false)))
$browserPins['release.js']=(Get-FileHash -LiteralPath (Join-Path $browserRelease 'extension/release.js')).Hash.ToLowerInvariant()
$browserKey=[Convert]::FromBase64String($browserManifest.key)
$browserHasher=[Security.Cryptography.SHA256]::Create()
try{$browserIdHash=([BitConverter]::ToString($browserHasher.ComputeHash($browserKey))).Replace('-','').ToLowerInvariant().Substring(0,32)}finally{$browserHasher.Dispose()}
$browserExtensionId=-join ($browserIdHash.ToCharArray() | ForEach-Object { [char](97+[Convert]::ToInt32($_.ToString(),16)) })
$browserOrigin='chrome-extension://'+$browserExtensionId+'/'
$browserInputExe=Join-Path $browserRelease 'ImagineBrowserInput.exe'
Add-Type -Path (Join-Path $browserRelease 'NativeBrowserInput.cs') -ReferencedAssemblies 'System.Core','System.Drawing','System.Web.Extensions',(Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/WPF/UIAutomationClient.dll'),(Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/WPF/UIAutomationTypes.dll'),(Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319/WPF/WindowsBase.dll') -OutputAssembly $browserInputExe -OutputType ConsoleApplication
$browserInputHash=(Get-FileHash -LiteralPath $browserInputExe).Hash.ToLowerInvariant()
$browserPins['ImagineBrowserInput.exe']=$browserInputHash
[IO.File]::WriteAllText((Join-Path $browserRelease 'host-config.json'),(@{extensionOrigin=$browserOrigin;commit=$browserCommit;inputHash=$browserInputHash}|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
$browserPins['host-config.json']=(Get-FileHash -LiteralPath (Join-Path $browserRelease 'host-config.json')).Hash.ToLowerInvariant()
$browserPinLiteral=($browserPins.GetEnumerator() | Where-Object {$_.Key -in @('nativeHost.cjs','clientUpdate.js','contract.js','nativeProtocol.js','operatorBroker.cjs','nativeInput.cjs','NativeBrowserInput.cs','ImagineBrowserInput.exe','host-config.json')} | ForEach-Object {'{"'+$_.Key+'","'+$_.Value+'"}'} ) -join ','
$browserCsharp=@"
using System; using System.IO; using System.Diagnostics; using System.Collections.Generic; using System.Security.Cryptography; using System.Threading.Tasks;
public static class ImagineBrowserReadHost {
 static byte[] ReadFramePart(Stream input,int length){
  byte[] bytes=new byte[length];int offset=0;
  while(offset<length){int read=input.Read(bytes,offset,length-offset);if(read==0){if(offset==0)return null;throw new EndOfStreamException();}offset+=read;}return bytes;
 }
 static void PumpFrames(Stream input,Stream output,uint maximum){
  while(true){byte[] header=ReadFramePart(input,4);if(header==null)return;uint length=BitConverter.ToUInt32(header,0);if(length==0||length>maximum)throw new InvalidDataException();byte[] body=ReadFramePart(input,(int)length);if(body==null)throw new EndOfStreamException();output.Write(header,0,4);output.Write(body,0,body.Length);output.Flush();}
 }
 public static int Main(string[] args){
  try {
   if(args.Length==0 || args[0]!="$browserOrigin") return 3;
   string root=AppDomain.CurrentDomain.BaseDirectory;
   var pins=new Dictionary<string,string>{$browserPinLiteral};
   foreach(var p in pins){using(var sha=SHA256.Create()){string hash=BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(Path.Combine(root,p.Key)))).Replace("-", "").ToLowerInvariant(); if(hash!=p.Value)return 3;}}
   var info=new ProcessStartInfo(@"$browserNode");info.Arguments="\""+Path.Combine(root,"nativeHost.cjs")+"\" $browserOrigin";info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardInput=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;
   using(var child=Process.Start(info)){
    Task.Run(()=>{try{PumpFrames(Console.OpenStandardInput(),child.StandardInput.BaseStream,50000);}catch{}finally{try{child.StandardInput.Close();}catch{}}});
    Task.Run(()=>{try{child.StandardError.BaseStream.CopyTo(Console.OpenStandardError());}catch{}});
    PumpFrames(child.StandardOutput.BaseStream,Console.OpenStandardOutput(),200000);child.WaitForExit();return child.ExitCode;
   }
  }catch{Console.Error.WriteLine("Imagine browser read host unavailable.");return 3;}
 }
}
"@
$browserExe=Join-Path $browserRelease 'ImagineBrowserReadHost.exe'
Add-Type -TypeDefinition $browserCsharp -OutputAssembly $browserExe -OutputType ConsoleApplication
$browserHostManifest=Join-Path $browserRelease 'native-host.json'
[IO.File]::WriteAllText($browserHostManifest,(@{name='com.imagine.browser_read';description='Imagine approved current-page read broker';path=$browserExe;type='stdio';allowed_origins=@($browserOrigin)}|ConvertTo-Json -Depth 3),(New-Object Text.UTF8Encoding($false)))
$browserRegistry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.imagine.browser_read'
$browserPrior=$null
if(Test-Path -LiteralPath $browserRegistry){$browserPrior=(Get-Item -LiteralPath $browserRegistry).GetValue('')}
$browserReceipt=@{commit=$browserCommit;extensionId=$browserExtensionId;extensionPath=(Join-Path $browserRelease 'extension');hostManifest=$browserHostManifest;previousManifest=$browserPrior;preparedOnly=[bool]$PrepareOnly;hashes=$browserPins;checkedAt=[DateTime]::UtcNow.ToString('o')}
[IO.File]::WriteAllText((Join-Path $browserRelease 'installation.json'),($browserReceipt|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
$browserPublished=$null
if($PublishClient){
  $browserPublicationText=(& $browserNode (Join-Path $browserRelease 'clientUpdate.js') publish (Join-Path $browserRelease 'installation.json'))
  if($LASTEXITCODE -ne 0){throw 'ClientPublicationFailed'}
  $browserPublished=$browserPublicationText | ConvertFrom-Json
  [IO.File]::WriteAllText((Join-Path $browserRelease 'client-publication.json'),$browserPublicationText,(New-Object Text.UTF8Encoding($false)))
  $browserReceipt.managedExtensionPath=$browserPublished.extensionDirectory
}
if(-not $PrepareOnly){
  try{
    New-Item -Path $browserRegistry -Force | Out-Null
    Set-Item -LiteralPath $browserRegistry -Value $browserHostManifest
    if((Get-Item -LiteralPath $browserRegistry).GetValue('') -cne $browserHostManifest){throw 'HostRegistrationUnconfirmed'}
    $browserReceipt.registrationVerified=$true
  }catch{
    if($null -ne $browserPrior){Set-Item -LiteralPath $browserRegistry -Value $browserPrior}else{if(Test-Path -LiteralPath $browserRegistry){Remove-Item -LiteralPath $browserRegistry}}
    $browserReceipt.registrationVerified=$false
    $browserReceipt.restoredPreviousRegistration=$true
    if($null -ne $browserPublished){& $browserNode (Join-Path $browserRelease 'clientUpdate.js') restore (Join-Path $browserRelease 'client-publication.json') | Out-Null;if($LASTEXITCODE -ne 0){throw 'ClientAndHostRollbackFailed'}}
    [IO.File]::WriteAllText((Join-Path $browserRelease 'installation.json'),($browserReceipt|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
    throw 'HostRegistrationFailedAndRestored'
  }
  [IO.File]::WriteAllText((Join-Path $browserRelease 'installation.json'),($browserReceipt|ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
}
Write-Output ($browserReceipt|ConvertTo-Json -Depth 4)
