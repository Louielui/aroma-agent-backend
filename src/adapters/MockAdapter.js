'use strict'
const { LLMAdapter } = require('./LLMAdapter')
const GREET = ['你好','哈囉','嗨','早安','午安','晚安','hi','hello','謝謝']
class MockAdapter extends LLMAdapter {
  get providerName () { return 'mock' }
  async complete (prompt) {
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
