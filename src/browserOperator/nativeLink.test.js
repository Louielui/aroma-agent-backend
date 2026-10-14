'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process')
test('compiled native link guard requires the actual URI to match the sealed employee destination',()=>{
 if(process.platform!=='win32')return
 const link='https://app.7shifts.com/company/153450/employees/list'
 const cases=[[link,link,true],[link.substring(8),link,true],[null,link,false],['https://app.7shifts.com/company/153450/payroll',link,false],[link.replace('153450','153451'),link,false],[link+'?edit=1',link,false],['https://evil.test/',link,false],['https://app.7shifts.com/company/153450/payroll','https://app.7shifts.com/company/153450/payroll',false]]
 const source=path.join(__dirname,'NativeBrowserInput.cs'),ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
 const script="$ErrorActionPreference='Stop';Add-Type -Path '"+source+"' -ReferencedAssemblies 'System.Core','System.Drawing','System.Web.Extensions','C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\UIAutomationClient.dll','C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\UIAutomationTypes.dll','C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF\\WindowsBase.dll';$taskMethod=[NativeBrowserInput].GetMethod('MatchesLink',[Reflection.BindingFlags]'NonPublic,Static');$taskCases=ConvertFrom-Json -InputObject '"+JSON.stringify(cases)+"';$taskResults=@(foreach($taskCase in $taskCases){$taskMethod.Invoke($null,[object[]]@($taskCase[0],$taskCase[1]))});ConvertTo-Json -InputObject $taskResults -Compress"
 const result=cp.spawnSync(ps,['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,shell:false,timeout:30000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),cases.map(c=>c[2]))
})
