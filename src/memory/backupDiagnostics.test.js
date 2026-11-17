'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{PHASES,createProgress,safeDiagnostic}=require('./backupDiagnostics')
const event=(phase,state)=>JSON.stringify({event:'BACKUP_PHASE',version:1,phase,state})+'\n'
test('backup diagnostics follow exact host phases across split pipes without accepting stdout proof or untrusted fields',()=>{
 let now=0;const p=createProgress(()=>now)
 p.push(event('restore_files','started'));assert.equal(p.snapshot().phase,'unknown')
 for(const phase of PHASES){const line=event(phase,'started');p.push(line.slice(0,7));p.push(line.slice(7));now+=13;assert.equal(p.snapshot().phase,phase);assert.equal(p.snapshot().phaseElapsedMs,13);p.push(event(phase,'succeeded'))}
 assert.deepEqual(p.snapshot(),{version:1,phase:'restore_files',lastCompletedPhase:'restore_files',elapsedMs:65,phaseElapsedMs:0})
 p.push('secret-token\n');p.push(JSON.stringify({event:'BACKUP_PHASE',version:1,phase:'stage_files',state:'started',token:'secret'})+'\n');assert.equal(p.snapshot().lastCompletedPhase,'restore_files')
})
test('diagnostic limits and malformed values cannot leak details or masquerade as backup proof',()=>{
 for(const v of[{},null,{version:1,phase:'secret',lastCompletedPhase:null,elapsedMs:1,phaseElapsedMs:0},{version:1,phase:'stage_files',lastCompletedPhase:null,elapsedMs:NaN,phaseElapsedMs:0},{version:1,phase:'stage_files',lastCompletedPhase:null,elapsedMs:2,phaseElapsedMs:3}])assert.equal(safeDiagnostic(v),null)
 const p=createProgress(()=>10);p.push('x'.repeat(70000));p.push(event('stage_files','started'));assert.equal(p.snapshot().phase,'unknown');assert.ok(!JSON.stringify(p.snapshot()).includes('xxxx'))
 assert.deepEqual(safeDiagnostic({version:1,phase:'stage_files',lastCompletedPhase:null,elapsedMs:1,phaseElapsedMs:1,credentials:'secret'}),{version:1,phase:'stage_files',lastCompletedPhase:null,elapsedMs:1,phaseElapsedMs:1})
})
