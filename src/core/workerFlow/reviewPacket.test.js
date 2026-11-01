'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{reviewPacket,excerpt}=require('./reviewPacket'),hash=s=>createHash('sha256').update(s).digest('hex')
test('large review retains every changed character/line, preserving both exact outer hashes',()=>{
 const before=('unchanged\n'.repeat(40000))+'old text\n'+('tail\n'.repeat(40000)),after=before.replace('old text','new receipt text'),c={file:'catalogue.js',before,after,beforeHash:hash(before),afterHash:hash(after)},p=reviewPacket({changes:[c],before,after,workOrder:{allowedFiles:['catalogue.js']}}),s=p.changes[0]
 assert.ok(JSON.stringify(p).length<10000);assert.match(s.before,/old text/);assert.match(s.after,/new receipt text/)
 const prefix=before.slice(0,s.omittedIdenticalPrefix.characters),suffix=before.slice(before.length-s.omittedIdenticalSuffix.characters);assert.equal(prefix+s.before+suffix,before);assert.equal(prefix+s.after+suffix,after);assert.equal(hash(prefix),s.omittedIdenticalPrefix.sha256);assert.equal(hash(suffix),s.omittedIdenticalSuffix.sha256)
})
test('far-apart changes cannot be silently truncated to fit the reviewer',()=>{
 const before='old\n'+'middle'.repeat(170000)+'\nold',after='new\n'+'middle'.repeat(170000)+'\nnew';assert.throws(()=>reviewPacket({changes:[{file:'large',before,after,beforeHash:hash(before),afterHash:hash(after)}]}),/review_scope_too_large/)
 assert.throws(()=>excerpt({before:'x',after:'y',beforeHash:'bad',afterHash:hash('y')}),/invalid_worker_result/)
})
