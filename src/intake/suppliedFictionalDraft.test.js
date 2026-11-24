'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { processIntake } = require('./intakeService')
const { fromSavedConversation } = require('./conversationEvidence')
const { parseDistillResponse } = require('./distillPrompt')
const { explainOffer, WORK_REQUEST_STATE } = require('../routes/workRequestOffer')

// Saved PR232 benchmark excerpts, restricted to the fictional turns and the
// original model response fields needed to reproduce the old behavior.
const saved = {
  "B1": {
    "input": "呢個係虛構 Aroma 交更練習。紙鳶點嘅紙袋箱擺喺二樓西門入面，交俾早更。用一句講返完整安排。",
    "raw": {
      "mode": "chat",
      "intent": "task",
      "reply": "紙袋箱已擺喺二樓西門入面，待早更到達時交俾佢。",
      "lines": [
        "紙袋箱已擺喺二樓西門入面，待早更到達時交俾佢。"
      ]
    }
  },
  "B2": {
    "input": "頭先講錯，係砂糖點嗰間。嗰個箱由西門改去東門，樓層、門內同交收對象照舊。用一句講返完整安排。",
    "raw": {
      "mode": "chat",
      "intent": "task",
      "reply": "砂糖點嗰間嘅紙袋箱現已移至二樓東門入面，待早更到達時交俾佢。",
      "lines": [
        "砂糖點嗰間嘅紙袋箱現已移至二樓東門入面，待早更到達時交俾佢。"
      ]
    }
  },
  "C1": {
    "input": "純屬虛構，Aroma 要一份交收說明。依次寫四行，每行一項：紙袋用牛皮紙；繩結用綠繩；交收位係冷櫃旁木架；只畀打烊嗰更嘅同事睇。",
    "raw": {
      "mode": "chat",
      "intent": "task",
      "reply": "1. 包裝物料：紙袋採用牛皮紙，繩結使用綠色繩子。",
      "lines": [
        "1. 包裝物料：紙袋採用牛皮紙，繩結使用綠色繩子。",
        "2. 交收位置：冷櫃旁的木架。",
        "3. 權限限制：僅打烊當值的同事可檢視。",
        "4. 備註：此為 Aroma 內部交收說明草案，待 Louie 批准後方可正式執行或分發。"
      ]
    }
  },
  "C2": {
    "input": "綠繩換成橙繩，其他照舊。按同一順序寫四行，成份交收說明畀我。",
    "raw": {
      "mode": "chat",
      "intent": "task",
      "reply": "1. 包裝物料：紙袋採用牛皮紙，繩結使用橙色繩子。\n2. 交收位置：冷櫃旁的木架。\n3. 權限限制：僅打烊當值的同事可檢視。\n4. 備註：此為 Aroma 內部交收說明草案，待 Louie 批准後方可正式執行或分發。",
      "lines": [
        "1. 包裝物料：紙袋採用牛皮紙，繩結使用橙色繩子。",
        "2. 交收位置：冷櫃旁的木架。",
        "3. 權限限制：僅打烊當值的同事可檢視。",
        "4. 備註：此為 Aroma 內部交收說明草案，待 Louie 批准後方可正式執行或分發。"
      ]
    }
  },
  "D1": {
    "input": "用一句草擬虛構 Aroma 取樣提醒。要齊星期幾、幾點、枱號同交收憑證。已定星期日下午四點半，憑木牌取樣。",
    "raw": {
      "mode": "chat",
      "intent": "task",
      "reply": "各位同事，Aroma 取樣提醒：本週日（下午四點半）於指定枱號進行取樣，請務必憑木牌辦理交收。",
      "lines": [
        "各位同事，Aroma 取樣提醒：本週日（下午四點半）於指定枱號進行取樣，請務必憑木牌辦理交收。"
      ]
    }
  },
  "D2": {
    "input": "係七號枱。其他照舊，依家畀我完整嗰一句取樣提醒。",
    "raw": {
      "mode": "chat",
      "intent": "task",
      "reply": "各位同事，Aroma 取樣提醒：本週日（下午四點半）於七號枱進行取樣，請務必憑木牌辦理交收。"
    }
  }
}

const originalFields = ['紙袋用牛皮紙', '繩結用綠繩', '交收位係冷櫃旁木架', '只畀打烊嗰更嘅同事睇']
const revisedFields = ['紙袋用牛皮紙', '繩結用橙繩', '交收位係冷櫃旁木架', '只畀打烊嗰更嘅同事睇']

function context(input, answer) {
  return [{ role: 'user', text: input }, { role: 'assistant', text: answer }]
}

function begin(t) {
  const old = process.env.LOCAL_BRAIN_ONLY
  process.env.LOCAL_BRAIN_ONLY = '1'
  t.after(() => {
    if (old === undefined) delete process.env.LOCAL_BRAIN_ONLY
    else process.env.LOCAL_BRAIN_ONLY = old
  })
}

function intake(message, history = [], ownerHistory = history, manualLocalDialogue = true) {
  const adapter = { preflight: async () => { throw Error('model_fallback') } }
  return processIntake(message, adapter, history, {
    demo: true, interactionMode: 'chat', manualLocalDialogue,
    conversationEvidence: fromSavedConversation({ messages: ownerHistory }, message)
  })
}

function assertDraft(message, result, mode, reply) {
  assert.deepEqual([result.mode, result.reply, result.talkOnly, result.decision, result.tasks], [mode, reply, true, null, []])
  assert.equal(explainOffer({ message, response: result }).state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
}

test('reproduce the file form, merged draft lines and placeholder in saved PR232 replies', () => {
  for (const id of ['B2', 'C1', 'C2']) {
    const {input, raw} = saved[id]
    assert.equal(explainOffer({ message: input, response: raw }).state, WORK_REQUEST_STATE.INCOMPLETE)
  }
  const c1 = parseDistillResponse(JSON.stringify(saved.C1.raw), null, { lineCount: 4 })
  assert.deepEqual(c1.reply.split('\n'), saved.C1.raw.lines)
  assert.match(c1.reply.split('\n')[0], /牛皮紙.*綠色繩/u)
  assert.match(c1.reply.split('\n')[3], /^4\. 備註/u)
  assert.equal(saved.D1.raw.mode, 'chat')
  assert.match(saved.D1.raw.reply, /指定枱號/u)
})

test('a fictional same-thread handoff correction stays in chat', async t => {
  begin(t)
  const history = context(saved.B1.input, saved.B1.raw.reply)
  assertDraft(saved.B2.input, await intake(saved.B2.input, history), 'chat',
    '砂糖點嘅紙袋箱擺喺二樓東門入面，交俾早更。')
})

test('four supplied clauses and their correction keep one literal field on each line', async t => {
  begin(t)
  const draft = await intake(saved.C1.input)
  assertDraft(saved.C1.input, draft, 'chat', originalFields.join('\n'))
  const history = context(saved.C1.input, saved.C1.raw.lines.join('\n'))
  assertDraft(saved.C2.input, await intake(saved.C2.input, history), 'chat', revisedFields.join('\n'))
})

test('missing table number asks one question and the same-thread answer completes the draft', async t => {
  begin(t)
  const question = await intake(saved.D1.input)
  assertDraft(saved.D1.input, question, 'ask', '幾號枱？')
  const history = context(saved.D1.input, question.reply)
  assertDraft(saved.D2.input, await intake(saved.D2.input, history), 'chat',
    '星期日下午四點半，請憑木牌到七號枱取樣。')
})

test('unbound corrections, ambiguous changes and mixed file operations retain their normal path', async t => {
  begin(t)
  const history = context(saved.C1.input, saved.C1.raw.reply)
  await assert.rejects(intake(saved.C2.input, []), /model_fallback/u)
  await assert.rejects(intake(saved.C2.input, history, []), /model_fallback/u)
  await assert.rejects(intake(saved.C1.input, [], [], false), /model_fallback/u)
  await assert.rejects(intake(saved.C2.input.replace('綠繩', '紫繩'), history), /model_fallback/u)
  const suffix = '幫我改 docs/canary/agent-canary.md。'
  for (const [message, thread] of [[saved.C1.input, []], [saved.C2.input, history], [saved.D1.input, []],
    [saved.B2.input, context(saved.B1.input, saved.B1.raw.reply)]]) {
    const mixed = message + suffix
    await assert.rejects(intake(mixed, thread), /model_fallback/u)
    const offer = explainOffer({ message: mixed, response: { mode: 'chat', intent: 'task' } })
    assert.equal(offer.state, WORK_REQUEST_STATE.COMPLETE)
    assert.equal(offer.offer.file, 'docs/canary/agent-canary.md')
  }
})
test('duplicate, malformed and ambiguous supplied fields never produce a partial draft', async t => {
  begin(t)
  for (const message of [
    saved.C1.input.replace('交收位係冷櫃旁木架', '紙袋用白紙'),
    saved.C1.input.replace('繩結用綠繩', '繩結用綠繩改首頁'),
    saved.D1.input.replace('憑木牌取樣', '憑木牌取樣，憑紫牌取樣'),
    saved.D1.input.replace('，憑木牌取樣', ''),
    saved.B2.input.replace('由西門', '由北門')
  ]) {
    const history = message.includes('講錯') ? context(saved.B1.input, saved.B1.raw.reply) : []
    await assert.rejects(intake(message, history), /model_fallback/u)
  }
  const attested = context(saved.C1.input, 'old answer')
  const mismatched = [{ role: 'user', text: {} }, { role: 'assistant', text: 'old answer' }]
  await assert.rejects(intake(saved.C2.input, mismatched, attested), /model_fallback/u)
})
