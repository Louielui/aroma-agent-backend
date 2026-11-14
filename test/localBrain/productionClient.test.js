'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm')
function client(){const nodes=[],document={createElement:()=>({textContent:'',className:''})},window={};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../src/demo/assets/topics.js'),'utf8'),{window,document,TextDecoder});return{read:window.XiangxiangTopics.readStream,nodes,container:{appendChild:n=>nodes.push(n)}}}
test('formal client consumes chunked UTF-8 phases and only the final guarded body',async()=>{
 const c=client(),bytes=Buffer.from('data: {"type":"model_start","phase":"answer"}\n\ndata: {"type":"final","body":{"reply":"你好"}}\n\n'),parts=[bytes.subarray(0,bytes.length-8),bytes.subarray(bytes.length-8)],body=new ReadableStream({pull(controller){parts.length?controller.enqueue(parts.shift()):controller.close()}})
 const r=await c.read({body,status:200},c.container,k=>k);assert.equal(r.body.reply,'你好');assert.equal(c.nodes.length,1);assert.equal(c.nodes[0].textContent,'localBrain.processing')
})
test('incomplete or malformed streaming responses fail visibly and cancel further consumption',async()=>{
 const c=client();let cancelled=false
 const body=new ReadableStream({start(controller){controller.enqueue(Buffer.from('data: invalid-json\n\n'))},cancel(){cancelled=true}})
 await assert.rejects(c.read({body,status:200},c.container,k=>k));assert.equal(cancelled,true)
 const missing=new ReadableStream({start(controller){controller.close()}});await assert.rejects(c.read({body:missing,status:200},c.container,k=>k),/local_stream_incomplete/)
})
