'use strict'
// This fixed function is injected into the isolated world, never model code.
function collectVisiblePage(){
 const root=document.querySelector('main')||document.body
 if(!root)throw Error('page_text_unavailable')
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),parts=[]
 let node,count=0,length=0,truncated=false
 while((node=walker.nextNode())){
  if(++count>5000){truncated=true;break}
  const parent=node.parentElement
  if(!parent||parent.closest('input,textarea,select,script,style,noscript,[contenteditable],[hidden],[aria-hidden="true"]'))continue
  const style=getComputedStyle(parent)
  if(style.display==='none'||style.visibility==='hidden'||!parent.getClientRects().length)continue
  const text=node.textContent.replace(/\s+/g,' ').trim();if(!text)continue
  const room=6000-length-1;if(room<=0){truncated=true;break}
  const piece=text.slice(0,room);parts.push(piece);length+=piece.length+1
  if(piece.length<text.length){truncated=true;break}
 }
 const url=new URL(location.href);url.search='';url.hash='';url.username='';url.password=''
 return{url:url.href,text:parts.join('\n'),title:document.title.slice(0,200),truncated}
}
if(typeof module!=='undefined')module.exports={collectVisiblePage}
