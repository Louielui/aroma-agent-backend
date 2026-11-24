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

function responseFormat(format, { lineCount, startTimeMissing }) {
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

module.exports = { isDraftRequest, isInlineDraftRequest, reviseInlineCard, replyToFictionalNotice, system, responseFormat, requestedLineCount, requestedAudience, renderDraftLines, needsStartTime, clarifyStartTime }
