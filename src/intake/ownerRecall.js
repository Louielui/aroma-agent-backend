'use strict'

const {isValidId} = require('../store/conversationStore')
const {ownerSources} = require('./conversationEvidence')
const {topicOf,safeQuote,historyMatch} = require('../memory/ownerPrinciples')
const {ID: memoryId} = require('../memory/replySources')

const inlinePaste = /^\x60([^\x60\r\n]+)\x60[ \t]*[。．.!！?？]?$/u
const sentenceEnd = /[。．.!！?？]$/u
const repeatedEnding = /[。．.!！?？]{2}$/u
const quotedStatement = /^(?:「([^」]+)」|『([^』]+)』)[。．.!！?？]?$/u
const extraRequest = /(?:順便|另外|同時|再|然後|並|仲要|一併)\s*(?:請|幫|替我|查|改|做|更新|刪除|重啟|部署|送出|派工)|(?:[，,。．.!！?？；;]\s*)(?:請|幫我|替我|麻煩你|把|查|改|更新|刪除|重啟|部署|送出|派工)/u
const address = /^(?:香香[，, ]*)/u
const sameThreadQuestion = /^(?:我(?:剛才|剛剛|啱啱|頭先|先頭)(?:(?:問咗?|講咗)(?:你)?(?:咩|乜嘢|乜)|問了?(?:你)?(?:什麼|甚麼))|我上一句(?:問了什麼|說了什麼|講咗咩))(?:呀|啊|呢)?[？?]?$/u
const quotedPreviousQuestion = /^(?:「([^「」『』]+)」|『([^「」『』]+)』)$/u
const subject = '(?:理念|價值觀|價值观|核心價值|經營原則|管理原則|做事原則)'
const scope = '(?:對\\s*Aroma\\s*(?:嘅|的)?|(?:做|經營)\\s*Aroma\\s*(?:嘅|的)?|個人(?:的|嘅)?|帶團隊(?:的|嘅)?|(?:的|嘅)?(?:Aroma\\s*(?:的|嘅)?)?)'
const question = new RegExp('^(?:(?:你(?:仲記唔記得|記唔記得|知唔知|知道|記得|還記得)|請(?:告訴我|重述))\\s*)?(?:我'+scope+'|Aroma\\s*(?:的|嘅)?)(?:餐飲|經營)?'+subject+'(?:是(?:什麼|甚麼)|係咩)?(?:嗎|嗎呢|呢|呀)?[？?。]?$', 'iu')
const statement = new RegExp('^(?:(更正|更新|修正)[，,：:]\\s*)?(我(?:更新|更正|修正|補充)?(?:\\s*對\\s*Aroma\\s*(?:嘅|的)?|(?:的|嘅)?(?:個人|帶團隊|Aroma)?(?:的|嘅)?)?(?:餐飲|經營)?'+subject+')(其中(?:一點|一條))?(?:(?:是|係|為)[：:]?|[：:])\\s*([\\s\\S]+)$', 'iu')
const selection = /^請(?:查|讀|核對)(?:閱)?舊對話[「『]([^」』\r\n]{1,100})[」』][，,：:]\s*(.+)$/u
const historicalQuestion = /^(?:你(?:仲)?(?:記唔記得|記得|還記得|知道))?(?:我)?(?:以前|以往|之前)(?:(?:有沒有|有冇|曾經|曾)?(?:說過|講過|提過)\s*([^？?。！!；;,，\r\n]{1,200}?)|(?:有冇)?用過(?:什麼|甚麼|咩)(代號|編號))(?:嗎|呀|呢)?[？?]?$/u
const deicticTopic = /^(?:這件事|這個|這個主題|這個話題|呢件事|呢樣嘢|呢個主題)$/u
const topicLead = /^(?:請(?:幫我)?(?:核對|查|看)|(?:我們|我哋)(?:來|一齊)?(?:談|傾))\s*/u
const incidentalTopic = /^(?:謝謝|多謝|好的?|明白|收到|可以|繼續)[。！!]?$/u
const identifierQuestion = /^(?:這次|本次|今次)(?:對話)?(?:的|嘅)?(代號|編號)(?:是(?:什麼|甚麼)|係咩)(?:呀|呢)?[？?]?$/u
const identifierStatement = /^(?:(?:更正|更新|修正)[，,：:]\s*)?(?:這次|本次|今次)(?:對話)?(?:的|嘅)?(代號|編號)(?:是|係|為)[：:]?\s*(?:「([\p{L}\p{N}_-]{1,32})」|『([\p{L}\p{N}_-]{1,32})』|\x60([\p{L}\p{N}_-]{1,32})\x60|([\p{L}\p{N}_-]{1,32}))[。！!]?$/u
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

function recognitionText(raw) {
  const text=raw.trim()
  if (/[\r\n]/u.test(text)) return null
  if (!text.startsWith('\x60')) return text
  // Unwrap only a single inline span occupying the entire turn.
  return inlinePaste.exec(text)?.[1].trim() ?? null
}

function statementValue(body) {
  const value=body.trim()
  if (/^[「『]/u.test(value)) {
    const quoted=quotedStatement.exec(value)
    return quoted?.[1] ?? quoted?.[2] ?? null
  }
  // Do not interpret a follow-on instruction as part of an unquoted declaration.
  return extraRequest.test(value) ? null : value
}

function declarations(messages,topic) {
  const entries=[]
  for (const message of messages) {
    if (!safeQuote(message)) continue
    const text=recognitionText(message)
    const match=text && statement.exec(text)
    if (!match) continue
    const [,update,label,part,body]=match
    const value=statementValue(body)
    if (!safeQuote(value)) continue
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
function quoted(entry,sourceLabel,source,topic) {
  const {quote,prefix}=qualify(entry.text)
  const understanding = topic === 'aroma' ? '\n\n我的理解是，你把這句話用來表達 Aroma 的餐飲經營方向。' : ''
  return reply((entry.partial?'我找到你說過的其中一部分':prefix)+'：「'+quote+'」'+understanding+'\n\n來源：'+sourceLabel+'。',source)
}

function fromDeclarations(entries,sourceLabel,source) {
  if (!entries.length) return null
  if (entries.length>1) {
    if (new Set(entries.map(item=>item.topic)).size>1) return clarifyTopic()
    return reply('我找到多個不同說法，還無法核對你最後確認的是哪一個。你想先核對哪個版本？',source)
  }
  return quoted(entries[0],sourceLabel,source,entries[0].topic)
}

function historicalSubject(match, previous) {
  const query = (match[1] ?? match[2]).trim().replace(/^[「『](.*)[」』]$/u,'$1')
  if (!deicticTopic.test(query)) return query
  const contextual = previous?.replace(topicLead,'').replace(/[。？?！!]+$/u,'').trim()
  return contextual && contextual.length >= 2 && contextual.length <= 200 && !incidentalTopic.test(contextual) &&
    !deicticTopic.test(contextual) && safeQuote(contextual) ? contextual : null
}

async function historicalReply(match, previous, readHistory) {
  const query = historicalSubject(match,previous)
  if (!query || !safeQuote(query)) return reply('你想核對以前說過的哪一句或哪個主題？')
  let records
  try { records = await readHistory?.(query) } catch (_) {}
  if (!Array.isArray(records)) return reply('我目前讀不到保存的歷史記憶，暫時無法核對。')
  const relevant = records.filter(r => memoryId.test(r.id||'') && Number.isSafeInteger(r.version) &&
    safeQuote(r.text) && historyMatch(r.text,query))
  if (!relevant.length) return reply('已查保存的歷史記憶，暫時未找到符合「'+query+'」的本人原話。')
  if (relevant.length === 1) {
    const record = relevant[0]
    return quoted(record,'歷史記憶第 '+record.version+' 版（'+record.id+'）',{kind:'historical_memory',id:record.id,version:record.version})
  }
  const excerpts = relevant.slice(0,3).map(record => (record.partial||record.text.length>800?'節錄 ':'')+
    '「'+qualify(record.text).quote+'」（'+record.id+'，第 '+record.version+' 版）')
  return reply('在歷史記憶找到以下本人原話。\n\n'+excerpts.join('\n'),{kind:'historical_memory',ids:relevant.slice(0,3).map(r=>r.id)})
}

const literalIdentifier = binding => binding.slice(2).find(value => value !== undefined)

function suppliedCurrentIdentifier(history, field) {
  for (let index = (history?.length ?? 0) - 1; index >= 0; index--) {
    const text = recognitionText(history[index])
    const binding = text && identifierStatement.exec(text)
    if (binding?.[1] === field && safeQuote(history[index])) return literalIdentifier(binding)
  }
  return null
}

async function answerOwnerRecall(message,token,{readApproved,readConversation,readHistory} = {}) {
  const normalized=message.trim(),owners=ownerSources(token)
  const history=owners?.at(-1)===normalized?owners.slice(0,-1):null
  const recognized=recognitionText(normalized)
  if (!recognized) return null
  const requested=recognized.replace(address,'')
  const questionText=repeatedEnding.test(requested) ? '' : requested.replace(sentenceEnd,'')
  // A full quotation can wrap a previous-turn question. Keep the raw turn as evidence.
  const quotedPrevious=quotedPreviousQuestion.exec(questionText.trimEnd())
  const previousQuestion=quotedPrevious ? (quotedPrevious[1]??quotedPrevious[2]).trim() : questionText
  if (sameThreadQuestion.test(previousQuestion)) {
    const previous=history?.at(-1)
    if (!safeQuote(previous)) return reply('我目前無法核對這段對話裡你的上一句。')
    const {quote}=qualify(previous), clipped=previous.length>800
    const isQuestion=/[？?]$|(?:嗎|咩|呢)$/u.test(previous)
    const lead=clipped?'你上一句的開頭是':isQuestion?'你剛才問我':'你上一句是'
    return reply(lead+'「'+quote+'」。',{kind:'current_conversation',excerpt:clipped})
  }
  const update=/^(?:我(?:更新|更正|修正|補充)|(?:更正|更新|修正)[，,：:])/u.test(recognized)
  const supplied=history && update && declarations([normalized],null)[0]
  if (supplied) {
    const {quote,prefix}=qualify(supplied.text)
    return reply((supplied.text.length>800?prefix:'我會以你現在的說法為準')+'：「'+quote+'」。',
      {kind:'current_owner_statement',excerpt:supplied.text.length>800})
  }
  const declaration = identifierStatement.exec(requested)
  if (declaration && history && safeQuote(requested)) {
    return reply('這次的'+declaration[1]+'是「'+literalIdentifier(declaration)+'」。',{kind:'current_owner_statement'})
  }
  const identifier = identifierQuestion.exec(questionText)
  if (identifier) {
    const value = suppliedCurrentIdentifier(history,identifier[1])
    return value ? reply('這次的'+identifier[1]+'是「'+value+'」。',{kind:'current_conversation'}) :
      reply('我目前無法從這段對話核對這次的'+identifier[1]+'。')
  }
  const selected=selection.exec(questionText)
  const asked=selected?.[2]??questionText
  const historical=extraRequest.test(asked) ? null : historicalQuestion.exec(asked)
  if (historical && !selected) return historicalReply(historical,history?.at(-1),readHistory)
  if (!historical && !question.test(asked)) return null
  const explicitTopic=topicOf(asked)
  const scopedTopic=explicitTopic || history?.slice(-3).map(topicOf).findLast(Boolean)
  if (selected) {
    let found
    try {found=await readConversation?.(selected[1])} catch (_) {}
    if (found?.state==='ambiguous') return reply('有不止一串符合。請給我完整標題或對話 ID。')
    if (found?.state==='missing') return reply('我找不到你指定的那串舊對話。')
    if (found?.state!=='found') return reply('我目前讀不到你指定的舊對話。')
    const old=found.conversation, input=Array.isArray(old.messages)?old.messages.filter(m=>m.role==='user').map(m=>m.content??m.text):[]
    if (historical) {
      const query = historicalSubject(historical,null)
      if (!query || !safeQuote(query)) return reply('你想在這串舊對話核對哪一句或哪個主題？')
      const exact = input.find(text => safeQuote(text) && historyMatch(text,query))
      return exact ? quoted({text:exact},'你指定的舊對話「'+old.title+'」',{kind:'selected_conversation',id:old.id}) :
        reply('我查了你指定的舊對話，未找到符合「'+query+'」的本人原話。')
    }
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
    {kind:'approved_memory',id:record.id,version:record.version},topicOf(record.subject))
}

module.exports = {answerOwnerRecall, resolveConversationReference}
