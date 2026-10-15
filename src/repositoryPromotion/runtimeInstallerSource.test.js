'use strict'
const test=require('node:test'),assert=require('node:assert/strict');
test('managed installer source pin accepts only CRLF equivalence and rejects all other byte changes',()=>{
 const {sameInstallerSource}=require('./runtime'),canonical=Buffer.from('param()\n# Approved fixture\nWrite-Output "approved"\n'),windows=Buffer.from(canonical.toString().replace(/\n/g,'\r\n'));
 assert.equal(sameInstallerSource(windows,canonical),true);assert.equal(sameInstallerSource(canonical,windows),true);assert.equal(sameInstallerSource(canonical,canonical),true);
 for(const changed of [Buffer.from(canonical.toString().replace('approved','changed')),Buffer.from(canonical.toString()+'Write-Output "extra"\n'),Buffer.from(canonical.toString().replace('param()','param() ')),canonical.subarray(0,-1),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),canonical]),Buffer.from([0xff,0x0a])])assert.equal(sameInstallerSource(changed,canonical),false);
 assert.equal(sameInstallerSource(Buffer.from([0xff,13,10]),Buffer.from([0xff,10])),true);assert.equal(sameInstallerSource(Buffer.from([0xff,10]),Buffer.from([0xfe,10])),false);
});
