'use strict'
let operation=null,operatorRunning=false
Object.assign(ERRORS,{operation_native_acceptance_required:'需要先在本機測試頁完成真實滑鼠、鍵盤及停止驗收；7shifts 操作尚未開放。',operation_scope_unavailable:'目前只接受本機測試頁或已驗收的 7shifts 員工清單導覽。',operation_execution_conflict:'其他執行通道正在開啟，本次操作已拒絕。',browser_url_unverified:'無法獨立核對 Chrome 位址列網址，沒有送出滑鼠或鍵盤動作。',browser_viewport_unverified:'無法核對 Chrome 網頁範圍，沒有送出滑鼠或鍵盤動作。',browser_viewport_ambiguous:'目前有多個可能的網頁範圍，沒有送出滑鼠或鍵盤動作。',browser_foreground_changed:'目前前景視窗已改變，操作已拒絕。',operation_window_changed:'操作視窗的位置或範圍已改變，操作已拒絕。',native_input_unknown:'原生輸入結果未確認，已停止，不會重試。'})
const mode=document.createElement('option');mode.value='browser_control';mode.textContent='操控網頁';el('coverage-mode').append(mode)
const operatorSend=body=>send(body)
function showOperation(r){
 operation=r;el('status').textContent=r.state==='ready'?'正在核對畫面…':r.state==='completed'?'已根據操作後的畫面回答。':r.state==='stopped'?'已停止，不會接着操作。':r.state==='failed'?'本次操作未完成：'+r.error:'正在操作…'
 if(r.state==='completed'){
  const rows=topicRecord.operatorMessages||[];rows.push({question:el('question').value,text:r.result.text,requestedModel:r.result.requestedModel,actualModel:r.result.actualModel,steps:r.result.steps});topicRecord.operatorMessages=rows.slice(-10);topicRecord.mode='browser_control';topicRecord.draft='';el('question').value='';saveTopic().catch(error);renderOperations()
 }
}
function renderOperations(){
 if(!topicRecord.operatorMessages?.length)return
 el('welcome').hidden=true;el('messages').replaceChildren();el('answer').hidden=true
 for(const row of topicRecord.operatorMessages){const q=document.createElement('div');q.className='message user';q.textContent=row.question;const a=document.createElement('div');a.className='message assistant';a.textContent=row.text;el('messages').append(q,a)}
 const last=topicRecord.operatorMessages.at(-1);const details=document.createElement('details'),summary=document.createElement('summary'),metadata=document.createElement('p');summary.textContent='來源與模型';metadata.textContent='7shifts / 本機測試頁 · 所選 '+last.requestedModel+' · 實際 '+last.actualModel+' · 原生操作 '+last.steps+' 步';metadata.className='note';details.append(summary,metadata);el('messages').append(details)
}
function setOperatorMode(){const on=el('coverage-mode').value==='browser_control';el('operator-scope').hidden=!on;if(on){el('context-chip').textContent='網頁操作 · 畫面與可見文字';renderOperations()}}
el('coverage-mode').addEventListener('change',setOperatorMode)
async function runOperation(){
 if(busy||!topic)return;if(!el('question').value.trim()){el('status').textContent='請輸入要香香完成的查閱任務。';return}if(!el('operator-consent').checked){el('status').textContent='請先確認這次分頁操作與畫面讀取範圍。';return}
 busy=true;operatorRunning=true;operation=null;el('prepare').disabled=true;el('question').readOnly=true;el('cancel').hidden=false;el('preview').hidden=true
 try{
  if(job&&['awaiting_consent','processing'].includes(job.state))await rpc({op:'cancel',id:job.id})
  const r=await operatorSend({type:'operator_start',question:el('question').value,consent:true});showOperation(r)
  if(!operatorRunning){showOperation(await operatorSend({type:'operator_stop',id:r.id}));return}
  while(operatorRunning&&operation.state==='ready'){
   const next=await operatorSend({type:'operator_next',id:operation.id});showOperation(next)
   if(next.state==='ready')await new Promise(resolve=>setTimeout(resolve,600))
  }
 }catch(e){error(e);const reason=el('status').textContent;if(operation)try{operation=await operatorSend({type:'operator_stop',id:operation.id});el('status').textContent=reason+'；已停止後續動作。'}catch{el('status').textContent=reason+'；停止狀態未確認，不會再發出下一步。'}}finally{busy=false;operatorRunning=false;el('prepare').disabled=false;el('question').readOnly=false;el('cancel').hidden=true;el('operator-consent').checked=false}
}
el('composer').addEventListener('submit',e=>{if(el('coverage-mode').value!=='browser_control')return;e.preventDefault();e.stopImmediatePropagation();runOperation()},{capture:true})
el('question').addEventListener('keydown',e=>{if(el('coverage-mode').value==='browser_control'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();runOperation()}},{capture:true})
el('cancel').addEventListener('click',async e=>{if(!operatorRunning)return;e.preventDefault();e.stopImmediatePropagation();operatorRunning=false;el('status').textContent='正在停止…';if(operation)try{showOperation(await operatorSend({type:'operator_stop',id:operation.id}))}catch(error){el('status').textContent='停止狀態未確認；不會再發出下一個動作。'}},{capture:true})
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&operatorRunning)el('cancel').dispatchEvent(new MouseEvent('click',{bubbles:true}))})
// Topic restore is asynchronous. Observe the existing composer readiness rather
// than invoking a provider or restoring any unfinished native job.
const restoreObserver=new MutationObserver(()=>{if(topic&&!el('prepare').disabled){setOperatorMode();restoreObserver.disconnect()}});restoreObserver.observe(el('prepare'),{attributes:true,attributeFilter:['disabled']})
if(topic&&!el('prepare').disabled){if(topicRecord.mode==='browser_control')el('coverage-mode').value='browser_control';setOperatorMode();restoreObserver.disconnect()}
