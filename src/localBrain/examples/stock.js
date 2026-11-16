'use strict'
// Decimal quantities follow Number.toString()'s canonical decimal value. Box
// counts are exact integers; an unrepresentable count is a failure, not Infinity.
function decimal(value) {
  const [mantissa, exponent='0']=String(value).split('e'),digits=mantissa.replace('.','')
  return {n:BigInt(digits),scale:(mantissa.split('.')[1]?.length||0)-Number(exponent)}
}
function orderBoxes(current,par,packSize) {
  if([current,par,packSize].some(v=>typeof v!=='number'||!Number.isFinite(v))||current<0||par<0||packSize<=0)throw new RangeError('finite nonnegative quantities and a finite positive pack are required')
  if(current>=par)return 0
  const parts=[current,par,packSize].map(decimal),scale=Math.max(0,...parts.map(p=>p.scale))
  const [have,target,pack]=parts.map(p=>p.n*10n**BigInt(scale-p.scale))
  const count=(target-have+pack-1n)/pack
  if(count>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('box count exceeds safe integer range')
  return Number(count)
}
module.exports={orderBoxes}
