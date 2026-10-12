'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
test('browser model history retains ordinary replies exactly but never retains a source-bound mail body', () => {
  const source = fs.readFileSync(path.join(__dirname,'assets/app.js'),'utf8')
  const helper = source.match(/function assistantHistory \(response\) \{[\s\S]*?\n  \}/)
  assert.ok(helper,'history privacy helper exists in the shipped browser asset')
  const build = vm.runInNewContext('('+helper[0]+')',{t:key=>{assert.equal(key,'company.mailHistoryReceipt');return 'Neutral source receipt'}})
  const ordinary = {reply:'Ordinary answer exactly',sourceBound:false}
  const mail = {reply:'PRIVATE MAIL BODY',sourceBound:true}
  assert.equal(build(ordinary).text,ordinary.reply)
  assert.equal(build({reply:'Legacy ordinary response'}).text,'Legacy ordinary response')
  const entry=build(mail)
  assert.equal(entry.text,'Neutral source receipt');assert.equal(entry.sourceBound,true)
  assert.equal(mail.reply,'PRIVATE MAIL BODY','the displayed answer remains available to render')
  assert.equal(JSON.stringify(entry).includes('PRIVATE MAIL BODY'),false)
})
