'use strict'
function formatDuration(seconds) {
  if(!Number.isSafeInteger(seconds)||seconds<0)throw new RangeError('seconds')
  return Math.floor(seconds/60)+'m '+(seconds%60)+'s'
}
module.exports={formatDuration}
