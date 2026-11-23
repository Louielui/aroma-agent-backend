
'use strict'

const { ownerSources } = require('./conversationEvidence')

const hypothetical = /^(?:作個假設|一個虛構例子|純虛構練習|虛構(?:備料題|備貨|練習|題)|純假設|假設|假设)\s*[：:，,。]?\s*/u
const operating = /庫存|库存|現貨|现货|查詢|查询|查|讀取|读取|核對|核对|盤點|盘点|實際|实际|真實|真实|正式|系統|系统|落單|落单|下單|下单|出單|出单|送單|送单|訂單|订单|訂貨|订货|採購|采购|批准|執行|执行|通知|派工|提交|上網|上网|付款|轉帳|转账|刪除|删除|寄信|發送|发送|打電話|打电话|上傳|上传|部署|幫我買|帮我买/u
const site = '([\\p{Script=Han}]{1,5}店)'
const quantity = '(\\d{1,7}(?:\\.\\d{1,3})?)\\s*(mL|毫升|kg|公斤|L|公升|g|克|份|個|个)'
const food = '(?:雲吞|云吞|蒸點|蒸点|甜品|凍茶|冻茶|茶|燒賣|烧卖|沙律|麵糰|面团|包|醬|酱)'
const packageUnit = '(盤|盘|盒|箱|瓶|樽|袋|批)'
const pattern = s => new RegExp('^' + s + '$', 'iu')
const row = pattern(site + '(?:聽日|明天)?\\s*(?:需|需要|要)\\s*' + quantity + '\\s*(' + food + ')?')
const missingRow = pattern(site + '份量未定')
const unnamedRows = pattern('(?:兩店|两店|兩間(?:虛構)?分店|两间(?:虚构)?分店)(?:分別)?要\\s*' + quantity + '\\s*(?:同|和|及)\\s*' + quantity + '\\s*(' + food + ')?')
const capacity = pattern('(?:中央)?(?:每|一)' + packageUnit + '(?:可裝|可装|裝|装|做到|做|可做|用)?\\s*' + quantity)
const bottle = pattern('用\\s*' + quantity + '\\s*(瓶|樽)')
const capacityChange = pattern('每' + packageUnit + '改(?:做|為|成)?\\s*' + quantity)
const byPortion = pattern('每份' + food + '?用\\s*' + quantity)
const totalSupply = pattern('用\\s*' + quantity + '\\s*' + food + '?')
const servingCount = pattern('同一批做\\s*(\\d{1,7})\\s*份')
const namedUnchanged = pattern(site + '(?:其他|仍|同每(盒|盤|箱)(?:容量|份量))?照舊')
const demandChange = pattern('(?:係)?' + site + '\\s*(只要|要|改做|改為|改成|最終要|少|減|加)\\s*' + quantity)
const indexedChange = pattern('(第一間|第二間|細嗰間|嗰間)\\s*(只要|要|改做|改為|改成|少|減|加)\\s*' + quantity)
const servingsChange = pattern('份數改(?:做|成|為)\\s*(\\d{1,7})')
const reserve = pattern('留起\\s*' + quantity + '\\s*下次用')

const measureUnits = Object.freeze({
  'mL': ['volume', 1], '毫升': ['volume', 1], 'L': ['volume', 1000], '公升': ['volume', 1000],
  'kg': ['mass', 1000], '公斤': ['mass', 1000], 'g': ['mass', 1], '克': ['mass', 1],
  '份': ['portions', 1], '個': ['items', 1], '个': ['items', 1]
})
const unitName = { volume: 'mL', mass: 'g', portions: '份', items: '個' }
const maxValue = 1000000000

function measure(text, unit) {
  const normalized = { ml:'mL', l:'L', kg:'kg', g:'g' }[unit.toLowerCase()] || unit
  const [kind, factor] = measureUnits[normalized]
  const [integer, fraction = ''] = text.split('.')
  const thousandths = Number(integer) * 1000 + Number(fraction.padEnd(3, '0'))
  const value = thousandths * factor / 1000
  return Number.isSafeInteger(value) && value <= maxValue ? { kind, value } : null
}

function clauses(text) {
  if (text.length > 600 || operating.test(text)) return null
  const parts = text.replace(/[。！？!?；;，,]\s*$/u, '').split(/[。，,；;、！？!?]\s*/u).map(x=>x.trim())
  return parts.length && parts.length <= 12 && parts.every(Boolean) ? parts : null
}

function namedLabel(name) {
  // Keep instructions out of name positions even when they end in the word 店.
  return !/幫我|帮我|請|请|順便|顺便|同埋|更新|修改|先|再|改|要|需|問|问|同時|同时|買|买|賣|卖|睇/u.test(name)
}

function setDemand(s, label, amount, product) {
  if ((amount && s.kind && amount.kind !== s.kind) || (product && s.product && product !== s.product) || s.demands.length === 2 || s.demands.some(x=>x.label === label)) return false
  s.kind ||= amount?.kind
  s.product ||= product ?? null
  s.demands.push({label, amount})
  return true
}

function bindingCap(s, unit, amount, change) {
  if (!amount || amount.value === 0 || (!change && s.size) ||
      (s.kind && amount.kind !== s.kind) || (s.package && s.package !== unit.replace('盘', '盤'))) return false
  s.kind ||= amount.kind
  s.size = amount.value
  s.package = unit.replace('盘', '盤')
  return true
}

const pooled = /^(?:合併(?:裝(?:盒|箱|盤)?|分裝|計)?|凍茶可以合併分裝|兩店加埋|改做可以混裝|可以混裝)$/u
const separate = /^(?:兩店一定要分開裝|兩店分開裝)$/u
const requestQualifier = /^(?:如欠資料|先問我)$/u

function packMatches(s, pack) {
  if (s.package && s.package !== pack) return false
  s.package = pack
  return true
}

function cookingRule(s, part, touched) {
  if (pooled.test(part) || separate.test(part)) {
    const requestedPack = /^合併裝([盒箱盤])$/u.exec(part)?.[1]
    if (touched.has('grouping') || s.demands.length !== 2 || (requestedPack && !packMatches(s,requestedPack))) return false
    touched.add('grouping')
    s.separate = separate.test(part)
    return true
  }
  if (/^只(?:做|計)整(?:盤|盒)$/u.test(part)) return packMatches(s, part.at(-1))
  if (part==='只能開整袋') return packMatches(s,'袋')
  if (part==='唔做半盤') return packMatches(s,'盤')
  if (part==='每箱可未裝滿'||part==='兩店份量同箱容量照舊') return packMatches(s,'箱')
  if (part==='做完一盤先開下一盤') return !!s.supply && packMatches(s,'盤')
  return false
}

const packQuestion = /^(?:(?:總共要預|總共要|需要|要|合併需|合計做|合併計要|合併計|合併裝|兩店加埋要|我想知要|依家要|各用|合共|總共)?(?:幾多|幾|多少)(盤|盒|箱|瓶|樽|袋|批))$/u

function consumeQuestion(s, part) {
  const count = packQuestion.exec(part)
  if (count) {
    if (part.startsWith('合併')) s.requiresPool=true
    return packMatches(s,count[1])
  }
  if (/^要準備幾(?:多)?個瓶$/u.test(part)) return packMatches(s,'瓶')
  if (/^(?:可以做足|今次可做|可做足)(?:幾多|幾)整盤$/u.test(part)) return !!s.supply && packMatches(s,'盤')
  if (/^(?:最後一瓶裝(?:幾多|幾)\s*(?:mL|毫升)|再計瓶數同最後一瓶)$/iu.test(part)) {
    if (s.kind!=='volume'||!packMatches(s,'瓶')) return false
    s.lastFill=true
    return true
  }
  if (/^(?:會多|多出嚟|多)(?:幾多|幾)份$/u.test(part)) return s.kind==='portions'&&!s.separate
  if (part==='整盤數同多出嚟嘅份數係幾多') return s.kind==='portions'&&!s.separate&&packMatches(s,'盤')
  if (/^留起嗰份以外仲剩(?:幾多|幾)克$/u.test(part)) return !!s.supply&&s.reserveSpecified
  if (/^(?:(?:同埋剩|剩|最後剩|今次剩)(?:幾多|幾)\s*(?:g|克))$/iu.test(part)) return !!(s.rate||s.supply)
  if (part==='仲係幾袋') return !!s.rate&&packMatches(s,'袋')
  if (/^(?:請列兩店數量|請列兩店)$/u.test(part)) return s.demands.length===2
  if (part==='總數同盒數') return s.demands.length===2&&packMatches(s,'盒')
  if (/^(?:總數同盤數|幫我更新兩店明細同盤數)$/u.test(part)) return s.demands.length===2&&packMatches(s,'盤')
  return /^(?:再計|重新計|重新計算|補返答案)$/u.test(part)
}

function initial(text) {
  const start = hypothetical.exec(text)
  if (!start) return null
  const parts = clauses(text.slice(start[0].length))
  if (!parts) return null
  const s = { demands:[], kind:null, package:null, size:null, separate:false, rate:null, servings:null, supply:null, reserved:0, reserveSpecified:false, pending:null, product:null, lastFill:false, requiresPool:false }
  let request = false
  const touched = new Set()
  for (const part of parts) {
    let m
    if ((m=row.exec(part))) {
      const amount = measure(m[2],m[3])
      if (!amount || !namedLabel(m[1]) || !setDemand(s,m[1],amount,m[4])) return null
    } else if ((m=missingRow.exec(part))) {
      if (!namedLabel(m[1]) || !setDemand(s,m[1],null)) return null
    } else if ((m=unnamedRows.exec(part))) {
      const first=measure(m[1],m[2]), second=measure(m[3],m[4])
      if (s.demands.length || !first || !second || !setDemand(s,'第一間',first) || !setDemand(s,'第二間',second,m[5])) return null
    } else if ((m=capacity.exec(part))) {
      if (!bindingCap(s,m[1],measure(m[2],m[3]),false)) return null
    } else if ((m=bottle.exec(part))) {
      if (!bindingCap(s,m[3],measure(m[1],m[2]),false)) return null
    } else if ((m=byPortion.exec(part))) {
      if (s.rate || (s.kind && s.kind!=='mass')) return null
      s.kind='mass'
      s.rate=measure(m[1],m[2])
      if (s.rate?.kind!=='mass') return null
    } else if ((m=servingCount.exec(part))) {
      if (s.servings!==null) return null
      s.servings=Number(m[1])
    } else if ((m=totalSupply.exec(part))) {
      if (s.supply || (s.kind && s.kind!=='mass')) return null
      s.supply=measure(m[1],m[2])
      if (s.supply?.kind!=='mass') return null
      s.kind='mass'
    } else if (requestQualifier.test(part) || cookingRule(s,part,touched)) {
      continue
    } else {
      if (!consumeQuestion(s,part)) return null
      request=true
    }
  }
  if (!request || !s.package || !s.kind || (s.requiresPool && s.separate)) return null
  if (s.supply) return s.kind==='mass'&&s.package==='盤'&&!s.demands.length&&!s.rate&&s.servings===null ? s : null
  if (s.rate) return s.kind==='mass'&&s.package==='袋'&&!s.demands.length ? s : null
  return s.demands.length===2&&s.servings===null ? s : null
}

function getEditTarget(s,label) {
  if (label==='第一間'||label==='第二間') return s.demands[label==='第一間'?0:1]
  if (label!=='細嗰間') return s.demands.find(x=>x.label===label)
  const [a,b]=s.demands
  if (!a?.amount||!b?.amount||a.amount.value===b.amount.value) return undefined
  return a.amount.value<b.amount.value?a:b
}

function follow(s,text) {
  const parts=clauses(text)
  if (!parts) return null
  const next=structuredClone(s)
  next.requiresPool=false
  let changed=false
  let absoluteNeeded=false
  const touched=new Set()
  for (const part of parts) {
    let m
    if ((m=demandChange.exec(part)||indexedChange.exec(part))) {
      const [,,verb,n,u]=m
      const amount=measure(n,u)
      if (!amount||amount.kind!==s.kind||!s.demands.length||touched.has('demand')) return null
      const delta=/^(?:少|減|加)$/u.test(verb)
      if (absoluteNeeded&&delta) return null
      const target=getEditTarget(next,m[1])
      if (!target&&!['嗰間','細嗰間'].includes(m[1])) return null
      if (!target) {
        if (next.pending) return null
        next.pending={verb,amount}
      } else {
        if (next.pending && (verb!==next.pending.verb||amount.value!==next.pending.amount.value)) return null
        if (delta && !target.amount) return null
        const value=delta?target.amount.value+(verb==='加'?1:-1)*amount.value:amount.value
        if (!Number.isSafeInteger(value)||value<0||value>maxValue) return null
        target.amount={kind:amount.kind,value}
        next.pending=null
      }
      absoluteNeeded=false
      touched.add('demand')
      changed=true
    } else if ((m=capacityChange.exec(part)||capacity.exec(part))) {
      if(touched.has('size')||!bindingCap(next,m[1],measure(m[2],m[3]),true))return null
      touched.add('size')
      changed=true
    } else if ((m=servingsChange.exec(part))) {
      if(!next.rate||touched.has('servings'))return null
      next.servings=Number(m[1])
      touched.add('servings')
      changed=true
    } else if ((m=reserve.exec(part))) {
      const amount=measure(m[1],m[2])
      if(!next.supply||!amount||amount.kind!=='mass'||amount.value>next.supply.value||touched.has('reserve'))return null
      next.reserved=amount.value
      next.reserveSpecified=true
      touched.add('reserve')
      changed=true
    } else if (/^(?:唔係\s*\d{1,7}|改一改|更正)$/u.test(part)) {
      absoluteNeeded=true
    } else if (/^剛才講(?:少|減)\s*\d{1,7}\s*(?:個|份)取消$/u.test(part)) {
      absoluteNeeded=true
    } else if (/^(?:其他照舊|其他都照舊|其餘照舊)$/u.test(part) ||
      (next.demands.length===2&&/^(?:兩店|第一間)照舊$/u.test(part))) {
      continue
    } else if ((m=namedUnchanged.exec(part))) {
      if (!next.demands.some(x=>x.label===m[1]) || (m[2] && next.package!==m[2])) return null
    } else if (requestQualifier.test(part) || cookingRule(next,part,touched)) {
      changed ||= next.separate!==s.separate
    } else if (!consumeQuestion(next,part)) return null
  }
  return changed&&!absoluteNeeded&&!(next.requiresPool&&next.separate) ? next : null
}

// Quantities have already been normalized to whole base units. Keep pack
// surplus and final fill bound to the same quotient.
function fill(demand, cap) {
  const count=Math.floor((demand+cap-1)/cap)
  const surplus=count*cap-demand
  return { count, surplus, lastFill:count===0?null:cap-surplus }
}

function render(s) {
  if (s.pending) return '你指'+s.demands[0].label+'定'+s.demands[1].label+'？'
  if (s.rate&&s.servings===null) return '今次要做幾多份？'
  if (s.lastFill&&s.separate) return '你指邊間店最後一'+s.package+'？'
  const missing=s.demands.find(x=>!x.amount)
  if (missing) return missing.label+'要幾多'+unitName[s.kind]+'？'
  const parts=s.demands.map(x=>x.amount.value)
  const summary=s.demands.map(x=>x.label+' '+x.amount.value+' '+unitName[s.kind]).join('、')
  const total=s.supply?s.supply.value-s.reserved:s.rate?s.rate.value*s.servings:parts.reduce((n,v)=>n+v,0)
  if(!Number.isSafeInteger(total)||total<0||total>maxValue)return null
  const unit=unitName[s.kind], pack=s.package
  if (!s.size) return (summary?summary+'，合共 '+total+' '+unit+'。':'')+'每'+pack+'幾多 '+unit+'？'
  if(s.supply){
    const count=Math.floor(total/s.size)
    return '今次可用 '+total+' '+unit+'，可做 '+count+' '+pack+'，另外剩 '+(total%s.size)+' '+unit+'。'
  }
  if(s.separate&&s.demands.length===2){
    const groups=parts.map(value=>fill(value,s.size))
    const combined=groups[0].count+groups[1].count
    return s.demands.map((x,i)=>x.label+' '+x.amount.value+' '+unit+'，用 '+groups[i].count+' '+pack+'，剩 '+groups[i].surplus+' '+unit+' 容量').join('。')+'。合共 '+combined+' '+pack+'。'
  }
  const {count,surplus,lastFill}=fill(total,s.size)
  const prefix=(summary?summary+'，':'')+'合共 '+total+' '+unit+'，每'+pack+' '+s.size+' '+unit+'，要 '+count+' '+pack+'。'
  if(s.kind==='volume'&&(pack==='瓶'||pack==='樽'))return prefix+(count?'最後一'+pack+' ' +lastFill+' '+unit+'。':'')
  return prefix+(s.rate?'剩 ':'多 ')+surplus+' '+unit+'。'
}

function answer(message, token) {
  const texts=ownerSources(token)
  if (!texts||typeof message!=='string'||texts.at(-1)!==message.trim()) return null
  let anchor=texts.length-1
  for (;anchor>=0&&!hypothetical.test(texts[anchor]);anchor--) {}
  if (anchor<0||texts.length-anchor>16) return null
  let scenario=initial(texts[anchor])
  for(const text of texts.slice(anchor+1)){
    if(!scenario)return null
    scenario=follow(scenario,text)
  }
  const reply=scenario&&render(scenario)
  return reply?{reply}:null
}

module.exports={answer}
