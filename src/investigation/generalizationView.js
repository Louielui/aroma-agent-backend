 'use strict'
const zhFor=message=>/[\u3400-\u9fff]/.test(message)
const safe=value=>String(value??'').replace(/[<>`\r\n]/g,' ').slice(0,180)
function evidencePrompt(report) {
 const e=report.evidenceModel
 const allowed=new Set(report.routing?.localSections||[])
 const rows=(e?.assertions||[]).filter(a=>allowed.has(a.subject.split(':')[0])||a.subject.startsWith('external_')).slice(0,24)
 // Full receipts stay server-side. Never replay source text or arbitrary object bodies.
 const assertions=rows.map(({id,sourceId,recordId,facet,temporalScope,state,value,observedAt})=>({id,sourceId,recordId,facet,temporalScope,state,observedAt,
  value:value===null||typeof value==='boolean'||typeof value==='number'?value:typeof value==='string'?safe(value):'[structured receipt retained]'}))
 return {route:report.routing,scope:e?.scope,assertions,
  omitted:Math.max(0,(e?.assertions?.length||0)-rows.length)+(e?.omitted||0),contradictions:e?.contradictions?.slice(0,4),transitions:e?.transitions?.slice(0,4)}
}
function renderGeneralization(report,message='') {
 if(!report?.routing||!report?.evidenceModel)return null
 const zh=zhFor(message),e=report.evidenceModel,lines=[]
 const state=n=>({CONFIRMED:zh?'已確認':'confirmed',SUPPORTED:zh?'有來源支持':'supported',CANDIDATE:zh?'候選線索':'candidate',CONTRADICTED:zh?'資料矛盾':'contradicted',UNKNOWN:zh?'未知':'unknown',UNAVAILABLE:zh?'來源無法讀取':'unavailable'}[n]||n)
 const refs=a=>a?.sourceId?(zh?'來源：':'source: ')+safe(a.sourceId)+(a.recordId?' / '+safe(a.recordId):''):''
 if(report.focus==='work_failure'&&!e.contradictions.length) {
  const work=report.sections.find(s=>s.section==='work'),records=work?.records||[]
  const target=records.find(r=>r.sourceId===work?.latestFailureId)||records.find(r=>['failed','timed_out','needs_attention'].includes(r.state))
  if(target) {
   const rows=e.assertions.filter(a=>a.sourceId===work.sourceId&&a.recordId===target.sourceId)
   const source=rows.find(a=>a.facet==='registered_file_comparison'),tests=rows.find(a=>a.facet==='candidate_tests')
   lines.push(zh?'同一任務的證據核對：':'Evidence checks for the same task:')
   if(source?.state==='CONFIRMED') {
    lines.push((zh?'登記檔案比對結果（無法讀取者另列）：':'Registered file comparison results (unavailable files listed separately): ')+target.sourceFiles.map(f=>safe(f.path)+' — '+safe(f.comparison)).join('; ')+'. '+refs(source))
   }else lines.push((zh?'目前程式比對：':'Current source comparison: ')+state(source?.state||'UNKNOWN')+'. '+refs(source))
   if(tests?.state==='CONFIRMED') lines.push((zh?'候選版本的測試紀錄：':'Candidate-version test record: ')+JSON.stringify(target.tests)+'. '+refs(tests))
   else lines.push((zh?'同一任務的測試紀錄：':'Test record for this task: ')+state(tests?.state||'UNKNOWN')+'. '+refs(tests))
   lines.push(zh?'目前是否修好：未知。以上檔案或候選測試紀錄，不等於同一故障已在目前載入版本通過驗證。':'Fixed in the currently loaded version: unknown. File comparisons or candidate tests do not establish same-failure verification in the loaded version.')
  }
 }
 if(report.focus==='background') {
  for(const s of report.sections.filter(s=>s.section==='schedules'&&['ok','partial'].includes(s.state))) {
   for(const r of (s.records||[]).filter(r=>r.sourceId?.startsWith('codex-automation:')).slice(0,8)) {
    const rows=e.assertions.filter(a=>a.sourceId===s.sourceId&&a.recordId===r.sourceId)
    const model=rows.find(a=>a.facet==='configured_model'),enabled=rows.find(a=>a.facet==='enabled'),running=rows.find(a=>a.facet==='running')
    const observed=a=>a?.state==='CONFIRMED'?safe(a.value):state(a?.state||'UNKNOWN')
    const enabledText=enabled?.state==='CONFIRMED'?(enabled.value?(zh?'啟用':'enabled'):(zh?'停用':'disabled')):state(enabled?.state||'UNKNOWN')
    lines.push((zh?'已登記排程：':'Registered schedule: ')+safe(r.name||r.sourceId)+(zh?'；目前設定模型：':'; currently configured model: ')+observed(model)+(zh?'；定義：':'; definition: ')+enabledText+(zh?'；即時活動：':'; live activity: ')+observed(running)+'. '+refs(model))
   }
  }
  lines.push(zh?'建議：如要核對某項工作的用量，下一步應比對同一工作識別碼的執行紀錄與實際模型回報。這次沒有暫停排程或修改設定。':'Recommendation: to investigate usage for a job, compare execution records with observed model results for that same job identity. No schedule was paused and no setting was changed.')
  lines.push(zh?'狀態判讀：目前設定、目前啟用、歷史執行和即時活動分開核對。設定的模型不等於某次呼叫實際使用的模型；即時活動只代表讀取時間。':'State interpretation: current configuration, enablement, historical execution and live activity are checked separately. A configured model is not proof of the model used by an invocation; live activity applies only at the observation time.')
 }
 for(const f of report.routing.unmappedFacts||[]) lines.push((zh?'尚未取得的資料需求：':'Unresolved evidence need: ')+safe(f.need)+' — '+state(f.status)+(f.operation?' ('+safe(f.operation)+')':'')+'.')
 const unavailable=e.coverage.filter(c=>c.state==='UNAVAILABLE'&&!(report.focus!=='cost'&&c.section==='billing'))
 if(unavailable.length) lines.push((zh?'未能讀取的來源：':'Unavailable sources: ')+unavailable.map(c=>safe(c.section)+' ('+safe(c.sourceId)+')').join('; ')+(zh?'；不能當成沒有資料。':'; this is not evidence of no records.'))
 for(const c of e.contradictions.slice(0,3)) lines.push((zh?'資料矛盾：':'Conflicting evidence: ')+safe(c.subject)+' / '+safe(c.facet)+(zh?' 在同一觀察時間有不同值，暫不選其中一個作結論。':' has different values for the same observation time; neither is selected as the conclusion.'))
 const grades=Object.entries(e.counts).filter(([,n])=>n>0).map(([s])=>state(s))
 if(grades.length) lines.push((zh?'本次取樣的證據分級：':'Evidence grades in this sample: ')+grades.join(' / ')+(zh?'。分級針對每一項說法，並非整個來源都已證實。':'. Grades apply to individual assertions, not blanket verification of a source.'))
 if(report.focus==='general'||e.contradictions.length) lines.push(zh?'建議：先核對上述缺口及矛盾來源，再決定處理方案。本次僅調查，沒有執行管理動作。':'Recommendation: verify the missing or conflicting evidence before deciding on a remedy. This investigation performed no management actions.')
 return lines.join('\n\n')||null
}
module.exports={evidencePrompt,renderGeneralization}
