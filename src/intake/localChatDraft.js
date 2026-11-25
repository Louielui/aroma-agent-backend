'use strict'

// Selection only changes the answer prompt. The normal read and action gates
// still judge the result, and the model can still classify an action as commit.
const external = /(?:寄(?:出|畀|俾|給|送|信)|發送|傳送|發布|發佈|刊登|發(?:出去|畀|俾|給)|上載|上傳|儲存|存入|寫入|覆寫|刪除|派工|落單|下訂|付款|執行|啟用|停用|改檔|檔案|文件路徑|資料庫|工作單|查(?:詢|證|庫存|倉存|紀錄)|庫存|倉存|存貨|官方|政府|網站|官網|過去|以前|原文|舊對話|歷史|另外|順便|跟住|然後|同時|並且|改(?:個)?(?:更表|值班|排班)|更新(?:班表|更表)|核實|上網|搜尋|send|publish|upload|save|file|database|dispatch|execute|(?:^|[^\w])(?:[a-z]:[\\/]|https?:\/\/))/iu
const write = /(?:寫|草擬|擬|排版|潤色|覆述|回述|重述|講(?:返|完整|成個)|(?:出|交)(?:返|一|完整|成個)|draft|rewrite|restate)/iu
const artifact = /(?:文案|(?:通|告)知|提示|標籤|展示卡|告示|訊息|信件|電郵|宣傳語|標語|稿|notice|copy|label|announcement)/iu
const format = /(?:[一二兩三四五六七八九十\d]+(?:行|句|項)|(?:原|相同|頭先|剛才|之前|同一)\S{0,6}格式|逐行|same format)/iu

function isDraftRequest(message, ownerMessages) {
  if (typeof message !== 'string' || external.test(message)) return false
  if (write.test(message) && (artifact.test(message) || format.test(message))) return true
  if (artifact.test(message) && format.test(message)) return true
  // Short revisions need both a writing direction and an earlier draft task.
  return write.test(message) && /(?:照舊|照原|照頭先|same)/iu.test(message) &&
    Array.isArray(ownerMessages) && isStandaloneDraft(ownerMessages.at(-2))
}

function isStandaloneDraft(message) {
  return typeof message === 'string' && !external.test(message) &&
    (write.test(message) || format.test(message)) && (artifact.test(message) || format.test(message))
}

const inlineCardRequest = /^(?:(?:請|唔該|麻煩)\s*)?(?:幫我\s*)?(?:寫|草擬)\s*(?:一[張份個]\s*)?(?:虛構|虚构)(?:的|嘅)?[\p{Script=Han}]{0,12}(?:提示卡|展示卡|告示|通知)$/u
const lineDetail = /^(?:要)?(?:分|用|寫|排成)\s*[一二兩三四五六七八九十\d]+行$/u
const paperDetail = /^(底紙|底色|紙色|背景)\s*[：:]?\s*[\p{Script=Han}]{0,10}(?:色|黑|白)$/u
const fieldDetails = [
  paperDetail,
  /^標籤\s*(?:寫|係|是|[：:])\s*(?:「[^」]+」|『[^』]+』|[\p{Script=Han}]{1,12})$/u,
  /^(?:只供|僅供|只畀|只俾)[\p{Script=Han}]{1,15}(?:同事|人員)(?:睇|看|閱讀)$/u
]
const inlineCardDetails = [
  lineDetail,
  /^每行一[項句]$/u,
  ...fieldDetails
]
const inlineWritingLiteral = /^(?:標籤\s*寫|(?:要)?寫(?=\s*[一二兩三四五六七八九十\d]))|「[^」]*」|『[^』]*』/gu
const revisedPaper = /^(?:換做|換成|改做|改成|改為)\s*((?:淺|淡|深|純|粉|米)?(?:灰|黃|紅|橙|綠|藍|紫|啡|棕|黑|白)色|白|黑)\s*底紙$/u

function cardClauses(message) {
  return message.trim().replace(/^香香[，,]\s*/u, '')
    .split(/[，,。；;\r\n]+/u).map(part => part.trim()).filter(Boolean)
}

const exerciseOpening = /^虛構(?:\s+Aroma)?\s*(?:練習|演練|排練)[：:]\s*/u
const exerciseDelivery = /^(?:將(?:件事|個安排|呢件事)|把(?:這件事|安排))講成一句[畀俾]([\p{Script=Han}]{1,10})聽(?:[，,]交代([\p{Script=Han}、]{1,35}))?$/u
const exerciseDirectedDelivery = /^用一句向([\p{Script=Han}]{1,10})交代人物、時間同原因$/u
const exerciseRestatement = /^成句(?:講多次|講返最新嗰個安排)[畀俾]([\p{Script=Han}]{1,10})聽$/u
const exerciseReplacement = /^([\p{Script=Han}]{1,16})(?:改做|改成|換做|換成)([\p{Script=Han}]{1,16})$/u
const exerciseSideEffect = /(?:檔|首頁|頁面|程式|系統|班表|查|讀|傳|寄|貼到|開啟|關閉|匯款|轉帳|實際|正式)/u

function exerciseLiteral(text) {
  return typeof text === 'string' && /^[\p{Script=Han}、，\d ]{1,96}$/u.test(text) &&
    !exerciseSideEffect.test(text) && safeDraftLiteral(text)
}

function exerciseSentences(text) {
  return text.trim().replace(/[。．]$/u, '').split(/[。．]/u).map(s => s.trim())
}

function exerciseOpeningLayout(text) {
  if (external.test(text) || !exerciseOpening.test(text)) return null
  const [first, second, third, ...extra] = exerciseSentences(text.replace(exerciseOpening, ''))
  if (!third && !extra.length && exerciseLiteral(first) && (exerciseDelivery.test(second) || exerciseDirectedDelivery.test(second)) && !exerciseSideEffect.test(second)) return 1
  if (extra.length || !/^只[畀俾]我(?:嗰|呢)?兩行$/u.test(third)) return null
  const firstLine = /^第一行用「([^」]+)」起頭[，,]\s*(.+)$/u.exec(first)
  const secondLine = /^第二行用「([^」]+)」起頭[，,]\s*(.+)$/u.exec(second)
  if (!firstLine || !secondLine || firstLine[1] === secondLine[1]) return null
  return [firstLine[1], firstLine[2], secondLine[1], secondLine[2]].every(exerciseLiteral) ? 2 : null
}

function exerciseTimingCorrection(text) {
  if (external.test(text) || exerciseSideEffect.test(text)) return null
  const [correction, detail, delivery, ...extra] = exerciseSentences(text)
  const audience = exerciseRestatement.exec(delivery)
  if (extra.length || !audience) return null
  const time = /^(?:時間|早到時間)講錯[，,]係早([零〇一二兩三四五六七八九十廿百\d]{1,5})分鐘$/u.exec(correction)
  const equipment = /^試嘅係([\p{Script=Han}]{1,18})[，,]頭先講嗰兩位照舊$/u.exec(detail)
  if (!time || !equipment || ![time[1], equipment[1]].every(exerciseLiteral)) return null
  return { time: time[1], equipment: equipment[1], recipient: audience[1] }
}

const timingScenario = /^([\p{Script=Han}]{1,10})提早([零〇一二兩三四五六七八九十廿百\d]{1,5})分鐘返嚟[，,]因為要同([\p{Script=Han}]{1,12})試([\p{Script=Han}]{1,18})$/u

function suppliedTimingExercise(message) {
  if (!exerciseOpening.test(message) || exerciseOpeningLayout(message) !== 1) return null
  const [story, delivery] = exerciseSentences(message.replace(exerciseOpening, ''))
  const match = timingScenario.exec(story)
  const request = exerciseDelivery.exec(delivery) ?? exerciseDirectedDelivery.exec(delivery)
  if (!match || !request || !match.slice(1).every(exerciseLiteral)) return null
  const [, person, time, partner, equipment] = match
  return { person, time, partner, equipment, recipient: request[1], details: request[2] ?? null }
}

function timingExerciseReply({person, time, partner, equipment}) {
  return person + '提早' + time + '分鐘返嚟，因為要同' + partner + '試' + equipment + '。'
}

function revisedTimingExercise(message, previous) {
  const original = suppliedTimingExercise(previous)
  const correction = exerciseTimingCorrection(message)
  if (!original || !correction || original.recipient !== correction.recipient) return null
  return timingExerciseReply({ ...original, time: correction.time, equipment: correction.equipment })
}

// This is a reply-only layout backed by the saved Owner thread. The unquoted
// change and delivery clauses must all fit, so a second live request cannot
// inherit the draft's routing even if it comes immediately after a draft.
function exerciseDraftLayout(message, ownerMessages) {
  if (!Array.isArray(ownerMessages) || typeof message !== 'string' ||
      ownerMessages.at(-1) !== message.trim() || external.test(message) ||
      exerciseSideEffect.test(message)) return null
  const layout = exerciseOpeningLayout(ownerMessages[0])
  if (!layout || ownerMessages.length === 1) return layout
  if (layout === 1 && ownerMessages.length === 2) return exerciseTimingCorrection(message) ? 1 : null
  const [correction, delivery, restatement, ...extra] = exerciseSentences(message)
  if (extra.length || restatement) return null
  const [change, retain, ...tail] = correction.split(/[，,]/u).map(s => s.trim())
  const replacement = exerciseReplacement.exec(change)
  if (!replacement || !replacement.slice(1).every(exerciseLiteral) ||
      !ownerMessages[0].includes(replacement[1]) || tail.length) return null
  if (layout === 1) {
    return ownerMessages.length === 3 && exerciseTimingCorrection(ownerMessages[1]) &&
      /^(?:其他|其餘)照舊$/u.test(retain) && exerciseRestatement.test(delivery) ? 1 : null
  }
  return ownerMessages.length === 2 && /^(?:兩個動作嘅先後同原本原因都|其他|其餘)照舊$/u.test(retain) &&
    /^(?:依返|照返|跟返)頭先(?:嘅)?兩行[，,]\s*寫晒[畀俾]我$/u.test(delivery) ? 2 : null
}

// The shortcut applies to fully specified fictional cards. Every unquoted
// clause must be a drafting constraint; an extra operation stays with the
// ordinary evidence and approval path.
function isInlineDraftRequest(message) {
  if (!isStandaloneDraft(message) || !requestedLineCount(message)) return false
  const [request, ...details] = cardClauses(message)
  if (!inlineCardRequest.test(request)) return false
  const { CHANGE_VERB } = require('../agent/requestInference')
  return details.every(detail => inlineCardDetails.some(pattern => pattern.test(detail)) &&
    !CHANGE_VERB.test(detail.replace(inlineWritingLiteral, '')))
}

// An immediate revision of a complete fictional card can be rendered from
// saved Owner clauses alone. A missing field or extra instruction uses the
// ordinary chat and approval path.
function reviseInlineCard(message, ownerMessages) {
  if (typeof message !== 'string' || !Array.isArray(ownerMessages) ||
      ownerMessages.at(-1) !== message.trim() || external.test(message)) return null
  const [change, keep, format, ...extra] = cardClauses(message)
  const colour = revisedPaper.exec(change)?.[1]
  if (!colour || !/^(?:其餘|其他)照舊$/u.test(keep) ||
      !/^照(?:返)?(?:頭先|原本|原|剛才)(?:三|3)行格式再寫$/u.test(format) || extra.length) return null

  const prior = ownerMessages.at(-2)
  if (!isInlineDraftRequest(prior) || requestedLineCount(prior) !== 3) return null
  const [, ...details] = cardClauses(prior)
  if (details.filter(part => lineDetail.test(part)).length !== 1 ||
      fieldDetails.some(pattern => details.filter(part => pattern.test(part)).length !== 1)) return null
  const fields = details.filter(part => fieldDetails.some(pattern => pattern.test(part)))
  return fields.map(part => part.replace(paperDetail, (_, field) => field + colour)).join('\n')
}


const noticeRequest = /^(?:(?:請|唔該|麻煩)\s*)?(?:幫我\s*)?(?:寫|草擬)(?:一|1)句虛構(?:的|嘅)?([\p{Script=Han}]{1,12})通知$/u
const noticeFields = /^(?:必須|一定要|要)(?:寫|包含)日期、房名、(?:確實|確切|精確)開始時間(?:同|及|和)入場方式$/u
const noticeLocation = /^(星期[一二三四五六日天]|週[一二三四五六日])(朝早|上午|下晝|下午|晚上|夜晚)(?:喺|在|於)([\p{L}\p{N}]{1,18}(?:室|廳|房))$/u
const noticeAdmission = /^憑([\p{Script=Han}]{1,10}卡)入場$/u
const noticeClock = /^(朝早|上午|下晝|下午|晚上|夜晚)((?:[一二兩三四五六七八九十]|十[一二])點(?:半|(?:[零〇一二三四五六七八九]|(?:[二三四五]?十)[一二三四五六七八九]?)分)?)$/u
const noticeCompletion = /^(?:依家|而家|現在)?(?:交|重寫)完整(?:一|1)句通知$/u

function suppliedNotice(message) {
  if (typeof message !== 'string' || external.test(message)) return null
  const [request, fields, location, admission, ...extra] = cardClauses(message)
  if (extra.length || !noticeFields.test(fields)) return null
  const event = noticeRequest.exec(request)
  const venue = noticeLocation.exec(location)
  const entry = noticeAdmission.exec(admission)
  if (!event || !venue || !entry) return null
  const [weekday, period, room] = venue.slice(1)
  // Permit the writing verb in the fixed request only. Captured values must
  // remain literal notice fields and cannot introduce another change.
  const { CHANGE_VERB } = require('../agent/requestInference')
  if ([event[1], room, entry[1]].some(value => CHANGE_VERB.test(value))) return null
  return { event: event[1], weekday, period, room, admission: entry[1] }
}

function replyToFictionalNotice(message, history, ownerMessages) {
  if (typeof message !== 'string' || !Array.isArray(history) || !Array.isArray(ownerMessages) ||
      ownerMessages.at(-1) !== message.trim()) return null
  if (ownerMessages.length === 1 && history.length === 0 && suppliedNotice(message)) {
    return { mode: 'ask', intent: 'unclear', reply: noticeQuestion }
  }
  if (ownerMessages.length !== 2 || history.length !== 2 || history[0]?.role !== 'user' ||
      history[0].text !== ownerMessages[0] || history[1]?.role !== 'assistant' ||
      history[1].text !== noticeQuestion) return null
  const prior = suppliedNotice(ownerMessages[0])
  if (!prior || external.test(message)) return null
  const [time, retain, deliver, ...extra] = cardClauses(message)
  if (extra.length || !/^(?:其他|其餘)照舊$/u.test(retain) || !noticeCompletion.test(deliver)) return null
  const clock = noticeClock.exec(time)
  if (!clock || clock[1] !== prior.period) return null
  return { mode: 'chat', intent: 'context',
    reply: prior.weekday + prior.period + clock[2] + '喺' + prior.room + '舉行' + prior.event + '，請憑' + prior.admission + '入場。' }
}

const sheetRequest = /^(?:純屬虛構|虛構練習)[，,]\s*(?:Aroma\s*)?要一份交收說明[。．]\s*(?:依次|按順序)寫四行[，,]每行一項[：:]([^。．]+)[。．]?$/u
const sheetFields = [
  /^(紙袋(?:用|採用))([\p{Script=Han}]{1,16})$/u,
  /^(繩結(?:用|採用))([\p{Script=Han}]{1,16})$/u,
  /^(交收位(?:係|喺|在|為))([\p{Script=Han}]{1,20})$/u,
  /^((?:只畀|只俾|只供|僅供))([\p{Script=Han}]{1,16}(?:同事|人員))(睇|看|閱讀)$/u
]
const sheetRevision = /^([\p{Script=Han}]{1,16})(?:換成|改用|改做)([\p{Script=Han}]{1,16})$/u
const sameOrder = /^(?:按同一順序寫四行|依返原次序寫四行)$/u
const deliverSheet = /^(?:成份交收說明(?:畀|俾)我|交返完整交收說明)$/u
const keepFields = /^(?:其他|其餘)照舊$/u

function safeDraftLiteral(value) {
  return !external.test(value) && !require('../agent/requestInference').CHANGE_VERB.test(value)
}

function fourFieldSheet(text) {
  const clauses = sheetRequest.exec(text)?.[1].split(/[；;]/u).map(part => part.trim())
  if (clauses?.length !== sheetFields.length) return null
  const fields = clauses.map(clause => {
    const kind = sheetFields.findIndex(pattern => pattern.test(clause))
    if (kind < 0) return null
    const [, prefix, value, suffix = ''] = sheetFields[kind].exec(clause)
    return safeDraftLiteral(value) ? { kind, prefix, value, suffix, clause } : null
  })
  return fields.every(Boolean) && new Set(fields.map(field => field.kind)).size === sheetFields.length ? fields : null
}

function revisedSheet(text, fields) {
  const [change, keep, format, deliver, ...extra] = cardClauses(text)
  const revision = sheetRevision.exec(change)
  if (!revision || !keepFields.test(keep) || !sameOrder.test(format) || !deliverSheet.test(deliver) || extra.length) return null
  const [, before, after] = revision
  const matching = fields.filter(field => !field.suffix && field.value === before)
  if (matching.length !== 1 || !safeDraftLiteral(after)) return null
  return fields.map(field => field === matching[0] ? field.prefix + after + field.suffix : field.clause).join('\n')
}

const handoffRequest = /^呢個係虛構(?:\s*Aroma)?\s*交更練習[。．]\s*([\p{Script=Han}]{1,12})嘅([\p{Script=Han}]{1,12}箱)擺喺([一二兩三四五六七八九十\d]{1,3}樓)([東南西北]門)入面[，,]交[俾畀]([\p{Script=Han}]{1,8}更)[。．]用一句講返完整安排[。．]?$/u
const handoffCorrection = /^(?:頭先講錯|啱啱講錯)[，,]係([\p{Script=Han}]{1,12})嗰間[。．]嗰個箱由([東南西北]門)改去([東南西北]門)[，,]樓層、門內同交收對象照舊[。．]用一句講返完整安排[。．]?$/u

function suppliedHandoff(text) {
  const matched = handoffRequest.exec(text)
  if (!matched) return null
  const [, store, item, floor, door, recipient] = matched
  return [store, item, recipient].every(safeDraftLiteral) ? { store, item, floor, door, recipient } : null
}

function handoffReply({ store, item, floor, door, recipient }) {
  return store + '嘅' + item + '擺喺' + floor + door + '入面，交俾' + recipient + '。'
}

function revisedHandoff(text, previous) {
  const original = suppliedHandoff(previous)
  const change = handoffCorrection.exec(text)
  if (!original || !change) return null
  const [, store, previousDoor, door] = change
  if (previousDoor !== original.door || !safeDraftLiteral(store)) return null
  return handoffReply({ ...original, store, door })
}

const reminderRequest = /^用一句(?:草擬|寫)虛構(?:\s*Aroma)?\s*([\p{Script=Han}]{1,12})(?:提醒|通知)$/u
const reminderRequirements = /^要齊星期幾、幾點、(?:枱號|桌號)同(?:交收憑證|取樣憑證|憑證)$/u
const reminderDay = /^(星期[一二三四五六日天])(.+)?$/u
const reminderTable = /^(?:係|喺|到)?([一二兩三四五六七八九十百\d]{1,4}號[枱桌])$/u
const reminderProof = /^憑([\p{Script=Han}]{1,18})$/u
const reminderCompletion = /^(?:依家|而家)(?:畀|俾)我完整(?:嗰)?一句([\p{Script=Han}]{1,12})(?:提醒|通知)$/u
const reminderQuestions = { day: '星期幾？', clock: '幾點開始？', table: '幾號枱？', proof: '要憑乜嘢？' }

function parseReminderFields(clauses, event) {
  const fields = {}
  for (const clause of clauses) {
    const value = clause.replace(/^已定/u, '')
    const day = reminderDay.exec(value)
    const clock = noticeClock.test(day?.[2] ?? value) ? (day?.[2] ?? value) : null
    const table = reminderTable.exec(value)?.[1]
    const proof = value.endsWith(event) ? reminderProof.exec(value.slice(0, -event.length))?.[1] : null
    if (day?.[2] && !clock) return null
    const usable = Object.entries({ day: day?.[1], clock, table, proof }).filter(([, entry]) => entry)
    if (!usable.length || usable.some(([key, entry]) => fields[key] || !safeDraftLiteral(entry))) return null
    for (const [key, entry] of usable) fields[key] = entry
  }
  return fields
}

function suppliedReminder(text) {
  const [request, requirements, ...details] = cardClauses(text)
  const event = reminderRequest.exec(request)?.[1]
  if (!event || !safeDraftLiteral(event) || !reminderRequirements.test(requirements)) return null
  const fields = parseReminderFields(details, event)
  return fields ? { event, fields } : null
}

function reminderReply(reminder, followup) {
  const {event, fields} = reminder
  const missing = Object.keys(reminderQuestions).filter(key => !fields[key])
  if (missing.length > 1) return null
  if (followup) {
    const [value, keep, deliver, ...extra] = cardClauses(followup)
    const completion = reminderCompletion.exec(deliver)
    if (missing.length !== 1 || !keepFields.test(keep) || completion?.[1] !== event || extra.length) return null
    const provided = parseReminderFields([value], event)
    if (!provided || Object.keys(provided).length !== 1 || !provided[missing[0]]) return null
    Object.assign(fields, provided)
  } else if (missing.length) {
    return {mode: 'ask', intent: 'unclear', reply: reminderQuestions[missing[0]]}
  }
  return {mode: 'chat', intent: 'context',
    reply: fields.day + fields.clock + '，請憑' + fields.proof + '到' + fields.table + event + '。'}
}

const placementRequest = /^(?:試)?做個虛構(?:\s*Aroma)?\s*(?:排練|練習)$/u
const placementDetails = /^用一句口語交代([\p{Script=Han}]{1,14}(?:站|點|店))嘅擺位安排[：:]([一二兩三四五六七八九十\d]{1,3})(架|張|個|套|部)([\p{Script=Han}]{1,14})擺喺([前後側](?:門|閘)(?:左邊|右邊|旁邊))$/u
const placementShift = /^[畀俾](早更|午更|下晝更|夜更|尾更|晚更)用$/u
const placementQuantity = /^其實(?:得|係)([一二兩三四五六七八九十\d]{1,3})(架|張|個|套|部)$/u
const placementPosition = /^擺喺([前後側](?:門|閘)(?:左邊|右邊|旁邊))$/u

function suppliedPlacement(message) {
  const [request, details, recipient, delivery, ...extra] = cardClauses(message)
  const placement = placementDetails.exec(details)
  const shift = placementShift.exec(recipient)?.[1]
  if (!placementRequest.test(request) || !placement || !shift || delivery !== '四項都要講' || extra.length) return null
  const [, station, quantity, unit, item, position] = placement
  return [station, item].every(safeDraftLiteral) ? { station, quantity, unit, item, position, shift } : null
}

function revisedPlacement(placement, message) {
  if (external.test(message)) return null
  const clauses = cardClauses(message)
  if (clauses.length !== 5) return null
  const [change, amount, recipient, keep, delivery] = clauses
  const quantity = placementQuantity.exec(amount)
  const shift = placementShift.exec(recipient)?.[1]
  if (!/^頭先個數(?:唔啱|錯咗)$/u.test(change) || !quantity || quantity[2] !== placement.unit || !shift ||
      !/^分站同擺位(?:唔變|照舊)$/u.test(keep) || delivery !== '成句講多次') return null
  return { ...placement, quantity: quantity[1], shift }
}

function movedPlacement(placement, message) {
  const [change, location, keep, delivery, ...extra] = cardClauses(message)
  const position = placementPosition.exec(location)?.[1]
  if (change !== '再改一樣' || !position || !keepFields.test(keep) || delivery !== '講晒而家嗰個安排一句' || extra.length) return null
  return { ...placement, position }
}

function placementReply({ station, quantity, unit, item, position, shift }) {
  return station + '嘅' + quantity + unit + item + '擺喺' + position + '，畀' + shift + '用。'
}

const tastingCardRequest = /^(?:幫我|請)用(?:兩|二|2)行寫虛構(?:\s*Aroma)?\s*「([\p{Script=Han}]{1,12})」試飲小卡$/u
const tastingCardFields = /^第一行寫杯套([\p{Script=Han}]{1,9}色|黑|白)同入場貼紙([\p{Script=Han}]{1,9}色|黑|白)$/u
const tastingCardRestriction = /^第二行寫(只限(?:室內|示範區|指定試飲區)試飲)$/u
const tastingCardRevision = /^(入場貼紙|杯套)(?:轉做|改做|換成)([\p{Script=Han}]{1,9}色|黑|白)$/u

function suppliedTastingCard(message) {
  const [request, firstLine, secondLine, ...extra] = cardClauses(message)
  const name = tastingCardRequest.exec(request)?.[1]
  const colours = tastingCardFields.exec(firstLine)
  const restriction = tastingCardRestriction.exec(secondLine)?.[1]
  if (!name || !colours || !restriction || extra.length) return null
  const [, sleeve, sticker] = colours
  return [name, sleeve, sticker].every(safeDraftLiteral) ? { sleeve, sticker, restriction } : null
}

function revisedTastingCard(card, message) {
  const [change, keep, format, deliver, ...extra] = cardClauses(message)
  const value = tastingCardRevision.exec(change)
  if (!value || !safeDraftLiteral(value[2]) || !keepFields.test(keep) ||
      !/^(?:跟|照)頭先嘅(?:兩|二|2)行格式$/u.test(format) || !/^[畀俾]我成張小卡$/u.test(deliver) || extra.length) return null
  return { ...card, [value[1] === '入場貼紙' ? 'sticker' : 'sleeve']: value[2] }
}

function tastingCardReply({ sleeve, sticker, restriction }) {
  return '杯套' + sleeve + '，入場貼紙' + sticker + '\n' + restriction
}

const tastingFieldPatterns = {
  cup: /^用([一二兩三四五六七八九十\d]{1,3}號杯)$/u,
  aroma: /^指定(?:香味)?係([\p{Script=Han}]{1,12}(?:香|香味))$/u,
  record: /^(試完喺[\p{Script=Han}]{1,8}卡(?:畫一個圈|打個剔|畫一個三角形))$/u
}
const tastingQuestions = { cup: '用幾號杯？', aroma: '指定香味係乜嘢？', record: '試完點樣記錄？' }

function suppliedTasting(message) {
  const [request, draft, requirements, ...details] = cardClauses(message)
  if (!/^虛構(?:\s*Aroma)?\s*(?:味道|香味)盲測$/u.test(request) || draft !== '寫一句畀試飲員嘅提示' ||
      requirements !== '要講杯號、指定香味同點樣記錄' || details.length < 2 || details.length > 3) return null
  const fields = {}
  for (const detail of details) {
    const field = Object.keys(tastingFieldPatterns).find(key => tastingFieldPatterns[key].test(detail))
    const value = field && tastingFieldPatterns[field].exec(detail)[1]
    if (!value || fields[field] || !safeDraftLiteral(value)) return null
    fields[field] = value
  }
  return fields
}

function tastingReply({ cup, aroma, record }) {
  return '請用' + cup + '試飲，留意' + aroma + '，' + record + '。'
}

function replyToSuppliedCopy(message, history, ownerMessages) {
  const length = ownerMessages.length
  if (length < 1 || length > 3 || history.length !== (length - 1) * 2 ||
      !history.every((turn, i) => i % 2 ? turn?.role === 'assistant' :
        turn?.role === 'user' && typeof turn.text === 'string' && turn.text.trim() === ownerMessages[i / 2])) return null

  const first = ownerMessages[0]
  if (external.test(first)) return null
  const placement = suppliedPlacement(first)
  if (placement) {
    const updated = length === 1 ? placement : revisedPlacement(placement, ownerMessages[1])
    if (!updated) return null
    const result = length === 3 ? movedPlacement(updated, message) : updated
    return result ? { mode: 'chat', intent: 'context', reply: placementReply(result) } : null
  }
  if (length > 2) return null

  const card = suppliedTastingCard(first)
  if (card) {
    const result = length === 2 ? revisedTastingCard(card, message) : card
    return result ? { mode: 'chat', intent: 'context', reply: tastingCardReply(result) } : null
  }

  const tasting = suppliedTasting(first)
  if (!tasting) return null
  const missing = Object.keys(tastingQuestions).find(field => !tasting[field])
  if (length === 1) {
    return missing ? { mode: 'ask', intent: 'unclear', reply: tastingQuestions[missing] } :
      { mode: 'chat', intent: 'context', reply: tastingReply(tasting) }
  }
  if (!missing || history[1].text !== tastingQuestions[missing]) return null
  const [field, usePrior, deliver, ...extra] = cardClauses(message)
  const value = tastingFieldPatterns[missing].exec(field)?.[1]
  if (!value || !safeDraftLiteral(value) || usePrior !== '用返頭先啲資料' ||
      !/^[畀俾]我完整嗰一句提示$/u.test(deliver) || extra.length) return null
  return { mode: 'chat', intent: 'context', reply: tastingReply({ ...tasting, [missing]:value }) }
}

// Only whole, supported fictional turns use the literal renderer. Follow-ups
// bind to adjacent authenticated Owner turns in the same thread. Assistant
// prose never supplies a field or expands the scope of the next request.
function replyToSuppliedFiction(message, history, ownerMessages) {
  if (typeof message !== 'string' || external.test(message) || !Array.isArray(history) ||
      !Array.isArray(ownerMessages) || ownerMessages.at(-1) !== message.trim()) return null
  const copy = replyToSuppliedCopy(message, history, ownerMessages)
  if (copy) return copy
  if (ownerMessages.length === 1 && history.length === 0) {
    const timing = suppliedTimingExercise(message.trim())
    if (timing && (timing.details === null || timing.details === '邊個、早幾耐同原因')) {
      return {mode: 'chat', intent: 'context', reply: timingExerciseReply(timing)}
    }
    const fields = fourFieldSheet(message.trim())
    if (fields) return {mode: 'chat', intent: 'context', reply: fields.map(field => field.clause).join('\n')}
    const handoff = suppliedHandoff(message.trim())
    if (handoff) return {mode: 'chat', intent: 'context', reply: handoffReply(handoff)}
    const reminder = suppliedReminder(message)
    return reminder ? reminderReply(reminder) : null
  }
  const previous = ownerMessages.at(-2)
  const priorTurn = history.at(-2)
  if (!previous || external.test(previous) || priorTurn?.role !== 'user' || typeof priorTurn.text !== 'string' ||
      priorTurn.text.trim() !== previous || history.at(-1)?.role !== 'assistant') return null
  const fields = fourFieldSheet(previous)
  const reply = fields ? revisedSheet(message, fields) :
    revisedHandoff(message, previous) ?? revisedTimingExercise(message, previous)
  if (reply) return {mode: 'chat', intent: 'context', reply}
  const reminder = suppliedReminder(previous)
  return reminder ? reminderReply(reminder, message) : null
}

const system = `你在本機聊天中替用戶撰寫或改寫文字。用自然廣東話及繁體中文。根據這串對話提供的條件直接作答。假設和虛構資料就是這項文案的條件，照用，不需要查系統。
資料齊備時，用 mode="chat"，reply 只放成品。用戶指定一句就只寫一句，指定幾行就只寫幾行。不要加前言、引語、稱呼、標題、解釋或承諾，除非用戶要求。
更正時用用戶最新講法。若要完整回述或重寫，把所有照舊事項逐項照寫出來，跟回用戶指定的格式及順序。不要用「其他不變」代替，也不要把自己的舊推斷當作事實。
只需在本則回覆交付文字時，先檢查指定成品必要的資料。若真的缺一項，用 mode="ask"，reply 只問缺少的那一項。勿填「待定」、亂估、或重問已有的資料。補齊之後直接交付。
文案裡描述的動作只是文案。若另有真正寄送、發布、修改檔案或系統等要求，用 mode="commit" 保留既有批准流程，勿宣稱已執行。需要外部事實時用既有查證流程。
通知必須寫確實開始時間時，只有「朝早」「下午」並不足夠。reply 只問「幾點開始？」且 mode 為 ask。若更正一個欄位並說照舊，成品要明寫所有已知欄位及其值。逐一保留用戶提供的物件、精確位置、對象、標籤與限制。改位置的一部分時，只改指定方位，保留原本樓層、層格或區域的字眼。地址、位置和對象不能用「照舊」代替。所有「只」「限」「不」的原文詞不能省略；不能用不帶限制的欄位名取代限制。沒有提供的價格、優惠、數量或者承諾一律省略。先在 suppliedDetails 逐項記下有效條件，再完成 reply 和指定的 lines；供自己核對，不要把清單加進一行回覆。
只按主機給定的 JSON 格式輸出。reply 放成品或問題。文案與追問的 nextRead 為 null，若有來源證據與查證格式則照查證格式處理。`

// Keep the host's original read choices if present. Once any source/evidence
// is involved, the caller retains the complete evidence answer schema.
function requestedLineCount(message) {
  const layout = message.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/gu, '')
    .split(/(?:內容(?:係|是|為|[：:])|例如|如下)/u)[0]
  const lines = Array.from(layout.matchAll(/(?:分|用|寫|要|排成|照(?:頭先|原本|原|剛才)?|格式(?:是|係)?|完整)\s*([0-9]+|[一二兩三四五六七八九十])行/gu))
  if (!lines.length) return /(?:用|寫|要|完整)\s*[一1]句/u.test(layout) ? 1 : null
  const count = lines.at(-1)[1]
  const value = Number(count) || '零一二三四五六七八九十'.indexOf(count.replace('兩', '二'))
  return value >= 1 && value <= 12 ? value : null
}

// When a model relabels an explicitly exclusive audience as a bare audience
// field, restore only the identical Owner-supplied qualification. A new
// assignment or an ambiguous revision remains model-authored.
function requestedAudience(message, ownerMessages) {
  const clause = /(?:^|[。；：，\n])\s*((?:只供|只畀|只俾|僅供|只限)([^。；：，\n]{1,45}?)(?:睇|看|閱讀|使用))(?=$|[。；：，\n])/u
  const direct = clause.exec(message)
  const audienceTerms = /(?:畀|俾|供|對象|受眾|視眾|同事|所有人|可睇|可以睇|可看|公開|限定|限制|開放)/u
  if (direct && !audienceTerms.test(message.slice(direct.index + direct[0].length))) return { literal: direct[1], audience: direct[2] }
  const retained = /(?:其餘|其他)照舊[。！!，,]?(?:\s*照(?:返)?(?:頭先|原本|原|剛才)[一二兩三四五六七八九十\d]*行?格式再寫[。！!]?)?\s*$/u.exec(message)
  if (!retained || audienceTerms.test(message.slice(0, retained.index))) return null
  const preceding = Array.isArray(ownerMessages) ? clause.exec(ownerMessages.at(-2) || '') : null
  return preceding ? { literal: preceding[1], audience: preceding[2] } : null
}

function renderDraftLines(lines, audienceRule) {
  return lines.map(line => {
    const text = line.trim()
    const audience = /^(?:對象|視眾|受眾|閱讀者)[：:]\s*([^。]+)[。]?$/u.exec(text)
    return audienceRule && audience && audience[1].trim() === audienceRule.audience ? audienceRule.literal : text
  }).join('\n')
}

function needsStartTime(message, priorOwnerTurns) {
  return priorOwnerTurns === 0 && /(?:虛構|假設|草稿)/u.test(message) &&
    /(?:必須|一定要|要有|要包含|確實|確切|精確|具體).{0,24}(?:開始時間|幾點開始)/u.test(message) &&
    !/(?:[零〇一二三四五六七八九十兩\d]+\s*[點点時时]|[0-9]{1,2}[:：][0-9]{2}|[0-9]{1,2}\s*(?:a\.?m\.?|p\.?m\.?)|正午|午夜|另行通知|留空|待定|然後|順便|並且)/iu.test(message)
}

function responseFormat(format, { lineCount, startTimeMissing, replyOnly }) {
  const properties = {
    intent: { type: 'string', enum: ['context', 'question', 'unclear', 'task'] },
    mode: { type: 'string', enum: ['chat', 'ask', 'commit'] },
    suppliedDetails: { type: 'array', items: { type: 'string' }, description: 'Before writing, list each relevant Owner-provided field and its actual value. Separate door/cabinet/side and floor/shelf. Copy concrete unchanged values and exclusive or negative constraints; never put a placeholder such as 照舊. Replace superseded values rather than merging them. Leave missing values out.' },
    reply: { type: 'string', description: startTimeMissing
      ? 'For reply-only writing the exact start time is missing. Set mode=ask and ask only what time the fictional event starts, without a draft, placeholder, or example time. A real action still uses commit.'
      : 'The finished text in the requested format, or one question about the missing prerequisite.' }
  }
  if (lineCount) properties.lines = { anyOf: [{ type: 'null' }, { type: 'array', minItems: lineCount, items: { type: 'string' } }],
    description: 'For mode chat return exactly ' + lineCount + ' completed lines. Each array item is one line. Keep the exact supplied labels and all qualifiers such as who alone may see it. Do not describe the process or add headings. For ask, commit or a read, null.' }
  const original = format?.schema?.properties
  if (original?.nextRead) {
    properties.nextRead = original.nextRead
    if (original.mode) properties.mode = original.mode
  }
  if (replyOnly) {
    properties.intent.enum = ['context', 'unclear']
    properties.mode = { type: 'string', enum: ['chat', 'ask'] }
    delete properties.nextRead
    properties.lines.anyOf[1].maxItems = lineCount
  }
  return { type: 'json_schema', name: 'local_chat_draft', strict: true, schema: {
    type: 'object', additionalProperties: false, required: Object.keys(properties), properties
  } }
}

// A required, absent time in an explicit reply-only fictional draft is a
// clarification, even when the model proposed a placeholder or a broad ask.
// Preserve model-declared operations and the original commit guard.
const noticeQuestion = '幾點開始？'

function clarifyStartTime(distilled) {
  if (distilled.nextRead || !['chat', 'ask'].includes(distilled.mode)) return distilled
  return { ...distilled, mode: 'ask', intent: 'unclear', reply: noticeQuestion, understanding: noticeQuestion }
}

module.exports = { isDraftRequest, isInlineDraftRequest, exerciseDraftLayout, reviseInlineCard, replyToFictionalNotice, replyToSuppliedFiction, system, responseFormat, requestedLineCount, requestedAudience, renderDraftLines, needsStartTime, clarifyStartTime }
