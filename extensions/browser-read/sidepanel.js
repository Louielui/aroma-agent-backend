'use strict'
const el=id=>document.getElementById(id)
let capture=null,job=null,busy=false
const ERRORS={native_host_unavailable:'尚未接通本機讀取器，請完成安裝後再試。',page_access_unavailable_click_extension_icon:'無法讀取這個分頁。請先按工具列的香香圖示授權，再試一次。',source_changed:'頁面或分頁已改變，請重新準備及確認。',capture_stale:'頁面快照已過期，請重新準備。',site_not_allowed:'這個網址不在第一期可讀取範圍。',subscription_login_required:'所選模型的 CLI 訂閱需要重新登入。',read_unavailable:'本次讀取未完成；沒有自動重試。',native_reply_unknown_check_saved_result:'尚未收到結果；請重新開啟側欄查看已保存狀態，不要重複送出。'}
async function send(message){const response=await chrome.runtime.sendMessage(message);if(response?.error)throw Error(response.error);if(!response?.result)throw Error('native_host_unavailable');return response.result}
const rpc=body=>send({type:'rpc',body})
function error(e){el('status').textContent=ERRORS[e.message]||('讀取未完成：'+e.message)}
function present(r){
 job=r;el('cancel').hidden=!['awaiting_consent','processing'].includes(r.state)
 if(r.state==='completed'){el('answer').hidden=false;el('text').textContent=r.result.text;el('evidence').textContent=`快照來源：${r.result.source.origin} · ${new Date(r.result.source.capturedAt).toLocaleString()} · 所選 ${r.result.requestedModel} · 實際 ${r.result.actualModel||'未確認'}`;el('status').textContent='讀取完成。這是已保存的頁面快照回答。'}
 else if(r.state==='failed')error(Error(r.error))
 else if(r.state==='cancelled')el('status').textContent='已停止本次讀取；不會自動重試。已送出的模型工作可能仍計入訂閱額度。'
 else if(r.state==='interrupted')el('status').textContent='服務重啟中斷了這次讀取，沒有自動重試。'
 else if(r.state==='processing')el('status').textContent='已送出，等待所選模型回答…'
}
el('prepare').addEventListener('click',async()=>{
 if(busy)return;busy=true;el('prepare').disabled=true;el('read').disabled=true;el('consent').checked=false;el('preview').hidden=true;el('answer').hidden=true
 try{if(job&&['awaiting_consent','processing'].includes(job.state))await rpc({op:'cancel',id:job.id});el('status').textContent='正在核對目前分頁…';capture=await send({type:'capture'});const r=await rpc({op:'prepare',requestId:crypto.randomUUID(),question:el('question').value,source:capture.source});await chrome.storage.local.set({lastReadId:r.id});present(r);el('question').readOnly=true;el('source').textContent=capture.title+' · '+capture.source.url;el('model').textContent='跟隨中央模型：'+r.selection.model+' · '+r.selection.effort;el('coverage').textContent=`主框架可見文字 ${capture.text.length} 字${capture.source.truncated?'（已截斷，不代表完整頁面）':''}；iframe、圖片及輸入欄不在範圍。`;el('excerpt').textContent=capture.text;el('preview').hidden=false;el('status').textContent='尚未呼叫模型。請先確認範圍。'}catch(e){capture=null;error(e)}finally{busy=false;el('prepare').disabled=false}
})
el('consent').addEventListener('change',()=>{el('read').disabled=!el('consent').checked||busy||!capture||job?.state!=='awaiting_consent'})
el('read').addEventListener('click',async()=>{
 if(busy||!capture||!job||!el('consent').checked)return;busy=true;el('read').disabled=true;el('prepare').disabled=true;el('status').textContent='再次核對頁面後交給香香…'
 try{present(await rpc({op:'read',id:job.id,consent:true,source:capture.source,text:capture.text}))}catch(e){error(e)}finally{busy=false;capture=null;el('prepare').disabled=false;el('question').readOnly=false}
})
el('cancel').addEventListener('click',async()=>{if(!job)return;try{present(await rpc({op:'cancel',id:job.id}));capture=null;el('read').disabled=true}catch(e){error(e)}})
chrome.storage.local.get('lastReadId').then(async value=>{if(value.lastReadId){try{present(await rpc({op:'get',id:value.lastReadId}))}catch(e){error(e)}}})
