'use strict'
// This fixed function is injected into the isolated world, never model code.
function collectVisiblePage(coverage='main_frame_visible_text'){
 if(!['main_frame_visible_text','selection_text'].includes(coverage))throw Error('invalid_request')
 const root=document.querySelector('main')||document.body
 if(!root)throw Error('page_text_unavailable')
 const selected=coverage==='selection_text'?getSelection():null
 if(coverage==='selection_text'&&(!selected||selected.isCollapsed||selected.rangeCount!==1))throw Error('selection_text_unavailable')
 const range=selected?.getRangeAt(0)
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),parts=[]
 let node,count=0,length=0,truncated=false
 while((node=walker.nextNode())){
  if(++count>5000){truncated=true;break}
  const parent=node.parentElement
  if(!parent||parent.closest('input,textarea,select,script,style,noscript,[contenteditable],[hidden],[aria-hidden="true"]'))continue
  const style=getComputedStyle(parent)
  if(style.display==='none'||style.visibility==='hidden'||!parent.getClientRects().length)continue
  if(range&&!range.intersectsNode(node))continue
  let value=node.textContent
  if(range){const start=range.startContainer===node?range.startOffset:0,end=range.endContainer===node?range.endOffset:value.length;value=value.slice(start,end)}
  const text=value.replace(/\s+/g,' ').trim();if(!text)continue
  const room=6000-length-1;if(room<=0){truncated=true;break}
  const piece=text.slice(0,room);parts.push(piece);length+=piece.length+1
  if(piece.length<text.length){truncated=true;break}
 }
 const url=new URL(location.href);url.search='';url.hash='';url.username='';url.password=''
 if(coverage==='selection_text'&&!parts.length)throw Error('selection_text_unavailable')
 return{url:url.href,text:parts.join('\n'),title:document.title.slice(0,200),truncated,coverage}
}
if(typeof module!=='undefined')module.exports={collectVisiblePage}
