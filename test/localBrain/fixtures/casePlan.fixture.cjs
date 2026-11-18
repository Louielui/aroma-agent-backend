'use strict'
// Synthetic protocol data only; never a saved model response or execution receipt.
function synthetic(spec){
 const tests=Object.fromEntries(spec.tests.map(t=>[t.id,{title:'Synthetic protocol fixture '+t.id,groups:[],rejections:Object.fromEntries(t.rejections.map(r=>[r.id,[r.expression,r.error]]))}]))
 tests.c1.groups=[{method:'equal',rows:[['3','10','4','2'],['0.1','0.4','0.1','3'],['0','1.1','0.1','11'],['1.01','1.04','0.01','3'],['12','10','4','0'],['0','Number.MIN_VALUE','Number.MIN_VALUE','1'],['0','Number.MAX_SAFE_INTEGER','1','Number.MAX_SAFE_INTEGER']]},{method:'throws',rows:[['0','Number.MAX_VALUE','Number.MIN_VALUE','RangeError'],...['NaN','Infinity','-Infinity',"'2'",'undefined','null','true','{}','[]'].flatMap(v=>[0,1,2].map(i=>{const a=['1','3','1'];a[i]=v;return[...a,'RangeError']}))]}]
 tests.c2.groups=[{method:'equal',rows:[['0',"'0m 0s'"],['59',"'0m 59s'"],['60',"'1m 0s'"],['119',"'1m 59s'"],['120',"'2m 0s'"],['3600',"'60m 0s'"],['Number.MAX_SAFE_INTEGER',"'150119987579016m 31s'"]]},{method:'throws',rows:['Number.MAX_SAFE_INTEGER+1','-1','1.5','NaN','Infinity',"'60'",'null','undefined','{}','60n'].map(v=>[v,'RangeError'])}]
 tests.c3.groups=[{method:'equal',rows:[['0',"'00:00:00'"],['9',"'00:00:09'"],['59',"'00:00:59'"],['60',"'00:01:00'"],['3599',"'00:59:59'"],['3600',"'01:00:00'"],['86399',"'23:59:59'"],['86400',"'24:00:00'"],['360000',"'100:00:00'"],['Number.MAX_SAFE_INTEGER',"'2501999792983:36:31'"]]}]
 return{protocol:spec.version,tests}
}
module.exports={synthetic}
