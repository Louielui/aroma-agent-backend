'use strict'

// Host-authored closure for an unmet evidence obligation. It never releases the
// withheld model answer, declares a source globally absent, or authorises action.
function readGapReply (message, reason) {
  const zh = /[\u3400-\u9fff]/.test(String(message || ''))
  if (reason === 'no_mapped_operation') {
    return zh
      ? '這次要求需要即時資料，但目前未找到對應的已登記讀取操作，所以不能核對所需內容。我未執行任何修改。下一步先接通對應的資料讀取與受控操作，再確認處理範圍。'
      : 'This request needs live data, but no matching registered read operation was identified for it. I cannot verify the required details. No changes were made. The next step is to connect the relevant data reader and bounded action capability, then confirm the scope.'
  }
  if (reason === 'validation_unavailable') {
    return zh
      ? '這次回覆的資料需求核對暫時不可用，尚未完成查證。我不會把未核實的內容當成答案，也未執行任何修改。需要先恢復核對流程，再繼續調查。'
      : 'The evidence-requirement check is unavailable, so verification is incomplete. I will not present an unverified answer. No changes were made. The check must be restored before the investigation continues.'
  }
  return zh
    ? '這次調查尚未取得所需的即時資料，不能核實完整答案；這不代表資料不存在，也不代表相關功能未實作。我未執行任何修改。下一步先檢查所需來源的連線、讀取權限與查詢範圍，再繼續核對。'
    : 'This investigation did not obtain the required live evidence, so a complete answer remains unverified. This does not prove that the data is absent or that the capability is unimplemented. No changes were made. The next step is to check the relevant source connection, read authorisation and query scope.'
}

function hasOnlyUnmappedRequiredFacts (state) {
  const required = state?.facts?.filter(f => f.necessity === 'required') || []
  return required.length > 0 && required.every(f => f.readState === 'no_system_operation')
}

module.exports = { readGapReply, hasOnlyUnmappedRequiredFacts }
