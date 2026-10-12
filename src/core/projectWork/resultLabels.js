'use strict'
const { currentLocale } = require('../../i18n/t')
// Kept outside the chat renderer's catalogue so a result-page fix does not
// invalidate the source dependencies of an already reviewed UI candidate.
function resultLabels () {
  return currentLocale() === 'en' ? {
    resultTitle: 'Results for this task',
    resultIntro: 'Preview this task’s changes, then decide whether to adopt them. Viewing these isolated previews applies no changes; adoption status is shown below.',
    resultMissing: 'This task could not be found. Return to the original conversation and open its results again.',
    backChat: 'Back to chat',
    visualNotes: 'Screen review notes',
    resultArchitecture: 'Chat result links load the exact task and open its screen previews. Before/after controls read the original and candidate hashed Sandbox screenshots separately; missing original evidence never substitutes a current screen. Adoption still requires separate confirmation; missing records never fall back to a different task. Planning and task source checks accept unchanged Windows CRLF bytes; real edits, staged changes and revision drift remain blocked. Model catalogue reads coalesce on a separate metadata session and do not compete with the execution lane.'
  } : {
    resultTitle: '這次工作的成果',
    resultIntro: '先查看這次改動的畫面，再決定是否採用。預覽來自隔離環境；查看預覽不會套用改動，採用狀態列於下方。',
    resultMissing: '找不到這次工作的紀錄，請回到原對話重新開啟成果。',
    backChat: '返回香香對話',
    visualNotes: '畫面檢查說明',
    resultArchitecture: '聊天的「查看成果」依任務編號直接載入對應工作並展開畫面預覽。「修改前／修改後」分別讀取該工作的原始及修改後 Sandbox 雜湊截圖；缺少原始證據不會以現在畫面代替。採用仍須另行確認，找不到紀錄不會改顯示其他工作。規劃及派工檢查接受內容未變的 Windows 換行格式；真正修改、已暫存變更及版本漂移仍會阻擋。模型清單以獨立讀取連線合併並行請求，不會與派工通道互相阻擋。'
  }
}
module.exports = { resultLabels }
