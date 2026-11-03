'use strict'
const { currentLocale } = require('../../i18n/t')
// Kept outside the chat renderer's catalogue so a result-page fix does not
// invalidate the source dependencies of an already reviewed UI candidate.
function resultLabels () {
  return currentLocale() === 'en' ? {
    evidenceExcerpt: 'Changed lines and context', loadEvidence: 'Load complete evidence', moreEvidence: 'Load next section', evidenceSummaryNote: 'Summary only. Complete source and logs load on request; canonical history is retained.', codexThread: 'Actual coding thread', codexUnverified: 'Desktop visibility not verified', measuredTests:'Recorded test results',measuredReview:'Recorded review',candidateHeld:'Candidate prepared; not deployed',
    resultTitle: 'Results for this task',
    omittedWork: 'Additional work omitted from this bounded overview; open it from the original conversation:',
    resultIntro: 'Preview this task’s changes, then decide whether to adopt them. Viewing these isolated previews applies no changes; adoption status is shown below.',
    resultMissing: 'This task could not be found. Return to the original conversation and open its results again.',
    backChat: 'Back to chat',
    visualNotes: 'Screen review notes',
    resultArchitecture: 'Chat result links load the exact task and open its screen previews. Before/after controls read the original and candidate hashed Sandbox screenshots separately; missing original evidence never substitutes a current screen. Adoption still requires separate confirmation; missing records never fall back to a different task. Planning and task source checks accept unchanged Windows CRLF bytes; real edits, staged changes and revision drift remain blocked. Model catalogue reads coalesce on a separate metadata session and do not compete with the execution lane. Large results use bounded summaries and hash-bound evidence pages without trimming canonical history. Registered coding can retain its actual tool-disabled provider thread; work-stage title updates use metadata only. Desktop visibility remains a separate real acceptance gate.'
  } : {
    evidenceExcerpt: '變更行及上下文節錄', loadEvidence: '載入完整證據', moreEvidence: '載入下一段', evidenceSummaryNote: '目前顯示摘要；完整原始碼及紀錄按需載入，原始歷史完整保留。',codexThread:'實際改碼聊天',codexUnverified:'尚未核對 App 可見性',measuredTests:'實際測試結果',measuredReview:'實際審查',candidateHeld:'候選已準備，尚未部署',
    resultTitle: '這次工作的成果',
    omittedWork: '以下摘要另有工作未載入，請由原對話開啟指定工作：',
    resultIntro: '先查看這次改動的畫面，再決定是否採用。預覽來自隔離環境；查看預覽不會套用改動，採用狀態列於下方。',
    resultMissing: '找不到這次工作的紀錄，請回到原對話重新開啟成果。',
    backChat: '返回香香對話',
    visualNotes: '畫面檢查說明',
    resultArchitecture: '聊天的「查看成果」依任務編號直接載入對應工作並展開畫面預覽。「修改前／修改後」分別讀取該工作的原始及修改後 Sandbox 雜湊截圖；缺少原始證據不會以現在畫面代替。採用仍須另行確認，找不到紀錄不會改顯示其他工作。規劃及派工檢查接受內容未變的 Windows 換行格式；真正修改、已暫存變更及版本漂移仍會阻擋。模型清單以獨立讀取連線合併並行請求，不會與派工通道互相阻擋。大型結果使用有界摘要及雜湊綁定的證據分頁，原始歷史不刪減。已批准的登記改碼工作可保留實際的唯讀工具受限 provider 聊天，階段標題更新只用本機中繼資料；Codex App 可見性仍須另外真實驗收。'
  }
}
module.exports = { resultLabels }
