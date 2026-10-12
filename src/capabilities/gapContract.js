'use strict'
const { createHash } = require('node:crypto')
const { capabilityEntry } = require('../governance/selfCapability')
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const KINDS = ['unmapped_read', 'not_implemented', 'not_authorised', 'source_unavailable', 'verification_unavailable', 'unknown']
const STATES = ['no_system_operation', 'not_authorised', 'failed', 'not_attempted', 'succeeded']
const text = (s, max) => typeof s === 'string' && !!s.trim() && s.length <= max && !s.includes('\0')
const keys = (v, expected) => !!v && !Array.isArray(v) && Object.keys(v).sort().join() === expected.slice().sort().join()

// Called by intake with its judged plan and actual read-state, never browser or
// assistant prose. An unmapped need proves no matching read was identified;
// it does not prove the external product has no connector or requires new scope.
function detectGap ({ reason, plan, state }) {
  const entry = capabilityEntry(plan?.requestedCapability)
  if (!reason && entry?.implementation !== 'not_implemented') return null
  const facts = (state?.facts || []).filter(f => f.necessity === 'required').slice(0, 8).map(f => ({
    need: String(f.need || '').slice(0, 1000), operation: typeof f.operation === 'string' ? f.operation : null,
    state: STATES.includes(f.readState) ? f.readState : 'not_attempted'
  })).filter(f => text(f.need, 1000))
  let kind = 'unknown'
  if (entry?.implementation === 'not_implemented') kind = 'not_implemented'
  else if (reason === 'validation_unavailable') kind = 'verification_unavailable'
  else if (facts.some(f => f.state === 'not_authorised')) kind = 'not_authorised'
  else if (reason === 'no_mapped_operation') kind = 'unmapped_read'
  else if (facts.some(f => f.state === 'failed')) kind = 'source_unavailable'
  return { version: 1, kind, capability: entry?.capability || null, implementation: entry?.implementation || 'unknown', facts }
}
function validGap (g) {
  return keys(g, ['version', 'kind', 'capability', 'implementation', 'facts']) && g.version === 1 && KINDS.includes(g.kind) &&
    (g.capability === null ? g.implementation === 'unknown' : capabilityEntry(g.capability)?.implementation === g.implementation) &&
    (g.kind !== 'not_implemented' || g.implementation === 'not_implemented') &&
    ['implemented', 'not_implemented', 'unknown'].includes(g.implementation) && Array.isArray(g.facts) && g.facts.length <= 8 &&
    g.facts.every(f => keys(f, ['need', 'operation', 'state']) && text(f.need, 1000) && (f.operation === null || text(f.operation, 160)) && STATES.includes(f.state))
}
// Only host-registered fixed profiles can be proposed here. Model-selected files,
// unavailable credentials and permissions never grant a development scope.
function registeredScope (gap, goal, version = 1) {
  if (gap.kind === 'unmapped_read' && gap.capability === 'aroma_system.read') return { profile:'context', files:[...require('../core/taskPlanner/contract').PROFILES.context] }
  if (version === 3 && gap.kind === 'unmapped_read' && gap.capability === 'seven_shifts.read' && require('../context/sevenShiftsReport').clockOutRequest(goal)) return structuredClone(require('./scopeRegistry').SEVEN_SCOPE)
  if ([2,3].includes(version) && gap.kind === 'unmapped_read' && (gap.capability === null || gap.capability === 'seven_shifts.read')) return require('./scopeRegistry').scopeForGoal(goal)
  return null
}
function proposalFor (goal, gap, language, version = 1) {
  const zh = language === 'zh', needs = gap.facts.map(f => f.need)
  const diagnosis = {
    unmapped_read: zh ? '本輪未找到所需資料的已登記讀取操作；連線及權限是否足夠仍待核對。' : 'No registered read operation matched this turn. Connection and permission adequacy remain unverified.',
    not_implemented: zh ? '能力登記表確認這項功能尚未實作。' : 'The capability registry identifies this function as unimplemented.',
    not_authorised: zh ? '本輪未獲准使用所需讀取操作；不能因此判定功能未開發。' : 'The required read was not authorised for this turn. This does not establish missing implementation.',
    source_unavailable: zh ? '本輪讀取未成功；根因及是否需要開發仍未確認。' : 'The read failed this turn. Its cause and whether development is needed are unconfirmed.',
    verification_unavailable: zh ? '資料需求核對不可用；先恢復核對流程。' : 'The evidence-requirement check is unavailable and must be restored first.',
    unknown: zh ? '所需證據不足，尚未確認缺口根因。' : 'Required evidence is missing; the cause of the gap is not established.'
  }[gap.kind]
  const scope = registeredScope(gap, goal, version)
  if (version === 3 && scope?.profile === 'seven_shifts') return {
    goal, needs,
    diagnosis: zh ? '既有 7shifts 唯讀連線不等於完整下班報表能力：目前缺少按下班日期讀取全部查詢結果及員工姓名的讀取方法。' : 'An existing 7shifts read connection does not provide a complete clock-out report: the scoped clock-out reader and employee-name lookup are missing.',
    steps: zh ? ['由現有日期處理器把 Winnipeg 本地日期轉成 UTC 查詢邊界，包含跨午夜班次。', '只修改固定讀取器檔案，新增 listClockOuts：固定 GET time_punches 按 clocked_out 篩選；固定 GET users/{數字 ID} 核對姓名。', '以受保護測試核對公司、日期邊界、分頁完整性、姓名讀取失敗及權限撤回；再經獨立審閱與採納。', '確認採納版本實際載入後，重新唯讀查詢原問題；結果显示完整性及未核實姓名。'] : ['The existing host query handler converts Winnipeg local dates to UTC boundaries, including overnight shifts.', 'Change only the registered reader file: add listClockOuts using fixed GET time_punches clocked_out filters and fixed GET users/{numeric ID} for names.', 'Use protected tests for company and date binding, pagination, name failures and access revocation; then independent review and adoption.', 'Verify the adopted build is loaded before resuming the original read-only question, reporting completeness and unresolved names.'],
    criteria: zh ? ['新增 listClockOuts({timeMin,timeMax})，回傳所有已取得的打卡及 clocked_out 查詢證據；completeWithinScope 只能由最後一頁 next:null 證明。', '查詢以 clocked_out 而非 clocked_in 篩選，保留跨午夜班次；姓名只由同公司 users/{數字 ID} 核實，失敗時保留打卡及未核實標記。', '保留舊 listTimePunches 行為；限制分頁及姓名查詢數，拒絕跨公司、越界與任意 URL，禁止任何寫入，不能洩漏憑證。'] : ['Add listClockOuts({timeMin,timeMax}) returning all retrieved punch rows and clocked_out evidence; completeWithinScope requires a final next:null cursor.', 'Filter by clocked_out rather than clocked_in, retaining overnight shifts. Resolve names only through same-company users/{numeric ID}; retain punches with unresolved-name markers on lookup failures.', 'Preserve listTimePunches behavior; bound pagination and name lookups, reject foreign-company/out-of-window evidence and arbitrary URLs, forbid writes and credential leakage.'],
    impact: zh ? '此方案沿用已批准的公司連線，只新增固定 GET 姓名與下班查詢；不新增 token、外部權限或打卡寫入。' : 'Reuse the approved company connection for fixed GET names and clock-out queries. No new token, external privileges or punch writes.',
    risk: zh ? '姓名讀取或分頁可能不完整，必須明示；採納仍由 Owner 確認，新版未載入不可聲稱成功。' : 'Name lookup or pagination may be incomplete and must be disclosed. Adoption requires Owner confirmation; an unloaded build cannot count as success.', scope
  }
  return {
    goal, needs, diagnosis,
    steps: zh ? [
      '核對上述資料需求、現有能力登記、連線及本輪讀取授權，先區分缺功能、路由問題與讀取失敗。',
      gap.kind === 'not_authorised' ? '列明缺少的授權及最小讀取範圍，交由 Owner 決定；不自動開權限。' : gap.kind === 'source_unavailable' || gap.kind === 'verification_unavailable' ? '先定位並恢復已存在的讀取或核對流程；只有證據確認需要改程式才提出開發。' : '已有來源時補讀取轉接或路由；沒有來源時先提出唯讀整合及所需授權，API 與 scope 必須另行核實。',
      scope ? scope.profile === 'seven_shifts' ? '在已登記 7shifts 唯讀檔案範圍內規劃補強；保留原要求，打卡批核不在此開發範圍。沿用受保護測試、審閱及採納流程。' : '在已登記 Context 檔案範圍內規劃修正，沿用受保護測試及現有開發、審閱、採納流程。' : '建立保留原要求與驗收條件的開發交接草稿；登記固定修改範圍後才可派工。',
      '以原要求驗證讀取結果，成功後接續原問題；業務寫入仍需獨立批准。'
    ] : [
      'Check the listed evidence needs, registered capabilities, connection and turn-level read authority; distinguish missing implementation, routing and read failure.',
      gap.kind === 'not_authorised' ? 'Describe the minimum missing read authorisation for Owner review; never grant it automatically.' : gap.kind === 'source_unavailable' || gap.kind === 'verification_unavailable' ? 'Diagnose and restore the existing reader or verification path before proposing code changes.' : 'Reuse an existing reader or route where possible; otherwise propose a read-only integration and verify its API and scopes separately.',
      scope ? scope.profile === 'seven_shifts' ? 'Plan within the registered GET-only 7shifts reader file, retaining the original request. Punch approval is outside this scope. Reuse protected tests, review and adoption.' : 'Plan within the registered Context files and reuse protected tests, development review and adoption.' : 'Create a development handoff draft preserving the request and acceptance criteria; register a fixed scope before dispatch.',
      'Verify the reader against the original request, then continue it. Business writes require separate approval.'
    ],
    criteria: zh ? ['用原要求取得可核實的資料，說明來源、查詢範圍及不足。', '中英文使用同一缺口判斷；讀取失敗不誤報未實作。', '未批准不派工；不新增憑證、權限或業務寫入；回覆不聲稱未完成的工作已成功。'] : ['Obtain verifiable evidence for the original request, showing sources, scope and gaps.', 'Use the same gap states in English and Chinese; a read failure is not missing implementation.', 'No dispatch before approval, no new credentials or privileges or business writes, and no unverified completion claims.'],
    impact: zh ? '此批准只建立補強工作與已有範圍的唯讀規劃，不批准任何業務資料修改。' : 'Approval creates a remediation job and read-only planning within existing scope; it does not approve changes to business data.',
    risk: zh ? '實際風險與新增權限待連線及範圍核對後確認，不預先宣稱低風險。' : 'Actual risk and additional permissions require connection and scope checks; low risk is not presumed.',
    scope
  }
}
module.exports = { hash, keys, text, detectGap, validGap, registeredScope, proposalFor }
