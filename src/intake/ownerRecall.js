'use strict'

const {isValidId} = require('../store/conversationStore')
const {ownerSources} = require('./conversationEvidence')
const {topicOf,safeQuote} = require('../memory/ownerPrinciples')
const {ID: memoryId} = require('../memory/replySources')

const sameThreadQuestion = /^(?:我(?:剛才|剛剛|啱啱)(?:問了?你(?:什麼|甚麼)|問咗咩|問了什麼)|我上一句(?:問了什麼|說了什麼|講咗咩))[？?]?$/u
const subject = '(?:理念|價值觀|價值观|核心價值|經營原則|管理原則|做事原則)'
const scope = '(?:對\\s*Aroma\\s*(?:嘅|的)?|個人(?:的|嘅)?|帶團隊(?:的|嘅)?|(?:的|嘅)?(?:Aroma\\s*(?:的|嘅)?)?)'
const question = new RegExp('^(?:香香[，, ]*)?(?:(?:你(?:知唔知|知道|記得|還記得)|請(?:告訴我|重述))\\s*)?(?:我'+scope+'|Aroma\\s*(?:的|嘅)?)(?:餐飲|經營)?'+subject+'(?:是(?:什麼|甚麼)|係咩)?(?:嗎|嗎呢|呢)?[？?。]?$', 'iu')
const statement = new RegExp('^(?:(更正|更新|修正)[，,：:]\\s*)?(我(?:更新|更正|修正|補充)?(?:\\s*對\\s*Aroma\\s*(?:嘅|的)?|(?:的|嘅)?(?:個人|帶團隊|Aroma)?(?:的|嘅)?)?(?:餐飲|經營)?'+subject+')(其中(?:一點|一條))?(?:(?:是|係|為)[：:]?|[：:])\\s*([\\s\\S]+)$', 'iu')
const selection = /^請(?:查|讀|核對)(?:閱)?舊對話[「『]([^」』\r\n]{1,100})[」』][，,：:]\s*(.+)$/u
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',year:'numeric',month:'2-digit',day:'2-digit'})

function resolveConversationReference(store,reference) {
  // A title or date is a selection, never a path or a fuzzy archive search.
  const isId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reference)
  if (isId) {
    const conversation=store.get(reference)
    return conversation?.id===reference ? {state:'found',conversation} : {state:'missing'}
  }
  const isDate=/^\d{4}-\d{2}-\d{2}$/.test(reference)
  const matches=store.list({strict:true}).filter(row=>isValidId(row.id) && (isDate
    ? !!row.createdAt && Number.isFinite(Date.parse(row.createdAt)) && dateFormat.format(new Date(row.createdAt))===reference
    : row.title===reference))
  if (matches.length!==1) return {state:matches.length?'ambiguous':'missing'}
  const conversation=store.get(matches[0].id)
  if (!conversation||conversation.id!==matches[0].id||conversation.title!==matches[0].title) return {state:'missing'}
  return {state:'found',conversation}
}

function declarations(messages,topic) {
  const entries=[]
  for (const message of messages) {
    const match=statement.exec(message)
    if (!match || !safeQuote(message)) continue
    const [,update,label,part,body]=match
    const value=body.trim().replace(/^(?:「([\s\S]+)」|『([\s\S]+)』)$/u,(_,a,b)=>a??b)
    const group=topicOf(label)
    if (topic && group!==topic) continue
    const isUpdate=!!update || /^我(?:更新|更正|修正)/u.test(label)
    if (isUpdate) {
      for(let i=entries.length-1;i>=0;i--)if(entries[i].topic===group)entries.splice(i,1)
    }
    if (!entries.some(item=>item.text===value&&item.topic===group)) entries.push({text:value,topic:group,partial:!!part})
  }
  return entries
}

const reply = (text, source = null) => ({blocked:false,mode:'chat',intent:'question',reply:text,replyForArchive:text,
  tasks:[],risks:[],decision:null,...(source?{ownerRecallSource:source}:{})})
const clarifyTopic = () => reply('你指 Aroma 嘅餐飲理念，定係你個人做事或帶團隊嘅理念？')
const qualify = text => text.length>800 ? {quote:text.slice(0,800),prefix:'我找到這段記錄的開頭（摘錄）'} : {quote:text,prefix:'我找到這段原文'}
function quoted(entry,sourceLabel,source) {
  const {quote,prefix}=qualify(entry.text)
  return reply((entry.partial?'我找到你說過的其中一部分':prefix)+'：「'+quote+'」\n\n來源：'+sourceLabel+'。',source)
}

function fromDeclarations(entries,sourceLabel,source) {
  if (!entries.length) return null
  if (entries.length>1) {
    if (new Set(entries.map(item=>item.topic)).size>1) return clarifyTopic()
    return reply('我找到多個不同說法，還無法核對你最後確認的是哪一個。你想先核對哪個版本？',source)
  }
  return quoted(entries[0],sourceLabel,source)
}

async function answerOwnerRecall(message,token,{readApproved,readConversation} = {}) {
  const normalized=message.trim(),owners=ownerSources(token)
  const history=owners?.at(-1)===normalized?owners.slice(0,-1):null
  if (sameThreadQuestion.test(normalized)) {
    const previous=history?.at(-1)
    if (!safeQuote(previous)) return reply('我目前無法核對這段對話裡你的上一句。')
    const {quote}=qualify(previous), clipped=previous.length>800
    const isQuestion=/[？?]$|(?:嗎|咩|呢)$/u.test(previous)
    const lead=clipped?'你上一句的開頭是':isQuestion?'你剛才問我':'你上一句是'
    return reply(lead+'「'+quote+'」。',{kind:'current_conversation',excerpt:clipped})
  }
  const update=/^(?:我(?:更新|更正|修正|補充)|(?:更正|更新|修正)[，,：:])/u.test(normalized)
  const supplied=update && declarations([normalized],null)[0]
  if (supplied) {
    const {quote,prefix}=qualify(supplied.text)
    return reply((supplied.text.length>800?prefix:'我會以你現在的說法為準')+'：「'+quote+'」。',
      {kind:'current_owner_statement',excerpt:supplied.text.length>800})
  }
  const selected=selection.exec(normalized)
  const asked=selected?.[2]??normalized
  if (!question.test(asked)) return null
  const explicitTopic=topicOf(asked), scopedTopic=explicitTopic || topicOf(history?.at(-1)||'')
  if (selected) {
    let found
    try {found=await readConversation?.(selected[1])} catch (_) {}
    if (found?.state==='ambiguous') return reply('有不止一串符合。請給我完整標題或對話 ID。')
    if (found?.state==='missing') return reply('我找不到你指定的那串舊對話。')
    if (found?.state!=='found') return reply('我目前讀不到你指定的舊對話。')
    const old=found.conversation, input=Array.isArray(old.messages)?old.messages.filter(m=>m.role==='user').map(m=>m.content??m.text):[]
    return fromDeclarations(declarations(input.filter(safeQuote),explicitTopic),'你指定的舊對話「'+old.title+'」',{kind:'selected_conversation',id:old.id}) ||
      reply('我查了你指定的舊對話，未找到你在該串明確表達的理念。')
  }
  const direct=fromDeclarations(declarations(history??[],scopedTopic),'這段對話裡你的原話',{kind:'current_conversation'})
  if (direct) return direct
  let records
  try { records=await readApproved?.() } catch (_) {}
  if (!Array.isArray(records)) return reply('我目前讀不到已確認的記憶。若你指的是同一串提過的理念，可以指出那一段。')
  const safe=records.filter(r=>memoryId.test(r.id||'')&&Number.isSafeInteger(r.version)&&typeof r.subject==='string'&&safeQuote(r.text))
  const relevant=scopedTopic?safe.filter(r=>topicOf(r.subject)===scopedTopic):safe
  const distinct=[...new Map(relevant.map(r=>[JSON.stringify([topicOf(r.subject),r.text]),r])).values()]
  if (!distinct.length) return reply('我查了已保存的記憶，暫時未找到你親自確認過的理念。如果你記得其中一句，可以用那句再查。')
  if (distinct.length>1) {
    if (new Set(distinct.map(r=>topicOf(r.subject))).size>1) return clarifyTopic()
    return reply('我找到多筆已確認的理念紀錄，還無法判定你指哪一筆。你想核對哪個主題或版本？')
  }
  const record=distinct[0]
  return quoted(record,'已確認記憶「'+record.subject+'」，第 '+record.version+' 版（'+record.id+'）',
    {kind:'approved_memory',id:record.id,version:record.version})
}

module.exports = {answerOwnerRecall, resolveConversationReference}
