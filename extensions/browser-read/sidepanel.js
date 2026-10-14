'use strict'
const el=id=>document.getElementById(id)
let capture=null,job=null,busy=false,generation=0
const ERRORS={selection_text_unavailable:'請先在網頁選取可見文字，再傳送。',conversation_source_changed:'對話來源已改變。請按「新對話」讀取這個頁面。',conversation_limit_reached:'這段對話已達 8 輪，請開新對話繼續。',conversation_unavailable:'上次對話無法恢復，請開新對話。',native_host_unavailable:'尚未接通本機讀取器，請完成安裝後再試。',page_access_unavailable_click_extension_icon:'無法讀取這個分頁。請先按工具列的香香圖示授權，再試一次。',source_changed:'頁面或分頁已改變，請重新準備及確認。',capture_stale:'頁面快照已過期，請重新準備。',site_not_allowed:'這個網址不在第一期可讀取範圍。',subscription_login_required:'所選模型的 CLI 訂閱需要重新登入。',read_unavailable:'本次讀取未完成；沒有自動重試。',native_reply_unknown_check_saved_result:'尚未收到結果；請重新開啟側欄查看已保存狀態，不要重複送出。'}
async function send(message){const response=await chrome.runtime.sendMessage(message);if(response?.error)throw Error(response.error);if(!response?.result)throw Error('native_host_unavailable');return response.result}
const rpc=body=>send({type:'rpc',body})
async function capturePanelPage(){const window=await chrome.windows.getCurrent();return send({type:'capture',windowId:window.id,coverage:el('coverage-mode').value})}
function error(e){if(e.message==='native_reply_unknown_check_saved_result')el('recover').hidden=false;el('status').textContent=ERRORS[e.message]||('讀取未完成：'+e.message)}
function present(r){
 job=r;el('recover').hidden=r.state!=='processing';el('welcome').hidden=true;el('messages').replaceChildren();
 const rows=r.messages||[{id:r.id,question:r.question,state:r.state,result:r.result}];
 for(const m of rows){const question=m.id===r.id?r.question:m.question;if(question){const q=document.createElement('div');q.className='message user';q.textContent=question+(m.questionTruncated?'（已截短）':'');el('messages').append(q)}if(m.result&&m.id!==r.id){const a=document.createElement('div');a.className='message assistant';a.textContent=m.result.text+(m.result.truncated?'\n（先前回答已截短；完整回答保留在本機）':'');el('messages').append(a)}}
 el('coverage-mode').disabled=rows.some(m=>m.state==='completed');
 el('answer').hidden=r.state!=='completed';el('cancel').hidden=!['awaiting_consent','processing'].includes(r.state)
 if(r.state==='completed'){
  el('answer').hidden=false;el('text').textContent=r.result.text
  const source=r.result.source,tool=r.result.taskEvidence
  el('evidence').textContent=(tool?`資料來源：7shifts · ${tool.retrievedAt} · ${tool.complete?'範圍完整':'未完整／未能讀取'}`:source?`快照來源：${source.origin} · ${new Date(source.capturedAt).toLocaleString()}`:'任務回答 · 未讀取網頁')+` · 所選 ${r.result.requestedModel} · 實際 ${r.result.actualModel||'未確認'}`
  el('context-chip').textContent=source?(source.coverage==='selection_text'?'選取文字':'網頁快照')+' · '+source.origin:'任務 · 不讀取網頁'
  el('coverage-mode').value=source?(source.coverage||'main_frame_visible_text'):'task_only';el('status').textContent='可以接着追問；每次會重新確認讀取範圍。'
 }
 else if(r.state==='failed')error(Error(r.error))
 else if(r.state==='cancelled')el('status').textContent='已停止本次讀取；不會自動重試。已送出的模型工作可能仍計入訂閱額度。'
 else if(r.state==='interrupted')el('status').textContent='服務重啟中斷了這次讀取，沒有自動重試。'
 else if(r.state==='processing')el('status').textContent='已送出，等待所選模型回答…'
}
async function prepare(){
 if(busy)return;if(!el('question').value.trim()){el('status').textContent='請輸入你想問香香的問題。';return}const version=generation;busy=true;el('prepare').disabled=true;el('read').disabled=true;el('consent').checked=false;el('preview').hidden=true;el('answer').hidden=true
 try{
  if(job&&['awaiting_consent','processing'].includes(job.state))await rpc({op:'cancel',id:job.id})
  const taskOnly=el('coverage-mode').value==='task_only';el('status').textContent=taskOnly?'正在準備任務範圍…':'正在核對目前分頁…'
  capture=taskOnly?{taskOnly:true}:await capturePanelPage()
  const parentId=job?.messages?.findLast(m=>m.state==='completed')?.id||(job?.state==='completed'?job.id:null)
  const r=await rpc({op:'prepare',requestId:crypto.randomUUID(),question:el('question').value,...(taskOnly?{}:{source:capture.source,taskVersion:1}),...(parentId?{parentId}:{})})
  if(version!==generation)return;await chrome.storage.local.set({lastReadId:r.id});present(r);el('question').readOnly=true
  el('source').textContent=taskOnly?'任務模式：沒有讀取目前網頁。':capture.title+' · '+capture.source.url
  el('model').textContent='跟隨中央模型：'+r.selection.model+' · '+r.selection.effort
  el('context-chip').textContent=taskOnly?'任務 · 不讀取網頁':(capture.source.coverage==='selection_text'?'選取文字':'目前網頁')+' · '+capture.title
  el('coverage').textContent=(taskOnly?'沒有網頁快照。':`${capture.source.coverage==='selection_text'?'選取文字':'主框架可見文字'} ${capture.text.length} 字${capture.source.truncated?'（已截斷）':''}。`)+`含 ${r.messages?.length? r.messages.length-1:0} 輪先前對話${r.historyTruncated?'（部分回答截短至 2,000 字）':''}。圖片、iframe、輸入欄未讀取。`
  el('task-scope').textContent=r.taskCapabilities?.length?'佢可按你的要求，唯讀查詢 7shifts 公司 '+r.taskCapabilities[0].companyId+' 的員工姓名、在職狀態、目前薪率與職位；可包含非在職及管理帳號。查詢結果會外送予上述模型；回答保留本機。不會修改員工、薪率、排班或 payroll。':'本次未接通可用的公司查詢工具；佢會說明資料缺漏。'
  el('excerpt').textContent=taskOnly?el('question').value:capture.text;el('history-details').hidden=!parentId
  el('history-preview').textContent=(r.messages||[]).filter(m=>m.result).map(m=>'你：'+m.question+'\n香香：'+m.result.text+(m.result.truncated?'\n（回答已截短）':'')).join('\n\n')
  el('preview').hidden=false;el('status').textContent='尚未呼叫模型。請先確認範圍。'
 }catch(e){capture=null;error(e)}finally{busy=false;el('prepare').disabled=false}
}
el('composer').addEventListener('submit',e=>{e.preventDefault();prepare()})
el('question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();prepare()}})
el('consent').addEventListener('change',()=>{el('read').disabled=!el('consent').checked||busy||!capture||job?.state!=='awaiting_consent'})
el('read').addEventListener('click',async()=>{
 if(busy||!capture||!job||!el('consent').checked)return;busy=true;el('read').disabled=true;el('prepare').disabled=true;el('status').textContent='再次核對頁面後交給香香…'
 const version=generation;el('preview').hidden=true;try{const r=await rpc({op:'read',id:job.id,consent:true,...(capture.taskOnly?{}:{source:capture.source,text:capture.text})});if(version!==generation)return;present(r);if(r.state==='completed')el('question').value=''}catch(e){error(e)}finally{busy=false;capture=null;el('prepare').disabled=false;el('question').readOnly=false}
})
el('cancel').addEventListener('click',async()=>{if(!job)return;try{present(await rpc({op:'cancel',id:job.id}));capture=null;el('preview').hidden=true;el('read').disabled=true;el('question').readOnly=false}catch(e){error(e)}})
el('recover').addEventListener('click',async()=>{if(!job)return;try{present(await rpc({op:'get',id:job.id}))}catch(e){error(e)}})
el('dismiss').addEventListener('click',async()=>{if(job?.state==='awaiting_consent'){try{present(await rpc({op:'cancel',id:job.id}))}catch(e){error(e);return}}capture=null;el('preview').hidden=true;el('question').readOnly=false;el('read').disabled=true;el('status').textContent='已返回編輯，尚未外送。'})
 el('new-chat').addEventListener('click',async()=>{if(busy){el('status').textContent='請先停止這次讀取，再開新對話。';return}generation++;if(job?.state==='awaiting_consent'){try{await rpc({op:'cancel',id:job.id})}catch(e){error(e);return}}try{await chrome.storage.local.remove('lastReadId')}catch{el('status').textContent='本機對話狀態未清除，請稍後再試。';return}job=null;capture=null;el('recover').hidden=true;el('cancel').hidden=true;el('messages').replaceChildren();el('answer').hidden=true;el('preview').hidden=true;el('welcome').hidden=false;el('question').value='';el('question').readOnly=false;el('coverage-mode').disabled=false;el('context-chip').textContent='尚未加入網頁內容';el('status').textContent=''})
 const restoreVersion=generation;chrome.storage.local.get('lastReadId').then(async value=>{if(value.lastReadId){try{const r=await rpc({op:'get',id:value.lastReadId});if(restoreVersion===generation&&!busy)present(r)}catch(e){if(restoreVersion===generation&&!busy)error(e)}}})
