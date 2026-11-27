'use strict'
const $=id=>document.getElementById(id)
let conversation=null,phase1=false,selectedArm=null
const chats=new Map()
function showEngine(info){
  if(phase1)$('engine').textContent=info.model?('模型：'+info.model+(info.busy?' · 使用中':'')):'模型未載入'
}
function openModel(arm){
  if(selectedArm)chats.set(selectedArm,{conversation,elements:[...$('transcript').childNodes],draft:$('message').value})
  selectedArm=arm
  const saved=chats.get(arm)
  conversation=saved?.conversation??null
  $('transcript').replaceChildren(...(saved?.elements||[]))
  $('message').value=saved?.draft||''
  $('status').textContent=saved?'已回到呢個模型嘅原對話。':'已揀模型，送出時載入。'
}
function show(text,kind='assistant'){
  const element=document.createElement('article')
  element.className=kind;element.textContent=text
  $('transcript').append(element);element.scrollIntoView({block:'nearest'})
  return element
}
function request(url,body){
  return fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(sessionStorage.getItem('xxnext')||'')},body:JSON.stringify(body)})
}
async function prepare(){
  const key=decodeURIComponent(location.hash.slice(1))
  if(key){
    const auth=await request('/authorize',{key})
    if(!auth.ok)throw Error('工作階段授權失敗，請用本機入口。')
    sessionStorage.setItem('xxnext',key)
    history.replaceState(null,'','/')
  }
  const response=await fetch('/status',{headers:{authorization:'Bearer '+(sessionStorage.getItem('xxnext')||'')}})
  if(!response.ok)throw Error('請用本機入口開啟。')
  const status=await response.json()
  phase1=status.phase1===true
  if(phase1){
    const chooser=$('arm')
    for(const option of [...chooser.options])if(!status.profiles.includes(option.value))option.remove()
    chooser.querySelector('[value="B"]').textContent='Flash-Next IQ3_S · 輕量對話'
    chooser.querySelector('[value="P"]').hidden=false
    chooser.value='B'
    selectedArm='B'
    $('mode').closest('label').hidden=true
    $('mode').value='chat'
    $('release').hidden=false
    $('engine').hidden=false
    showEngine(status.engine)
    chooser.onchange=()=>openModel(chooser.value)
    $('release').onclick=async()=>{
      $('release').disabled=true
      try{
        const r=await request('/release',{})
        if(!r.ok)throw Error('模型使用中，請等回覆完成。')
        showEngine((await r.json()).engine)
        $('status').textContent='已卸載模型，對話留喺原位。'
      }catch(e){$('status').textContent=e.message}
      finally{$('release').disabled=false}
    }
  }
  $('status').textContent='隔離會話，首次生成須載入模型。'
  $('send').disabled=false
}
$('new').onclick=()=>{
  conversation=null;$('transcript').replaceChildren();$('proposal').hidden=true
  $('arm').disabled=false;$('status').textContent='已開新對話。'
}
$('composer').onsubmit=async e=>{
  e.preventDefault()
  const message=$('message').value
  $('send').disabled=true;$('new').disabled=true;$('arm').disabled=true;$('release').disabled=true
  $('transcript').querySelector('.empty')?.remove()
  show(message,'user');$('status').textContent='本機模型處理中…'
  let assistant=null,finished=false
  try{
    const response=await request('/chat',{arm:$('arm').value,message,conversation,mode:$('mode').value})
    if(!response.ok)throw Error('訊息未完成。')
    const reader=response.body.getReader(),decoder=new TextDecoder()
    let buffer=''
    while(true){
      const {done,value}=await reader.read()
      buffer+=decoder.decode(value,{stream:!done})
      let index
      while((index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index);buffer=buffer.slice(index+1)
        if(!line)continue
        const event=JSON.parse(line)
        if(event.delta){
          assistant ||= show('')
          assistant.textContent+=event.delta
        }
        if(event.error)throw Error('本機回覆未完成（'+event.error+'）。')
        if(event.final){
          conversation=event.conversation
          assistant ||= show('')
          assistant.textContent=event.final.text
          $('message').value=''
          $('status').textContent='完成 · '+event.final.calls+' 次模型呼叫 · '+(event.final.totalMs/1000).toFixed(1)+' 秒'
          finished=true
          if(phase1)showEngine({model:event.final.model,busy:false})
          if(event.final.proposal){
            const box=$('proposal'),button=document.createElement('button')
            box.replaceChildren(document.createTextNode('隔離測試提議　'+event.final.proposal.args.id+'　'+event.final.proposal.args.note+'　'))
            button.textContent='批准測試變更'
            button.onclick=async()=>{
              button.disabled=true
              const r=await request('/approve',{conversation,id:event.final.proposal.id})
              box.textContent=r.ok?'已更新隔離測試記錄。':'未能更新測試記錄。'
            }
            box.append(button);box.hidden=false
          }
        }
      }
      if(done)break
    }
    if(!finished)throw Error('回覆中斷。')
  }catch(error){if(assistant)assistant.remove();show(error.message,'error');$('status').textContent='未完成。'}
  finally{$('send').disabled=false;$('new').disabled=false;$('arm').disabled=!phase1&&Boolean(conversation);$('release').disabled=false}
}
prepare().catch(error=>{$('status').textContent=error.message})
setInterval(async()=>{
  if(!phase1||$('send').disabled||$('release').disabled)return
  try{
    const r=await fetch('/status',{headers:{authorization:'Bearer '+(sessionStorage.getItem('xxnext')||'')}})
    if(r.ok)showEngine((await r.json()).engine)
  }catch{}
},5000)
