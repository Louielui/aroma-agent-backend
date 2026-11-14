'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const {buildReadResultReply}=require('../../src/intake/readResultView')
const message='請查隔離測試庫存中的白米現有多少。讀取失敗就說明失敗，不要猜。'
const failed={source:'aroma_system',operation:'aroma_system.inventory',readKey:'aroma_system.inventory',trust:'unavailable',count:0,error:'local_fixture_tool_unavailable'}
test('failed inventory read is not presented as empty search or a new data offer',()=>{
 const out=buildReadResultReply({message,reply:'',itemsBySource:[],perSource:[failed]})
 assert.match(out.reply,/local_fixture_tool_unavailable/)
 assert.doesNotMatch(out.reply,/直接相符|安全存量|下一步/)
})
test('successful empty search retains its different status',()=>{
 const out=buildReadResultReply({message,reply:'',itemsBySource:[],perSource:[{...failed,trust:'live',error:null}]})
 assert.doesNotMatch(out.reply,/local_fixture_tool_unavailable/)
 assert.match(out.reply,/直接相符/)
})
test('unrelated source failure does not replace a valid empty inventory search',()=>{
 const out=buildReadResultReply({message,reply:'',itemsBySource:[],perSource:[{...failed,trust:'live',error:null},{...failed,source:'gmail'}]})
 assert.match(out.reply,/直接相符/)
 assert.doesNotMatch(out.reply,/local_fixture_tool_unavailable/)
})
