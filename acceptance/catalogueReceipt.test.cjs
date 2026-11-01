'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { CATALOGUE } = require('../src/i18n/catalogue.js')

/*
Owner objective, retained in full:
請派 Codex 建立並完成一個隔離小修正：程式診斷與派工頁面目前寫「診斷使用最新 Sol 與標準推理」，但真實工作單回執使用 GPT-6.1 Sol／High，說明不一致。將該說明改為「診斷使用的模型與思考等級，以本次工作單的實際回執為準。」只修改這段介面文案及必要的相鄰驗證，不改模型設定、派工邏輯、權限或資料。開發指定 GPT-6.1 Sol／High，因為需要沿用現有隔離修正流程核對來源和結果。先定位實際來源及提出可審閱範圍，再按既有入口準備來源與用量批准卡；不自行擴權或增加額度。驗收：舊的標準推理宣稱消失，新文案正確顯示，其他頁面與執行行為不變。完成後回報工作單、實際執行證據、候選差異及驗證結果。不要部署或合併，不轉 API，不使用或重置原對話驗收額度；如需批准，清楚展示具體卡片。

Owner criteria:
1. 只修改 work.scope 介面文案中的模型／推理說明，中英文保持一致；中文改成「診斷使用的模型與思考等級，以本次工作單的實際回執為準。」英文表達相同意思。
2. 原本的八檔唯讀範圍、假設與驗證計劃、不可改檔或執行測試等限制文案保持。
3. 候選頁面不再宣稱固定標準／medium 推理；不改模型設定、派工邏輯、權限及業務資料，不部署、不合併。
Editable scope: src/i18n/catalogue.js only; work.scope.zh/en only.

Coverage limits: real catalogue exports, no replacement renderer or stubs.
Missing packaged dependencies: src/governance/textResolver.js (required by
 t.js/browserResolver.js), src/core/developmentPlan/view.html (buildHtml also
 performs forbidden filesystem reads). Rendering, locale resolution and runtime
 behavior are not established here. Existing test modules are not imported.
Host must verify the candidate diff preserves every other entry and executable
source, including model/dispatch/permission/data behavior. Preserve reviewed
committed-source identity, existing concrete source/usage approval cards and
limits; verify actual GPT-6.1 Sol / High development receipts, no API fallback,
no original conversation allowance use/reset, no deployment or merge. Report
work-order identity, actual execution evidence, candidate diff and validation.
Existing offline browser coverage must explicitly include /code-diagnosis in
Chinese/English on desktop/mobile. Missing coverage blocks completion even if
visual review is later available. Actual-pixel review after implementation is
mandatory; missing evidence or failed review blocks completion. Do not invent
paired before/after, dark-theme or numeric-geometry receipts. Draft review only
authorizes the next stage, not completion, adoption or deployment.
*/

const locales = ['zh', 'en']
const replacementZh = '診斷使用的模型與思考等級，以本次工作單的實際回執為準。'
const frames = {
  zh: {
    before: '範圍：香香已提交版本中八個固定的派工相關原始碼／測試檔案。開啟頁面不派工；聊天可說「香香，檢查自己目前的程式，提出問題證據和修正方案」。',
    after: '只提出假設、修正建議和驗證計劃；不改檔、不執行測試。這不是整個專案的完整審查。'
  },
  en: {
    before: 'Scope: eight fixed dispatch source/test files from committed Imagine code. Opening the page does not dispatch. Chat command: diagnose Imagine code and propose evidence-based fixes. ',
    after: 'hypotheses, proposals and validation plans; it does not edit or run tests. This is not a full repository audit.'
  }
}
function entry(key) {
  const value = CATALOGUE[key]
  assert.ok(value && typeof value === 'object', key + ' available')
  assert.deepEqual(Object.keys(value).sort(), ['en', 'zh'], key + ' locales')
  for (const loc of locales) assert.equal(typeof value[loc], 'string', key + '/' + loc)
  return value
}
function equalEntries(fixtures) {
  for (const [key, expected] of Object.entries(fixtures)) {
    assert.deepEqual(entry(key), expected, key + ' unchanged')
  }
}
const preserved = {
  'work.title': { zh: '程式診斷與派工', en: 'Code diagnosis and dispatch' },
  'work.intro': {
    zh: '香香按能力合約選擇 Worker，先檢查權限及訂閱，再提供指定原始碼。回報後重新核對版本、內容雜湊與引用位置。',
    en: 'Imagine selects a worker by capability contract, checks policy and subscription, and supplies scoped code. Versions, content hashes and citations are checked after the reply.'
  },
  'work.start': { zh: '開始唯讀診斷', en: 'Start read-only diagnosis' },
  'work.proposal': { zh: '診斷方案 · 問題尚未重現', en: 'Diagnosis proposal · defects not reproduced' },
  'work.verified': {
    zh: '來源版本、內容雜湊和引用原文已核對一致；問題判斷尚未獨立驗證，未執行測試或修改檔案。',
    en: 'Source revision, hashes and quoted lines match. Findings remain unverified; no tests or edits ran.'
  },
  'work.accepted': {
    zh: '已建立唯讀程式診斷工作單。香香會檢查權限與訂閱，按能力選擇 Worker；回報後核對來源版本及引用。這只是派工已接收，尚未完成診斷：{url}',
    en: 'A read-only code diagnosis work order was accepted. Imagine checks policy/subscription, selects a worker by capability, then verifies sources and citations. Acceptance is not completion: {url}'
  },
  'work.configured': {
    zh: '已配置 Worker；實際帳戶可用性於派工時檢查',
    en: 'Configured workers; actual account availability is checked when dispatched'
  },
  'plan.scope': {
    zh: '範圍：指定公開 GitHub 的版本／PR／檢查紀錄，以及香香已部署與運行版本。這次只提出方案；不讀專案原始碼、不改檔、不執行測試、不部署。使用 GPT 訂閱；額度用完時，依 Owner 的本機設定使用可用 credits，仍受帳戶花費上限限制。',
    en: 'Scope: configured public GitHub revisions, PRs and checks, plus deployed and running Imagine revisions. Proposal only: no source-file access, changes, test execution or deployment. Uses GPT subscription access; available credits require Owner opt-in after quota is exhausted and remain subject to account spend controls.'
  },
  'architecture.planCurrent': {
    zh: '沿用 Capability Registry／Policy／Dispatcher。Owner 明確指令可路由到開發進度建議，或香香八個固定已提交派工原始碼／測試檔案的唯讀診斷。按合約與既有健康排名選擇本機已配置 Worker，權限先行，再檢查訂閱及讀取上下文。Codex 診斷使用最新 Sol；回報後重新核對來源雜湊、版本與原文行號。不提供改檔、執行測試或自動重試；保留取消、逾時、重啟中斷、聊天工作連結及終態記憶收據。',
    en: 'Reuses the capability registry / policy / dispatcher. Explicit Owner commands route to progress proposals or read-only diagnosis of eight fixed committed dispatch source/test files. Host-composed workers are selected by exact contract and existing health ranking. Policy precedes subscription and context. Codex diagnosis uses latest Sol, with post-result source hash/revision/line checks. No edits, test execution or automatic retry; cancellation, timeout, restart interruption, chat links and terminal memory receipts are retained.'
  },
  'master.codex': {
    zh: '部分接通：訂閱聊天、固定開發工作單及公開網站查找已驗收。受控派工沿用合約、Policy 與 Dispatcher；進度建議及八個指定已提交派工原始碼／測試檔案的唯讀診斷保留來源核對、原文引用、失敗狀態與記憶收據，以真實工作單為準。診斷使用最新 Sol／標準推理。Owner 可用 credits 沿用既有上限。首輪三種固定修正配方可在批准後套用至隔離副本，獨立重跑測試並保存變更雜湊。任意改碼、運行程式自動套用、一般專案派工、Claude 診斷及互動式 Browser／Computer 尚未接通。',
    en: 'Partially connected: subscription chat, fixed coding work orders and website discovery are verified. Controlled dispatch reuses contracts, Policy and Dispatcher; progress proposals and read-only diagnosis of eight fixed committed dispatch source/test files retain source checks, exact quotes, failure states and memory receipts, evidenced by actual work orders. Diagnosis uses latest Sol/medium reasoning and existing Owner credit controls. Three fixed repair recipes can be applied to an approved isolated copy, with independent tests and change hashes. Arbitrary edits, automatic live application, general project dispatch, Claude diagnosis and interactive Browser/Computer work remain unconnected.'
  },
  'projectTask.scopePrepare': { zh: '準備來源與用量批准卡', en: 'Prepare source and usage approval' },
  'projectTask.scopeAuthorize': { zh: '批准本工作單來源及 8 次 helper 上限', en: 'Approve this source scope and 8-helper cap' },
  'projectTask.scopeConfirm': {
    zh: '我已核對完整目標、來源、模型及用量上限；只准隔離準備與修正，部署另批。',
    en: 'I checked the whole objective, source, models and usage cap. Isolated preparation and repair only; deployment requires separate approval.'
  },
  'workerFlow.billing': {
    zh: '沿用已登入的訂閱帳戶；不切換付費 API。實際額度與額外用量依帳戶設定，未知費用不當作零。',
    en: 'Uses signed-in subscription accounts without API fallback. Account settings determine quotas and extra usage; unknown cost is not zero.'
  },
  'usage.blocked': {
    zh: '本次驗收已停止：{reason}。沒有自行增加或重發額度。',
    en: 'Acceptance stopped: {reason}. No allowance was increased or reissued.'
  },
  'wont.merge': { zh: '合併', en: 'merge' },
  'wont.deploy': { zh: '部署', en: 'deploy' }
}

test('work.scope uses the requested Chinese sentence and equivalent English receipt authority', () => {
  const scope = entry('work.scope')
  assert.equal(scope.zh.split(replacementZh).length, 2, 'exact requested sentence once')
  const sentences = scope.en.match(/[^.!?]*\breceipt\b[^.!?]*[.!?]/gi) || []
  assert.equal(sentences.length, 1, 'one English receipt explanation')
  for (const pattern of [
    /\bdiagnos(?:is|tic|tics)\b/i,
    /\bmodel\b/i,
    /\b(?:reasoning|thinking)\s+(?:level|effort)\b/i,
    /\bactual\s+(?:(?:work[- ]order|execution)\s+)?receipt\b/i,
    /\bthis\s+work[- ]order\b/i,
    /\b(?:refer to|consult|see|follow|follows|based on|determined by|governed by|as recorded in|as shown in|authoritative|source of truth)\b/i
  ]) assert.match(sentences[0], pattern, 'diagnosis model/effort defer to this order actual receipt')
})

test('work.scope preserves the eight-file scope and all read-only limitations', () => {
  const scope = entry('work.scope')
  for (const loc of locales) {
    assert.ok(scope[loc].startsWith(frames[loc].before), loc + ' scope and entry wording unchanged')
    assert.ok(scope[loc].endsWith(frames[loc].after), loc + ' outputs and restrictions unchanged')
  }
  // Do not prescribe a sentence splice: 「診斷只提出…」 is a valid grammatical continuation.
  assert.ok(scope.zh.includes(replacementZh), 'replacement retains its full stop')
  assert.ok(scope.zh.indexOf(replacementZh) >= frames.zh.before.length)
  assert.ok(scope.zh.indexOf(frames.zh.after) >= scope.zh.indexOf(replacementZh) + replacementZh.length,
    'the complete restrictions follow the receipt explanation')
  assert.match(scope.en.slice(frames.en.before.length, -frames.en.after.length), /\breturns\s*$/i,
    'diagnosis still returns the listed outputs')
})

test('diagnosis-page copy drops fixed standard/medium reasoning without hard-coding High', () => {
  // Other pages, including master.codex, are deliberately outside this copy change.
  for (const [key, value] of Object.entries(CATALOGUE)) {
    if (!key.startsWith('work.')) continue
    for (const loc of locales) {
      assert.equal(typeof value[loc], 'string', key + '/' + loc)
      assert.doesNotMatch(value[loc], /標準推理|固定推理|\b(?:medium|standard)\s+(?:reasoning|effort|thinking)\b/i,
        key + '/' + loc + ' stale claim')
    }
  }
  for (const loc of locales) {
    const scope = entry('work.scope')[loc]
    assert.doesNotMatch(scope, /\b(?:Sol|GPT[- ]?6|High|Medium|Standard)\b|最新模型|標準推理/i,
      'no replacement fixed model/effort claim')
    assert.doesNotMatch(scope, /\{[^}]*\}|<[^>]*>|⟦/, 'complete prose without slots or markup')
  }
})

test('neighboring pages, diagnosis and approval safeguards retain their existing catalogue values', (t) => {
  assert.ok(Object.isFrozen(CATALOGUE), 'existing export contract')
  equalEntries(preserved)
  t.diagnostic('Catalogue coverage only. Missing: src/governance/textResolver.js and src/core/developmentPlan/view.html. Rendering and runtime behavior remain unverified; no stubs.')
  t.diagnostic('Completion requires host diff/scope checks, concrete source/usage approvals, actual GPT-6.1 Sol / High receipts, original allowance protection, explicit diagnosis-page bilingual desktop/mobile harness coverage and actual-pixel review. No deployment or merge.')
})
