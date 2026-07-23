'use strict'
const { LLMAdapter } = require('./LLMAdapter')
const { assertResponseFormat, UnsupportedCapabilityError } = require('./adapterErrors')
const GREET = ['你好','哈囉','嗨','早安','午安','晚安','hi','hello','謝謝']

// Deterministic structured-output fixture (valid against U1_DRAFT_SCHEMA AND
// parseU1DraftResponse: draft_proposal -> draft object + clarifyingQuestion null,
// no authority keys). Used only when responseFormat is supplied.
const STRUCTURED_FIXTURE = JSON.stringify({
  mode: 'draft_proposal',
  understanding: {
    recipient: { name: 'Rob', email: null, confidence: 'medium' },
    purpose: { value: 'update on phase 2 equipment list', confidence: 'high' },
    tone: { value: 'natural and polite', confidence: 'high' },
    constraints: [],
    understandingSignals: [
      { classification: 'FACT', statement: 'phase 2 list still being organized', source: 'current_message', confidence: 'high' }
    ]
  },
  restatement: 'Draft an email to Rob about the phase 2 equipment list.',
  clarifyingQuestion: null,
  draft: { to: null, subject: 'Phase 2 equipment list', body: 'Hi Rob, I am still finalizing the phase 2 equipment list; Ivy will send it to you tonight.', tone: 'natural and polite' }
})

class MockAdapter extends LLMAdapter {
  constructor (config = {}) {
    super()
    // Structured output supported by default; set false to test the fail-closed path.
    this._supportsStructuredOutput = config.supportsStructuredOutput !== false
  }
  get providerName () { return 'mock' }
  async complete (prompt, opts = {}) {
    // Structured-output request: fail closed if unsupported, else return the
    // deterministic fixture. When responseFormat is ABSENT, behaviour below is
    // byte-for-byte the legacy mock.
    if (opts && opts.responseFormat !== undefined && opts.responseFormat !== null) {
      if (!this._supportsStructuredOutput) {
        throw new UnsupportedCapabilityError('structured_output', 'mock')
      }
      assertResponseFormat(opts.responseFormat)
      return { text: STRUCTURED_FIXTURE, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, model: 'mock', latencyMs: 1 }
    }
    // Execution call (dispatcher asking 香香 to DO a knowledge task)
    if (prompt.includes('請完成這個任務並給出成果')) {
      const tm = prompt.match(/任務:([^\n]*)/)
      const title = tm ? tm[1].trim() : '任務'
      return { text: `【${title} 的成果(示範)】\n1. 已檢視相關狀態\n2. 列出重點\n3. 建議下一步\n自我檢查:示範成果,建議你過目。`, usage: { totalTokens: 0 }, model: 'mock', latencyMs: 1 }
    }
    const m = prompt.match(/Louie 現在說:「([\s\S]*?)」/)
    const msg = (m ? m[1] : '').trim()
    const low = msg.toLowerCase()
    let json
    if (GREET.some(g => low.includes(g))) {
      json = { intent: 'greeting', mode: 'chat', reply: `${msg},Louie!我在,今天想推進什麼?(示範)` }
    } else if (msg.includes('還是') || low.includes(' or ')) {
      json = { intent: 'advisory', mode: 'recommend',
        reply: '(示範)我建議先做前者。', reasons: ['它是後續其他工作的資料來源', '之後再接第二個較順', '減少未來重做'],
        offer: '若你同意,我就建立專案並拆成任務。' }
    } else if (msg.length > 0 && msg.length < 6) {
      json = { intent: 'unclear', mode: 'ask', reply: `你說「${msg}」——可以再多講一點嗎?(示範)` }
    } else {
      const short = msg.length > 40 ? msg.slice(0, 40) + '…' : msg
      json = { intent: 'task', mode: 'commit',
        reply: `收到。我已記錄這個決定並建立了任務,接下來會派給對應的工人,完成後回報你。(示範)`,
        judgment: '示範模型的判斷摘要。', decision: { statement: short, rationale: '由對話蒸餾。' },
        tasks: [{ title: short, note: '待辦', capability: 'coding' }], risks: [], next_step: '等待派工。' }
    }
    return { text: JSON.stringify(json), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, model: 'mock', latencyMs: 1 }
  }
}
module.exports = { MockAdapter }
