'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process')
test('compiled native URL matching accepts the fixed fixture Chrome display and refuses neighboring HTTP destinations',()=>{
 if(process.platform!=='win32')return
 const fixture='http://127.0.0.1:8090/browser-operator-fixture',display=fixture.substring(7)
 const cases=[
  [display,fixture,true],[fixture,fixture,true],
  ['app.7shifts.com/company/153450/employees/list','https://app.7shifts.com/company/153450/employees/list',true],
  ['127.0.0.1:8092/browser-operator-fixture',fixture,false],['localhost:8090/browser-operator-fixture',fixture,false],
  [display+'/',fixture,false],[display+'?token=fixture',fixture,false],[display+'#fragment',fixture,false],
  ['https://'+display,fixture,false],['evil.test/'+display,fixture,false],
  ['127.0.0.1:8090/private','http://127.0.0.1:8090/private',false],
  ['example.test/page','http://example.test/page',false],[null,fixture,false]
 ]
 const source=path.join(__dirname,'NativeBrowserInput.cs'),ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
 const script="$ErrorActionPreference='Stop';Add-Type -Path '"+source+"' -ReferencedAssemblies 'System.Core','System.Drawing','System.Web.Extensions','C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\UIAutomationClient.dll','C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\UIAutomationTypes.dll','C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\WindowsBase.dll';$taskMethod=[NativeBrowserInput].GetMethod('MatchesAddress',[Reflection.BindingFlags]'NonPublic,Static');$taskCases=ConvertFrom-Json -InputObject '"+JSON.stringify(cases)+"';$taskResults=@(foreach($taskCase in $taskCases){$taskMethod.Invoke($null,[object[]]@($taskCase[0],$taskCase[1]))});ConvertTo-Json -InputObject $taskResults -Compress"
 // Invoke only the compiled pure string predicate; no window observation or native input.
 const documentCheck=";$taskDocument=[NativeBrowserInput].GetMethod('Matches',[Reflection.BindingFlags]'NonPublic,Static');ConvertTo-Json -Compress -InputObject @($taskDocument.Invoke($null,[object[]]@('"+display+"','"+fixture+"')),$taskDocument.Invoke($null,[object[]]@('"+fixture+"','"+fixture+"')))"
 const result=cp.spawnSync(ps,['-NoProfile','-NonInteractive','-Command',script+documentCheck],{encoding:'utf8',windowsHide:true,shell:false,timeout:30000})
 assert.equal(result.status,0,result.stderr)
 const output=result.stdout.trim().split(/\r?\n/)
 assert.deepEqual(JSON.parse(output[0]),cases.map(c=>c[2]))
 assert.deepEqual(JSON.parse(output[1]),[false,true])
})
