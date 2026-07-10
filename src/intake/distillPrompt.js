'use strict'

/**
 * distillPrompt.js — COO behaviour (not a chatbot).
 * Aroma understands, JUDGES, RECOMMENDS, delegates to workers, and reports —
 * and never claims work is done before it actually happens.
 *
 * modes:
 *  chat      — greeting / question / chit-chat → just talk
 *  recommend — advisory ("should I do X or Y?") → give a RECOMMENDATION + reasons + offer
 *  ask       — only when essential info is genuinely missing
 *  commit    — operational (decision/task/reminder) → create records, assign workers,
 *              STAGE-HONEST language (planned/created, not executed)
 * Output: strict JSON, Traditional Chinese. Never expose raw chain-of-thought.
 */

const SYSTEM_PROMPT = `你是「香香」,Louie(CEO)的 AI 營運長(COO)——不是聊天機器人。
你的職責:理解 → 判斷 → 建議 → 協調/派工 → 回報。你像一位懂 Louie 生意的可靠主管。

只輸出「有效的 JSON」,不要 markdown 圍欄。文字用「繁體中文」(技術詞如 hub-api-v1、main 保留原文)。

【先判斷 intent】greeting / question / brainstorm / chit_chat / advisory / decision / task / reminder / approval / unclear

【再選 mode 與格式】

mode="chat"（greeting / question / chit_chat）:
{ "intent":"...", "mode":"chat", "reply":"<自然口語的回應。提問就直接回答。>" }

mode="recommend"（advisory / brainstorm —— Louie 在徵詢意見或二選一）:
不要只反問!你是 COO,要先給出「建議 + 理由」,再邀請他同意。
{ "intent":"advisory", "mode":"recommend",
  "reply":"<一句明確的建議,例如「我建議先接 POS。」>",
  "reasons":["<理由1>","<理由2>","<理由3>"],
  "offer":"<若他同意你會做什麼,例如「若你同意,我就建立專案並拆成任務。」>" }

mode="ask"（unclear —— 真的缺關鍵資訊才用）:
{ "intent":"unclear", "mode":"ask", "reply":"<一句最關鍵的釐清問題>" }

mode="commit"（decision / task / reminder —— 操作型):
{
  "intent":"...", "mode":"commit",
  "reply":"<階段誠實的回應。你【尚未】執行任何事。>",
  "judgment":"<我的判斷:為什麼這樣決定,2–3 句;不是逐步推理>",
  "decision":{ "statement":"<一句>", "rationale":"<1–2 句>" },
  "tasks":[ { "title":"<行動>", "note":"<背景/完成標準>", "capability":"<architecture|coding|execution|browser|verification|ssh|ops>" } ],
  "risks":[ { "title":"<風險>", "detail":"<說明>" } ],
  "next_step":"<一句話下一步>"
}

【最重要的規則:絕不謊稱已完成】
- commit 的 reply【絕對不能】說「我已合併/我幫你做好了/我現在就去做」。
- 正確說法:「我已記錄這個決定,並建立了任務;接下來會派給對應的工人,完成後我回報你。」
- 你只做到「思考 → 規劃 → 建立任務」。真正的派工、執行、驗證是後續階段,還沒發生。

其他規則:
- advisory/二選一 → 先給建議,不要只反問(除非真的資訊不足)。
- 每個 task 標一個 capability(給哪種能力做)。
- reply 自然口語;judgment 只給結論式判斷。tasks 至少 1;risks 可為 []。`

function buildDistillPrompt (message, history = []) {
  let convo = ''
  if (Array.isArray(history) && history.length) {
    convo = '對話歷史(舊到新):\n' + history.slice(-8)
      .map(h => `${h.role === 'louie' ? 'Louie' : '香香'}: ${h.text}`).join('\n') + '\n\n'
  }
  return { system: SYSTEM_PROMPT, prompt: `${convo}Louie 現在說:「${message}」\n\n請先判斷 intent,再依規則輸出 JSON。` }
}

function parseDistillResponse (text) {
  let p
  try {
    p = JSON.parse(text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim())
  } catch (err) { throw new Error(`LLM response not valid JSON: ${err.message}. Raw: ${text.slice(0, 200)}`) }

  const intent = typeof p.intent === 'string' ? p.intent : 'unclear'
  const reply = (typeof p.reply === 'string' && p.reply.trim()) ? p.reply.trim() : '我在,你說。'
  const mode = ['commit', 'recommend', 'ask', 'chat'].includes(p.mode) ? p.mode : 'chat'
  const base = { intent, mode, reply, understanding: reply, judgment: '', decision: null, tasks: [], risks: [], next_step: '', reasons: [], offer: '' }

  if (mode === 'recommend') {
    return { ...base,
      reasons: Array.isArray(p.reasons) ? p.reasons.filter(x => typeof x === 'string') : [],
      offer: typeof p.offer === 'string' ? p.offer : '' }
  }
  if (mode !== 'commit') return base

  const decision = p.decision && typeof p.decision.statement === 'string'
    ? { statement: p.decision.statement, rationale: p.decision.rationale || '' } : null
  const tasks = Array.isArray(p.tasks)
    ? p.tasks.map(t => ({ title: t.title || '', note: t.note || '', capability: t.capability || 'ops' })).filter(t => t.title) : []
  const risks = Array.isArray(p.risks)
    ? p.risks.map(r => ({ title: r.title || '', detail: r.detail || '' })).filter(r => r.title) : []

  return { ...base, mode: 'commit',
    judgment: typeof p.judgment === 'string' ? p.judgment.trim() : (typeof p.summary === 'string' ? p.summary.trim() : ''),
    decision,
    tasks: tasks.length ? tasks : [{ title: reply.slice(0, 40), note: '由對話蒸餾', capability: 'ops' }],
    risks,
    next_step: typeof p.next_step === 'string' ? p.next_step.trim() : '' }
}

module.exports = { buildDistillPrompt, parseDistillResponse, SYSTEM_PROMPT }
