'use strict'
// Input matching is independent of display translations.
function followupRequest (message) {
  return typeof message === 'string' && message.length <= 500 && !/(?:不要|不用|唔好|don't|do not|寄|send|刪|delete|payroll|批准薪資)/i.test(message) &&
    /(?:報告|結果|report|results?)/i.test(message) && /(?:跟進清單|待辦|follow[ -]?up (?:list|items)|tracking list)/i.test(message) && /(?:整理|建立|加入|把|create|prepare|organize|add)/i.test(message)
}
function recheckRequest (message) {
  return typeof message === 'string' && message.length <= 500 && !/[「」“”"]/u.test(message) && !/(?:不要|不用|唔好|don't|do not|寄|send|刪|delete|payroll|薪資|修改打卡|改.*打卡|直接.*完成|mark.*done|automatically)/i.test(message) &&
    /(?:HR|人力資源|人事|human resources)/i.test(message) && /(?:跟進|待辦|follow[ -]?ups?|tracking)/i.test(message) &&
    /(?:重新查|重新核對|重查|再查|recheck|re-check|check again|refresh)/i.test(message)
}
module.exports = { followupRequest, recheckRequest }
