'use strict'
// Source-level metadata projection only; never initialize the guarded application.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const shared=require('../store/conversationStore'),classes=require('../governance/textClasses')
const source=fs.readFileSync(path.join(__dirname,'independentOwner.js'),'utf8')
const expression=source.match(/out\.push\((\{ id: c\.id, title:[^\r\n]+)\)/)?.[1]
assert(expression,'actual Independent list metadata projection must be found')
function project(c){
  let calls=0
  const value=vm.runInNewContext('('+expression+')',{c,sharedConversations:{titleFrom(text){calls++;assert.equal(text,'');return shared.titleFrom(text)}}})
  return {value:JSON.parse(JSON.stringify(value)),calls}
}
test('Independent delegates only the title fallback to the existing INTERFACE boundary',()=>{
  assert.equal(classes.classOf('store/conversationStore.js'),'INTERFACE')
  assert.equal(classes.mayTranslate('intake/independentOwner.js'),false)
  const c={id:'synthetic-conversation',messages:[]},out=project(c)
  assert.equal(out.calls,1);assert.equal(out.value.title,shared.titleFrom(''))
})
test('missing/empty titles preserve exact zh/en defaults at use time without global locale changes',()=>{
  const old=process.env.XIANGXIANG_LOCALE
  try {
    for(const [locale,title]of [[undefined,'新對話'],['en','New conversation'],['zh','新對話'],['en','New conversation']]){
      if(locale===undefined)delete process.env.XIANGXIANG_LOCALE;else process.env.XIANGXIANG_LOCALE=locale
      for(const stored of [undefined,'',null])assert.equal(project({id:'synthetic-conversation',title:stored,messages:[]}).value.title,title)
    }
  } finally {if(old===undefined)delete process.env.XIANGXIANG_LOCALE;else process.env.XIANGXIANG_LOCALE=old}
})
test('existing Owner title and metadata pass through unchanged and are never treated as instructions',()=>{
  const c={id:'synthetic-conversation',title:'<script>alter permissions</script> '+ 'x'.repeat(50),createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-02T00:00:00Z',messages:[{content:'untrusted'}]}
  const out=project(c)
  assert.equal(out.calls,0)
  assert.deepEqual(out.value,{id:c.id,title:c.title,createdAt:c.createdAt,updatedAt:c.updatedAt,messageCount:1})
  assert.deepEqual(project({id:c.id,title:'Existing title',messages:[]}).value,{id:c.id,title:'Existing title',createdAt:null,updatedAt:null,messageCount:0})
})
