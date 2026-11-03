'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),{randomUUID}=require('node:crypto'),{verifyPreparedTests}=require('./committedCandidate'),{parseTests}=require('./checks')
test('prepared review re-reads exact committed tree and measured TAP; altered source, log or paths refuse',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prepared-review-'));t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());fs.rmSync(root,{recursive:true,force:true})})
 const git=(...a)=>cp.execFileSync('git',['-c','core.hooksPath=','-c','commit.gpgsign=false',...a],{cwd:root,windowsHide:true,encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Offline fixture');git('config','user.email','fixture@example.invalid');fs.writeFileSync(root+'/code.js','original');git('add','.');git('commit','-qm','fixture')
 const id=randomUUID(),artifacts=root+'/host',directory=artifacts+'/runs/'+id,logPath=directory+'/full-tests/tests.tap';fs.mkdirSync(path.dirname(logPath),{recursive:true});const log='TAP version 13\nok 1 - offline fixture\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n';fs.writeFileSync(logPath,log)
 // Evidence is outside the source checkout in production. Ignore only this
 // fixture's owned host directory so clean-tree semantics are identical.
 fs.writeFileSync(root+'/.git/info/exclude','host/\n')
 const row={id,committed:{commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')},tests:{...parseTests(log,0),commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),timedOut:false,logPath}}
 assert.equal(verifyPreparedTests({root,artifacts,row}).passed,1)
 fs.writeFileSync(logPath,log+'# altered\n');assert.throws(()=>verifyPreparedTests({root,artifacts,row}),/committed_tests_unconfirmed/);fs.writeFileSync(logPath,log)
 assert.throws(()=>verifyPreparedTests({root,artifacts,row:{...row,tests:{...row.tests,logPath:root+'/elsewhere'}}}),/committed_tests_unconfirmed/)
 fs.writeFileSync(root+'/code.js','changed');assert.throws(()=>verifyPreparedTests({root,artifacts,row}),/committed_candidate_changed/)
})
