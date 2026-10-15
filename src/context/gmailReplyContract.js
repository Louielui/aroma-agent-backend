'use strict'
const {GMAIL_ID:ID,GMAIL_EMAIL:EMAIL,validGmailLocator:validLocator}=require('../browserRead/contract')
function replyRequest(q){return typeof q==='string'&&!/^(?:不要|不需要|唔好|例子|例如|do not\b|don't\b|example|[「“"'])/iu.test(q.trim())&&require('../intake/laneRouter').routeLane(q).lane==='email_draft'&&/這封|呢封|这封|目前|當前|current|this\s+(?:e-?mail|message)/iu.test(q)}
module.exports={ID,EMAIL,validLocator,replyRequest}
