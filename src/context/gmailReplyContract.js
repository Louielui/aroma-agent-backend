'use strict'
const ID=/^[a-f0-9]{1,100}$/,EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
function validLocator(v){return !!v&&Object.keys(v).sort().join(',')==='accountEmail,kind,messageId,routeToken,threadId'&&v.kind==='gmail_message'&&typeof v.accountEmail==='string'&&v.accountEmail.length<=254&&EMAIL.test(v.accountEmail)&&ID.test(v.messageId||'')&&ID.test(v.threadId||'')&&typeof v.routeToken==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(v.routeToken)}
function replyRequest(q){return typeof q==='string'&&!/^(?:不要|不需要|唔好|例子|例如|do not\b|don't\b|example|[「“"'])/iu.test(q.trim())&&require('../intake/laneRouter').routeLane(q).lane==='email_draft'&&/這封|呢封|这封|目前|當前|current|this\s+(?:e-?mail|message)/iu.test(q)}
module.exports={ID,EMAIL,validLocator,replyRequest}
