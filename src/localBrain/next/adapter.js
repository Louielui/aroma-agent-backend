'use strict'
const {randomUUID}=require('node:crypto')
const {LocalModelError,endpoint,localInput,events}=require('../../adapters/LocalAdapter')

const SAMPLING=Object.freeze({temperature:0.2,top_p:0.9,top_k:40,min_p:0,repeat_penalty:1,presence_penalty:0,frequency_penalty:0,repeat_last_n:64,seed:246})
const LIMIT=8192
function failure(code){return new LocalModelError(code)}

function strataFrames(model,onDelta=()=>{}){
  const calls=new Map()
  let text='',reason=null,done=false,usage=null,timings=null
  return {
    consume(line){
      if(!line.startsWith('data:'))return
      if(done)throw failure('local_stream_extra_frame')
      const input=line.slice(5).trim()
      if(input==='[DONE]'){done=true;return}
      const row=JSON.parse(input)
      if(row.error)throw failure('local_engine_error')
      if(row.model!==model)throw failure('local_model_mismatch')
      const choice=row.choices?.[0]
      if(reason&&choice)throw failure('local_stream_extra_frame')
      const delta=choice?.delta
      if(delta?.content){text+=delta.content;onDelta(delta.content)}
      for(const c of delta?.tool_calls??[]){
        if(!Number.isSafeInteger(c.index)||c.index<0||c.index>7)throw failure('local_tool_protocol')
        const last=calls.get(c.index)||{id:null,name:'',args:''}
        if(c.id){if(last.id&&last.id!==c.id)throw failure('local_tool_protocol');last.id=c.id}
        last.name+=c.function?.name||''
        last.args+=c.function?.arguments||''
        calls.set(c.index,last)
      }
      if(choice?.finish_reason)reason=choice.finish_reason
      if(row.usage)usage=row.usage
      if(row.timings)timings=row.timings
    },
    finish(){
      if(reason==='length')throw failure('local_output_limit')
      if(!done||!['stop','tool_calls'].includes(reason)||(!text.trim()&&!calls.size)||
          (calls.size>0)!==(reason==='tool_calls'))throw failure('local_stream_incomplete')
      return {text,calls:[...calls.values()].map(c=>{
        if(!c.id||!c.name)throw failure('local_tool_protocol')
        return {...c,args:JSON.parse(c.args)}
      }),usage,timings}
    }
  }
}
function ollamaFrames(model,onDelta=()=>{}){
  let text='',final=null,calls=[]
  return {
    consume(line){
      if(!line.trim())return
      if(final)throw failure('local_stream_extra_frame')
      const row=JSON.parse(line)
      if(row.error)throw failure('local_engine_error')
      if(row.model!==model)throw failure('local_model_mismatch')
      if(row.message?.content){text+=row.message.content;onDelta(row.message.content)}
      for(const t of row.message?.tool_calls??[])calls.push({id:t.id||randomUUID(),name:t.function?.name,args:t.function?.arguments})
      if(row.done===true)final=row
    },
    finish(){
      if(final?.done_reason==='length')throw failure('local_output_limit')
      if(!final||final.done_reason!=='stop'||(!text.trim()&&!calls.length))throw failure('local_stream_incomplete')
      if(calls.length>8||calls.some(c=>!c.name||!c.args||typeof c.args!=='object'))throw failure('local_tool_protocol')
      return {text,calls,usage:{prompt_tokens:final.prompt_eval_count,completion_tokens:final.eval_count},
        timings:{predicted_ms:final.eval_duration==null?null:final.eval_duration/1e6}}
    }
  }
}

function satisfies(value,schema){
  if(schema.enum&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))return false
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))return false
    if((schema.required||[]).some(key=>!Object.hasOwn(value,key)))return false
    return Object.entries(value).every(([key,val])=>{
      if(Object.hasOwn(schema.properties||{},key))return satisfies(val,schema.properties[key])
      return schema.additionalProperties!==false
    })
  }
  if(schema.type==='array')return Array.isArray(value)&&(!schema.items||value.every(v=>satisfies(v,schema.items)))
  if(schema.type==='integer')return Number.isSafeInteger(value)
  if(schema.type==='number')return typeof value==='number'&&Number.isFinite(value)
  if(schema.type==='null')return value===null
  if(schema.type==='string'||schema.type==='boolean')return typeof value===schema.type
  return false
}
function assertSchema(text,schema){
  let value
  try{value=JSON.parse(text)}catch{throw failure('local_schema_invalid')}
  if(!satisfies(value,schema))throw failure('local_schema_invalid')
  return value
}
function schemaSupported(schema){
  if(!schema||Object.keys(schema).some(k=>!['type','properties','required','additionalProperties','items','enum'].includes(k)))return false
  return ['object','array','integer','number','string','boolean','null'].includes(schema.type)&&
    Object.values(schema.properties||{}).every(schemaSupported)&&(!schema.items||schemaSupported(schema.items))&&
    (schema.additionalProperties===undefined||typeof schema.additionalProperties==='boolean')
}

function createAdapter(pin,{trace=()=>{},signal}={}){
  const base=endpoint(pin.url)
  async function generate(messages,{tools,toolChoice,schema,legacy=false,maxTokens=512,phase='answer',onDelta=()=>{}}={}){
    if(schema&&!legacy&&!schemaSupported(schema))throw failure('local_schema_unsupported')
    if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>=LIMIT)throw failure('local_output_budget_invalid')
    // Keep the full supplied transcript. Use a conservative bound for the engine that can truncate it.
    if(!Array.isArray(messages)||Buffer.byteLength(JSON.stringify(messages))>120000)throw failure('local_context_capacity_exceeded')
    const t=performance.now(),id=randomUUID()
    let first=null,wire='',pending=''
    const delta=str=>{if(first===null&&str.trim())first=performance.now()-t;onDelta(str)}
    const open=pin.engine==='strata'
    const frames=open?strataFrames(pin.model,delta):ollamaFrames(pin.model,delta)
    if(!open&&Buffer.byteLength(JSON.stringify(messages))+128+maxTokens>LIMIT)throw failure('local_context_capacity_exceeded')
    const sampling={...SAMPLING}
    const body=open?{model:pin.model,messages,stream:true,stream_options:{include_usage:true},...sampling,
      max_tokens:maxTokens,chat_template_kwargs:{enable_thinking:false},
      ...(tools?{tools}:{}),...(toolChoice?{tool_choice:toolChoice}:{}),...(schema?{response_format:schema===true?{type:'json_object'}:{type:'json_schema',json_schema:{name:'answer',strict:true,schema}}}:{})}:
      {model:pin.model,messages,stream:true,think:false,keep_alive:-1,options:{...sampling,num_ctx:LIMIT,num_gpu:pin.layers,num_predict:maxTokens},
        ...(tools?{tools}:{}),...(schema?{format:schema===true?'json':schema}:{})}
    trace({type:'model_start',id,phase,engine:pin.engine,model:pin.model,messages,maxTokens})
    try{
      const response=await fetch(base+(open?'/v1/chat/completions':'/api/chat'),{method:'POST',redirect:'error',
        headers:{'content-type':'application/json',...(pin.key?{authorization:'Bearer '+pin.key}:{})},
        body:JSON.stringify(body),signal:AbortSignal.any([AbortSignal.timeout(180000),signal].filter(Boolean))})
      if(!response.ok){wire=(await response.text()).slice(0,65536);throw failure('local_http_'+response.status)}
      const decoder=new TextDecoder()
      for await(const part of response.body){
        const value=decoder.decode(part,{stream:true})
        wire+=value;pending+=value
        if(wire.length>2097152)throw failure('local_protocol_limit')
        let i
        while((i=pending.indexOf('\n'))!==-1){frames.consume(pending.slice(0,i).trimEnd());pending=pending.slice(i+1)}
      }
      const tail=decoder.decode()
      wire+=tail;frames.consume(pending+tail)
      const result=frames.finish()
      if(schema&&!legacy)assertSchema(result.text,schema)
      const timing={firstMs:first,totalMs:performance.now()-t,...result.timings}
      trace({type:'model_complete',id,phase,text:result.text,calls:result.calls,usage:result.usage,timing,wire})
      return {...result,timing}
    }catch(error){
      const safe=error.localModelFailure?error:failure(signal?.aborted?'local_cancelled':'local_transport_or_protocol_error')
      trace({type:'model_failed',id,phase,code:safe.code,firstMs:first,totalMs:performance.now()-t,wire})
      throw safe
    }
  }

  // Match the existing PR246 adapter's prompt and provider contract for comparison C.
  async function complete(prompt,opts={}){
    const context=events.getStore()
    if(context?.budget){
      if(context.budget.sent>=context.budget.limit)throw failure('local_turn_call_limit')
      context.budget.sent++
    }
    const input=localInput(prompt,opts)
    const result=await generate([{role:'system',content:input.system},{role:'user',content:input.user}],
      {phase:opts.invocationPhase,legacy:true,schema:opts.responseFormat?.schema||true,maxTokens:input.maxTokens})
    const inputTokens=result.usage?.prompt_tokens||0,outputTokens=result.usage?.completion_tokens||0
    let text=result.text
    if(opts.responseFormat?.schema?.properties?.memoryReferences){
      try{text=require('../evidenceSchema').projectMemoryReferences(text,opts.responseFormat.schema)}catch{throw failure('local_invalid_memory_references')}
    }
    return {text,model:'local:'+pin.model,billing:'local',
      usage:{inputTokens,outputTokens,totalTokens:inputTokens+outputTokens},timing:result.timing,latencyMs:result.timing.totalMs}
  }
  return {generate,complete,providerName:'local',preflight:async()=>({available:true,model:pin.model,provider:'local'})}
}

module.exports={strataFrames,ollamaFrames,createAdapter,assertSchema,SAMPLING,LIMIT}
