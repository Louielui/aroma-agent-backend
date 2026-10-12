'use strict'
const { validateAromaRequest }=require('./aromaContext')
function aromaIntent (message) {
  if(typeof message!=='string')return null
  const value=message.trim().replace(/[。！!？?]+$/,'').trim()
  if(/^(?:香香[，,\s]*)?(?:(?:請|幫我)?(?:查看|列出|查詢)(?:目前|現在)?(?:的)?補貨建議|(?:目前|現在)有哪些補貨建議)$/u.test(value)||/^show replenishment suggestions$/i.test(value))return {resource:'aroma.order_planning',operation:'list',input:{}}
  if(/^(?:香香[，,\s]*)?(?:請|幫我)?(?:查看|列出|查詢)(?:目前|現在)?(?:的)?發票紀錄$/u.test(value)||/^show invoice records$/i.test(value))return {resource:'aroma.invoices',operation:'list',input:{}}
  return null
}
function createAromaContextService ({gateway,verify}) {
  return Object.freeze({verify,async read(actor,resource,operation,input={}){
    if(actor?.role!=='owner')throw Error('permission_denied')
    const normalized=validateAromaRequest(resource,operation,input);verify()
    const pack=await gateway[operation](actor,resource,normalized);verify()
    return {version:1,pack,modelCalls:0}
  }})
}
module.exports={aromaIntent,createAromaContextService}
