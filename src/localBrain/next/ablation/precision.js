'use strict'

const ID=/^[a-z0-9][a-z0-9_]{0,23}$/
const DECIMAL=/^(-?)(\d{1,24})(?:\.(\d{1,16}))?$/
const CIVIL=/^\d{4}-\d{2}-\d{2}$/
const CLOCK=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const DAY=86400000
const MINUTE=60000
const WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const abs=n=>n<0n?-n:n
const fail=()=>{throw Error('exact_calculation_invalid')}
function fraction(n,d=1n){
  if(d===0n||n.toString().length>400||d.toString().length>400)fail()
  if(d<0n){n=-n;d=-d}
  let a=abs(n),b=d
  while(b){const remainder=a%b;a=b;b=remainder}
  return {n:n/a,d:d/a}
}
function arithmetic(text){
  const tokens=text.match(/\d{1,24}(?:\.\d{1,16})?|[()+*/-]/g)||[]
  if(!tokens.length||tokens.length>48||tokens.join('')!==text.replace(/\s/g,''))fail()
  let position=0
  function atom(){
    const token=tokens[position++]
    if(token==='-'||token==='+'){
      const value=atom()
      return token==='-'?fraction(-value.n,value.d):value
    }
    if(token==='('){
      const value=sum()
      if(tokens[position++]!==')')fail()
      return value
    }
    if(!token||!DECIMAL.test(token))fail()
    return numeric(token)
  }
  function product(){
    let value=atom()
    while(tokens[position]==='*'||tokens[position]==='/'){
      const op=tokens[position++],right=atom()
      value=op==='*'?fraction(value.n*right.n,value.d*right.d):fraction(value.n*right.d,value.d*right.n)
    }
    return value
  }
  function sum(){
    let value=product()
    while(tokens[position]==='+'||tokens[position]==='-'){
      const op=tokens[position++],right=product()
      value=fraction(value.n*right.d+(op==='+'?1n:-1n)*right.n*value.d,value.d*right.d)
    }
    return value
  }
  const result=sum()
  if(position!==tokens.length)fail()
  return result
}
function numeric(value){
  if(typeof value==='object')return value
  const m=value.match(DECIMAL)
  if(!m)return arithmetic(value)
  const places=m[3]||''
  return fraction(BigInt(m[1]+m[2]+places),10n**BigInt(places.length))
}
function integer(value){
  const a=numeric(value)
  if(a.d!==1n||abs(a.n)>1000000n)fail()
  return Number(a.n)
}
function format(a){
  if(typeof a==='string')return a
  const negative=a.n<0n?'-':''
  let left=abs(a.n),q=(left/a.d).toString(),digits=''
  left%=a.d
  for(let i=0;left&&i<24;i++){
    left*=10n
    digits+=(left/a.d).toString()
    left%=a.d
  }
  if(left)return a.n.toString()+'/'+a.d.toString()
  return negative+q+(digits?'.'+digits:'')
}
function civil(value,withTime){
  if(typeof value!=='string'||!(withTime?CLOCK:CIVIL).test(value))fail()
  const date=new Date(value+(withTime?':00Z':'T00:00:00Z'))
  if(!Number.isFinite(+date)||date.toISOString().slice(0,withTime?16:10)!==value)fail()
  return +date
}
function shifted(a,b,minutes){
  const iso=new Date(civil(a,minutes)+integer(b)*(minutes?MINUTE:DAY)).toISOString()
  if(!/^\d{4}-/.test(iso))fail()
  return iso.slice(0,minutes?16:10)
}
function rounded(a,b){
  const x=numeric(a),places=integer(b)
  if(places<0||places>16)fail()
  const scale=10n**BigInt(places),m=abs(x.n)*scale
  const magnitude=m/x.d+(m%x.d*2n>=x.d?1n:0n)
  return fraction(x.n<0n?-magnitude:magnitude,scale)
}
const binary=(fn)=>(a,b)=>fn(numeric(a),numeric(b))
const OPS=Object.freeze({
  add:binary((a,b)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d)),
  subtract:binary((a,b)=>fraction(a.n*b.d-b.n*a.d,a.d*b.d)),
  multiply:binary((a,b)=>fraction(a.n*b.n,a.d*b.d)),
  divide:binary((a,b)=>fraction(a.n*b.d,a.d*b.n)),
  percent:binary((a,b)=>fraction(100n*a.n*b.d,a.d*b.n)),
  round:rounded,
  shift_days:(a,b)=>shifted(a,b,false),
  shift_minutes:(a,b)=>shifted(a,b,true),
  minutes_between:(a,b)=>fraction(BigInt((civil(b,true)-civil(a,true))/MINUTE)),
  weekday:value=>WEEKDAYS[new Date(civil(value,false)).getUTCDay()]
})
function calculate(input){
  const steps=input?.steps
  if(!Array.isArray(steps)||!steps.length||steps.length>24||Object.keys(input).length!==1)fail()
  const results=new Map()
  for(const step of steps){
    if(!step||Object.keys(step).length!==3||typeof step.id!=='string'||!ID.test(step.id)||
      results.has(step.id)||typeof step.op!=='string'||!Object.hasOwn(OPS,step.op)||!Array.isArray(step.values)||
      step.values.length!==(step.op==='weekday'?1:2))fail()
    const values=step.values.map(v=>{
      if(typeof v!=='string'||v.length>60)fail()
      if(!v.startsWith('$'))return v
      if(!results.has(v.slice(1)))fail()
      return results.get(v.slice(1))
    })
    results.set(step.id,OPS[step.op](...values))
  }
  return Object.fromEntries([...results].map(([id,value])=>[id,format(value)]))
}
module.exports={calculate,OPS}
