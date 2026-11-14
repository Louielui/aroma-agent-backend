'use strict'
// Local inference replay of retained inputs, not HTTP or visible-interface acceptance.
const fs=require('node:fs'),path=require('node:path')
async function main(){
 const source=process.argv[2],phase=process.argv[3]||'answer'
 const content=fs.readFileSync(source,'utf8')
 const receipt=source.endsWith('.jsonl')?JSON.parse(content.trim().split('\n').at(-1)):JSON.parse(content)
 const input=receipt.trace.filter(e=>e.type==='model_input'&&e.phase===phase).at(-1)
 if(!input)throw Error('retained_phase_missing')
 const marker='HOST OUTPUT CONTRACT (field meanings and shape, not task data):\n'
 const parts=input.system.split(marker)
 const schema=parts.length===2?JSON.parse(parts[1].split('\n\n')[0]):null
 const trace=[]
 require('../../src/localBrain/isolation').install({audit:e=>trace.push(e)})
 const {LocalAdapter}=require('../../src/adapters/LocalAdapter')
 const adapter=new LocalAdapter({env:{LOCAL_MODEL:'qwen3.5:9b',LOCAL_MODEL_CONTEXT:'65536'},onEvent:e=>trace.push(e),fetchFn:(url,opts)=>{if(process.argv.includes('--think')&&opts?.body){const body=JSON.parse(opts.body);body.think=true;opts={...opts,body:JSON.stringify(body)}}return fetch(url,opts)}})
 let result,error
 try{result=await adapter.complete(input.prompt,{system:parts[0].replace(/\n\nReturn a JSON object\.[\s\S]*$/,''),invocationPhase:phase,maxTokens:4096,...(schema?{responseFormat:{type:'json_schema',schema}}:{})})}
 catch(e){error={code:e.code||'local_replay_failed',message:e.localModelFailure?e.message:'Local replay failed; inspect retained phase events.'}}
 const file=path.join('C:/Users/louis/Documents/Codex/local-candidates/local-brain-20261114','replay-'+Date.now()+'.json')
 fs.writeFileSync(file,JSON.stringify({source,phase,result,error,trace},null,2))
 console.log(JSON.stringify({file,text:result?.text,timing:result?.timing,error}))
 if(error)process.exitCode=1
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1})
