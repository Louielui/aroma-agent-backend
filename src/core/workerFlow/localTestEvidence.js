'use strict'
const {createHash}=require('node:crypto'),path=require('node:path').posix
const sha=text=>createHash('sha256').update(text).digest('hex')
// This is a bounded lexical evidence index, not a JS evaluator or a proof of
// correctness. Ambiguous slash tails and template bodies provide no anchors.
function codeMask(text){
 const out=text.split('');let i=0
 const hide=end=>{for(;i<end;i++)if(text[i]!=='\n'&&text[i]!=='\r')out[i]=' '}
 while(i<text.length){
  if(text.startsWith('//',i)){const e=text.indexOf('\n',i);hide(e<0?text.length:e);continue}
  if(text.startsWith('/*',i)){const e=text.indexOf('*/',i+2);hide(e<0?text.length:e+2);continue}
  if(text[i]==='`'){hide(text.length);continue}
  if(['\'', '"'].includes(text[i])){const q=text[i];let e=i+1;for(;e<text.length;e++){if(text[e]==='\\'){e++;continue}if(text[e]===q){e++;break}}hide(e);continue}
  if(text[i]==='/'){const e=text.indexOf('\n',i);hide(e<0?text.length:e);continue}
  i++
 }
 return out.join('')
}
function imports(file,text,source){
 const mask=codeMask(text),out=[],resolve=value=>{if(!value.startsWith('.'))return null;const name=path.normalize(path.join(path.dirname(file),value));return[name,name+'.js',name+'.cjs',name+'/index.js'].find(n=>Object.hasOwn(source,n))||null}
 const re=/\brequire\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g
 for(const m of text.matchAll(re)){
  if(mask.slice(m.index,m.index+7)!=='require'||mask.slice(0,m.index).trimEnd().endsWith('.'))continue
  const name=resolve(m[2]);if(!name)continue
  const before=mask.slice(Math.max(0,m.index-500),m.index),destructured=/\{\s*([\w$\s,:]+)\s*\}\s*=\s*$/.exec(before),single=/\b([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before)
  if(destructured){for(const item of destructured[1].split(',')){const v=item.trim().split(/\s*:\s*/);if(v.every(n=>/^[A-Za-z_$][\w$]*$/.test(n)))out.push({file:name,symbol:v[0],local:v[1]||v[0],kind:'named'})}}
  else if(single)out.push({file:name,symbol:'default',local:single[1],kind:'module'})
  else {
   // Only a direct dot-member invocation has a named inline subject. A property
   // reference, computed member or longer chain is not evidence of that call.
   const tail=mask.slice(m.index+m[0].length),member=/^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(tail)
   if(member||/^\s*\(/.test(tail))out.push({file:name,symbol:member?.[1]||'default',local:null,kind:'inline',offset:m.index})
  }
 }
 return out
}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
function catalogue(tests,source,criteria,binding=''){
 const files=Object.entries(tests).map(([file,text])=>{
  const mask=codeMask(text),bindings=imports(file,text,source);let offset=0
  const lines=text.split('\n').map((quote,i)=>{
   const code=mask.slice(offset,offset+quote.length),start=offset;offset+=quote.length+1
   const assertion=/\bassert\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual|notDeepEqual|notDeepStrictEqual|ok|throws|rejects|match|doesNotThrow|doesNotReject)\s*\(/.test(code)
   const subjects=assertion?bindings.flatMap(b=>{
    if(b.kind==='named'&&new RegExp('\\b'+escape(b.local)+'\\s*\\(').test(code))return[{file:b.file,symbol:b.symbol}]
    if(b.kind==='module'){const re=new RegExp('\\b'+escape(b.local)+'(?:\\s*\\.\\s*([A-Za-z_$][\\w$]*))?\\s*\\(','g');return[...code.matchAll(re)].map(m=>({file:b.file,symbol:m[1]||'default'}))}
    return b.kind==='inline'&&b.offset>=start&&b.offset<offset?[{file:b.file,symbol:b.symbol}]:[]
   }):[]
   return{line:i+1,text:quote,anchorId:'a'+sha(JSON.stringify([binding,file,sha(text),i+1,quote])).slice(0,24),kind:assertion?'assertion':'reference',subjects}
  })
  return{file,sha256:sha(text),lines}
 })
 const symbols=[]
 for(const [file,text]of Object.entries(source)){
  const mask=codeMask(text),re=/\bmodule\s*\.\s*exports\s*=\s*\{([^}]+)\}/g
  for(const m of mask.matchAll(re))for(const part of m[1].split(',')){const symbol=part.trim().split(/\s*:/)[0];if(/^[A-Za-z_$][\w$]*$/.test(symbol))symbols.push({file,symbol})}
 }
 for(const f of files)for(const b of imports(f.file,tests[f.file],source))if(b.kind==='named'||b.kind==='inline'&&b.symbol!=='default')symbols.push({file:b.file,symbol:b.symbol})
 const required=criteria.map(text=>[...new Map(symbols.filter(s=>new RegExp('(?:^|[^\\w$])'+escape(s.symbol)+'(?:$|[^\\w$])').test(text)).map(s=>[s.file+'#'+s.symbol,s])).values()])
 return{files,required}
}
module.exports={catalogue,codeMask}
