'use strict'
// Data-only observation. Native input is brokered separately; no page action is injected.
function collectOperatorPage(){
 const url=location.href,targets=[]
 const add=(id,label,href,e)=>{const r=e.getBoundingClientRect();if(r.width<2||r.height<2||r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight)return;const x=r.left+r.width/2,y=r.top+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))return;targets.push({id,label:label.slice(0,120),href,x:x/innerWidth,y:y/innerHeight})}
 if(url==='http://127.0.0.1:8090/browser-operator-fixture'){for(const id of ['fixture_button','fixture_input']){const e=document.getElementById(id);if(e)add(id,e.getAttribute('aria-label')||e.textContent,url,e)}}
 else for(const a of document.querySelectorAll('a[href]')){if(targets.length>=40)break;if(/^https:\/\/app\.7shifts\.com\/company\/\d+\/employees(?:\/list)?$/.test(a.href))add('target_'+targets.length,a.innerText.trim(),a.href,a)}
 return {scope:{url,tabId:0,windowId:0,width:innerWidth,height:innerHeight},targets}
}
async function operatorPage(scope){
 if(!scope)throw Error('conversation_tab_changed')
 const win=await chrome.windows.get(scope.windowId);if(!win.focused)throw Error('conversation_tab_changed')
 const [tab]=await chrome.tabs.query({active:true,windowId:scope.windowId});if(tab?.id!==scope.tabId)throw Error('conversation_tab_changed')
 const rows=await chrome.scripting.executeScript({target:{tabId:scope.tabId,frameIds:[0]},world:'ISOLATED',func:collectOperatorPage})
 const result=rows.find(r=>r.frameId===0)?.result;if(!result)throw Error('page_access_unavailable_click_extension_icon')
 // Guard before sending any source across the native boundary, including capture.
 if(result.scope.url!=='http://127.0.0.1:8090/browser-operator-fixture'&&!/^https:\/\/app\.7shifts\.com\/(?:company\/\d+\/employees(?:\/list)?|location\/\d+\/schedule\/\d{4}-\d{2}-\d{2})(?:\?[^#]*)?$/.test(result.scope.url))throw Error('operation_scope_unavailable')
 const pageRows=await chrome.scripting.executeScript({target:{tabId:scope.tabId,frameIds:[0]},world:'ISOLATED',func:collectVisiblePage,args:['main_frame_visible_text']})
 const page=pageRows.find(r=>r.frameId===0)?.result;if(!page||page.url!==result.scope.url)throw Error('conversation_tab_changed')
 result.scope.tabId=scope.tabId;result.scope.windowId=scope.windowId;result.text=page.text;return result
}
