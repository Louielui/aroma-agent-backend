'use strict'
// Display only: never parse a local string back into an approval deadline.
// Manitoba law and IANA 2026e: permanent UTC-05 from 2026-10-31.
// https://www.gov.mb.ca/timechange/ and https://www.iana.org/time-zones/releases/2026e
// Keep this narrow compatibility rule while the host ships pre-2026e tzdata.
const PERMANENT_FROM=Date.UTC(2026,9,31,5),TIME_ZONE='America/Winnipeg'
function approvalExpiryDisplay(epoch){
 if(!Number.isSafeInteger(epoch)||epoch<0||epoch>253402300799999)return null
 const utc=new Date(epoch).toISOString();let offset=-300,rule='manitoba-permanent-05-2026'
 if(epoch<PERMANENT_FROM){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(epoch)
  const n=type=>Number(parts.find(p=>p.type===type)?.value)
  offset=(Date.UTC(n('year'),n('month')-1,n('day'),n('hour'),n('minute'),n('second'))-Math.floor(epoch/1000)*1000)/60000
  if(!Number.isSafeInteger(offset)||Math.abs(offset)>840)return null
  rule='host-iana-before-mbt-2026'
 }
 const sign=offset<0?'-':'+',abs=Math.abs(offset),pad=n=>String(n).padStart(2,'0')
 const local=new Date(epoch+offset*60000).toISOString().replace('T',' ').replace(/Z$/,'')+' UTC'+sign+pad(Math.floor(abs/60))+':'+pad(abs%60)
 return{epoch,utc,local,timeZone:TIME_ZONE,rule}
}
module.exports={approvalExpiryDisplay}
