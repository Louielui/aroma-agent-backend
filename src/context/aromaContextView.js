'use strict'
const fs=require('node:fs'),path=require('node:path'),{t}=require('../i18n/t')
function businessLabels(){return {suggested_order_qty:t('aromaContext.quantity'),live_qty:t('aromaContext.current'),par_level:t('aromaContext.par'),total:t('aromaContext.total'),currency:t('aromaContext.currency'),status:t('aromaContext.status'),unit:t('aromaContext.unit')}}
function aromaReply(report){
  const p=report.pack;if(p.state!=='ok')return t('aromaContext.error')
  const labels=businessLabels(),rows=p.content.slice(0,10).map(row=>t('aromaContext.replyItem',{name:row.title||row.sourceId,id:row.sourceId,date:row.originalDate||t('live.unknown'),values:Object.entries(labels).filter(([k])=>Object.hasOwn(row.fields,k)).map(([k,label])=>label+' '+row.fields[k]).join(' · ')||t('live.unknown')})).join('\n')
  return t('aromaContext.reply',{name:p.resource==='aroma.invoices'?t('aromaContext.invoices'):t('aromaContext.planning'),count:p.count,shown:Math.min(10,p.count),scope:p.coverage.scope,
    complete:p.coverage.complete===true?t('aromaContext.scopeComplete'):p.coverage.complete===false?t('live.partial'):t('live.unknown'),at:p.retrievedAt,asOf:p.coverage.dataAsOf||t('live.unknown'),rows:rows||t('aromaContext.empty')})
}
function buildAromaContextHtml(){
  const labels={title:t('aromaContext.title'),intro:t('aromaContext.intro'),back:t('manager.back'),architecture:t('architecture.title'),github:t('live.title'),drive:t('driveContext.title'),
    planning:t('aromaContext.planning'),invoices:t('aromaContext.invoices'),list:t('aromaContext.list'),metadata:t('aromaContext.metadata'),search:t('driveContext.search'),get:t('aromaContext.get'),
    query:t('aromaContext.query'),sourceId:t('aromaContext.sourceId'),idle:t('aromaContext.idle'),loading:t('aromaContext.loading'),error:t('aromaContext.error'),empty:t('aromaContext.empty'),
    count:t('live.count'),fetched:t('live.fetched'),original:t('live.original'),unknown:t('live.unknown'),scope:t('live.scope'),complete:t('live.complete'),full:t('aromaContext.scopeComplete'),partial:t('live.partial'),truncated:t('live.truncated'),
    asOf:t('aromaContext.asOf'),limits:t('aromaContext.limits'),reader:t('aromaContext.reader'),details:t('live.details'),source:t('live.source'),ownerOnly:t('aromaContext.ownerOnly'),
    audit:t('live.audit'),auditEmpty:t('live.auditEmpty'),auditError:t('live.auditError'),fields:businessLabels()}
  return fs.readFileSync(path.join(__dirname,'aromaContextView.html'),'utf8').replace('/*LABELS*/{}',JSON.stringify(labels).replace(/</g,'\\u003c'))
}
module.exports={buildAromaContextHtml,aromaReply}
