'use strict'
// Matching tokens are deliberately separate from translated presentation.
function requestKind(message){
 if(typeof message!=='string'||message.length>150)return null
 const v=message.trim().replace(/[。！？?!.,，；;\s]/gu,'').toLowerCase()
 if(/^(?:請|可以)?(?:幫我|替我)?(?:補齊|補全)(?:答案|缺漏|缺漏部分)?$/.test(v)||/^(?:哪(?:一)?段不完整|哪(?:一)?部分不完整)(?:請)?幫我(?:補齊|補全)$/.test(v)||/^(?:please)?(?:complete|fillin)(?:the)?(?:missingpart|missingparts|gaps)(?:oftheanswer)?$/.test(v))return 'complete'
 if(/^(?:哪(?:一)?段不完整|哪(?:一)?部分不完整|缺(?:了)?(?:什麼|甚麼))$/.test(v)||/^(?:whichpartisincomplete|whatis(?:missing|incomplete))$/.test(v))return 'inspect'
 return null
}
module.exports={requestKind}
