'use strict'
// Parse a bounded data-expression subset. No eval, VM execution or source import.
const constants=new Set(['MAX_SAFE_INTEGER','MIN_SAFE_INTEGER','MAX_VALUE','MIN_VALUE','EPSILON','NaN','POSITIVE_INFINITY','NEGATIVE_INFINITY'])
function invalid(){const e=Error('invalid_worker_result');e.casePlanFailure='expression';throw e}
function expression(source){
 if(typeof source!=='string'||!source.trim()||source.length>600)invalid()
 const tokens=[];let i=0
 while(i<source.length){
  if(/\s/.test(source[i])){i++;continue}
  if(tokens.length>=256)invalid()
  const start=i,q=source[i]
  if(q==='"'||q==="'"){
   let value='';i++;let closed=false
   while(i<source.length){const c=source[i++];if(c===q){closed=true;break}if(c==='\n'||c==='\r')invalid();if(c!=='\\'){value+=c;continue}
    const e=source[i++],map={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0','\\':'\\',"'":"'",'"':'"'}
    if(Object.hasOwn(map,e)){if(e==='0'&&/[0-9]/.test(source[i]||''))invalid();value+=map[e]}
    else if(e==='u'||e==='x'){const length=e==='u'?4:2,hex=source.slice(i,i+length);if(!new RegExp('^[a-fA-F0-9]{'+length+'}$').test(hex))invalid();value+=String.fromCharCode(parseInt(hex,16));i+=length}else invalid()
   }
   if(!closed)invalid();tokens.push({kind:'string',value});continue
  }
  const number=/^(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?n?/.exec(source.slice(i))
  if(number){const raw=number[0];if(raw.endsWith('n')&&/[.eE]/.test(raw))invalid();tokens.push({kind:raw.endsWith('n')?'bigint':'number',value:raw});i+=raw.length;continue}
  const name=/^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i));if(name){tokens.push({kind:'name',value:name[0]});i+=name[0].length;continue}
  if('()+-*/%[],{}:.'.includes(q)){tokens.push({kind:q,value:q});i++;continue}
  if(i===start)invalid()
 }
 let at=0;const take=kind=>{if(tokens[at]?.kind!==kind)invalid();return tokens[at++]},is=kind=>tokens[at]?.kind===kind,precedence={'+':1,'-':1,'*':2,'/':2,'%':2}
 function expr(min=0,depth=0){
  if(depth>24)invalid();let left
  if(is('+')||is('-')){const op=tokens[at++].kind;left=['unary',op,expr(3,depth+1)]}
  else if(is('(')){at++;left=expr(0,depth+1);take(')')}
  else if(is('[')){at++;const items=[];if(!is(']'))for(;;){items.push(expr(0,depth+1));if(!is(','))break;at++;if(is(']'))break}take(']');left=['array',items]}
  else if(is('{')){at++;const pairs=[],seen=new Set();if(!is('}'))for(;;){const key=tokens[at++];if(!key||!['name','string'].includes(key.kind)||['__proto__','constructor','prototype'].includes(key.value)||seen.has(key.value))invalid();seen.add(key.value);take(':');pairs.push([key.value,expr(0,depth+1)]);if(!is(','))break;at++;if(is('}'))break}take('}');left=['object',pairs]}
  else if(['number','bigint','string'].includes(tokens[at]?.kind)){const t=tokens[at++];left=[t.kind,t.value]}
  else if(is('name')){const n=tokens[at++].value
   if(['true','false','null','undefined','NaN','Infinity'].includes(n))left=['literal',n]
   else if(n==='Number'){take('.');const c=take('name').value;if(!constants.has(c))invalid();left=['constant',c]}
   else if(n==='BigInt'){take('(');left=['BigInt',expr(0,depth+1)];take(')')}
   else invalid()
  }else invalid()
  while(Object.hasOwn(precedence,tokens[at]?.kind)&&precedence[tokens[at].kind]>=min){const op=tokens[at++].kind;left=['binary',op,left,expr(precedence[op]+1,depth+1)]}
  return left
 }
 const result=expr();if(at!==tokens.length)invalid();return JSON.stringify(result)
}
module.exports={expression}
