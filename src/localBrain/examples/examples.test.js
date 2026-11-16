'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{orderBoxes}=require('./stock'),{formatDuration}=require('./duration')
test('whole-box examples use exact decimal quantities and never coerce invalid inputs',()=>{
 assert.equal(orderBoxes(3,10,4),2);assert.equal(orderBoxes(0.1,0.4,0.1),3);assert.equal(orderBoxes(0,1.1,0.1),11);assert.equal(orderBoxes(1.01,1.04,0.01),3);assert.equal(orderBoxes(12,10,4),0)
 for(const v of [NaN,Infinity,-Infinity,'2',undefined,null,true,{},[]])for(let i=0;i<3;i++){const args=[1,3,1];args[i]=v;assert.throws(()=>orderBoxes(...args),RangeError)}
 assert.equal(orderBoxes(0,Number.MIN_VALUE,Number.MIN_VALUE),1);assert.equal(orderBoxes(0,Number.MAX_SAFE_INTEGER,1),Number.MAX_SAFE_INTEGER);assert.throws(()=>orderBoxes(0,Number.MAX_VALUE,Number.MIN_VALUE),RangeError)
})
test('duration examples preserve safe-integer input validation and exact remainder values',()=>{
 for(const s of [0,59,60,119,120,3600,Number.MAX_SAFE_INTEGER]){const n=BigInt(s);assert.equal(formatDuration(s),(n/60n)+'m '+(n%60n)+'s')}
 for(const s of [Number.MAX_SAFE_INTEGER+1,-1,1.5,NaN,Infinity,'60',null,undefined,{},60n])assert.throws(()=>formatDuration(s),RangeError)
})
