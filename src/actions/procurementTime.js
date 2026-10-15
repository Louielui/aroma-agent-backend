'use strict'
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Winnipeg',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
function parts(date){const d=new Date(date);if(!Number.isFinite(+d))throw Error('invalid_time');return Object.fromEntries(formatter.formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]))}
function dateKey(date){const p=parts(date);return p.year+'-'+p.month+'-'+p.day}
function atEight(day){const target=Date.parse(day+'T08:00:00Z');let instant=target;for(let i=0;i<3;i++){const p=parts(instant),shown=Date.parse(p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second+'Z');instant+=target-shown}const d=new Date(instant).toISOString();if(dateKey(d)!==day||parts(d).hour!=='08')throw Error('invalid_time');return d}
function occurrence(now){const day=dateKey(now),scheduledAt=atEight(day);return{serviceDate:day,scheduledAt,due:Date.parse(now)>=Date.parse(scheduledAt),latenessMs:Math.max(0,Date.parse(now)-Date.parse(scheduledAt))}}
function next(now){const o=occurrence(now);if(!o.due)return o.scheduledAt;const day=new Date(Date.parse(o.serviceDate+'T12:00:00Z')+86400000).toISOString().slice(0,10);return atEight(day)}
module.exports={occurrence,next,dateKey,atEight}
