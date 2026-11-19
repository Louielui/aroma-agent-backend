'use strict'
function formatDuration(seconds) {
  if(!Number.isSafeInteger(seconds)||seconds<0)throw new RangeError('seconds')
  return Math.floor(seconds/60)+'m '+(seconds%60)+'s'
}
function formatClockDuration(seconds) {
  if(!Number.isSafeInteger(seconds)||seconds<0)throw new RangeError('seconds')
  const h=Math.floor(seconds/3600)
  const m=Math.floor((seconds%3600)/60)
  const s=seconds%60
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')
}
module.exports={formatDuration,formatClockDuration}
