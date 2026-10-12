'use strict'
// Matching rules only. A rejected turn retains no text in the capture queue.
function exclusionReason(text, optOut = true) {
  if (optOut && /(?:不要|唔好|別|不需要).{0,12}(?:記|记|保存)|(?:do not|don't|never)\s+(?:remember|save|store|record)|(?:forget|忘記|忘记).{0,20}(?:this|這|这|件|段)/iu.test(text)) return 'owner_opt_out'
  if (/(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|密碼|密码|金鑰|私鑰)\s*(?:[:=：]|是|為|为)|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/iu.test(text)) return 'sensitive_content'
  return null
}
module.exports = { exclusionReason }
