'use strict'
const f=require('node:fs'),p=require('node:path'),assert=require('node:assert/strict')
const {chromium}=require('playwright-core')
const {execFileSync}=require('node:child_process')
const stage=p.resolve(__dirname,'../../..')
const ready=f.readFileSync(p.join(stage,'owner-entry.html'),'utf8').match(/href="([^"]+)"/)?.[1]
const record=JSON.parse(f.readFileSync(p.join(stage,'engine-owner.lock'),'utf8'))
const origin=new URL(ready).origin
async function main(){
  const candidates=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
  const executablePath=candidates.find(f.existsSync)
  if(!executablePath)throw Error('Chromium not present')
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync']})
  try{
    const page=await browser.newPage({viewport:{width:1120,height:880}})
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort())
    await page.goto(ready)
    await page.waitForFunction(()=>!document.querySelector('#send').disabled,{},{timeout:20000})
    assert.equal(new URL(page.url()).hash,'')
    const unauth=await page.evaluate(async()=>{const r=await fetch('/status');return r.status})
    assert.equal(unauth,401)
    const wrongOrigin=await fetch(origin+'/chat',{method:'POST',headers:{origin:'http://127.0.0.1:1','content-type':'application/json'},body:'{}'})
    assert.equal(wrongOrigin.status,403)
    async function send(text,count){
      await page.locator('#message').fill(text)
      await page.locator('#send').click()
      await page.waitForFunction(n=>document.querySelectorAll('article.assistant').length===n&&!document.querySelector('#send').disabled,count,{timeout:180000})
      return page.locator('article.assistant').last().textContent()
    }
    const first=await send('虛構活動安排。阿晴星期三 14:05 喺墨梅室派金票。用一句重述。',1)
    assert.match(first,/阿晴/);assert.match(first,/墨梅室/)
    assert.equal(await page.locator('#arm').isDisabled(),true)
    const engines=p.join(record.root,'engines.jsonl')
    const active=()=>f.readFileSync(engines,'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(e=>e.type==='engine_start').at(-1)
    const prior=active()
    assert.equal(prior.engine,'strata')
    assert.ok(Number.isSafeInteger(prior.pid))
    const cmd=execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command','(Get-CimInstance Win32_Process -Filter "ProcessId='+prior.pid+'").CommandLine'],{encoding:'utf8',windowsHide:true})
    assert.ok(cmd.includes(record.root)&&cmd.includes('strata.py'))
    execFileSync('taskkill.exe',['/PID',String(prior.pid),'/T','/F'],{windowsHide:true})
    const second=await send('改用白票，其他照舊。畀我成句。',2)
    assert.match(second,/白票/);assert.match(second,/阿晴/)
    assert.notEqual(active().pid,prior.pid)
    await page.screenshot({path:p.join(record.root,'owner-desktop.png')})
    await page.setViewportSize({width:412,height:780})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({path:p.join(record.root,'owner-mobile.png')})
    await page.locator('#new').click()
    assert.equal(await page.locator('#arm').isDisabled(),false)
    assert.equal(await page.locator('article').count(),0)
    await page.locator('#mode').selectOption('proposal')
    const resultEvent=await send('準備一項隔離測試變更提議，將 F-28 備註改成「轉交夜班覆核」。',1)
    assert.match(resultEvent,/已提出/)
    await page.locator('#proposal button').waitFor({state:'visible'})
    await page.locator('#mode').selectOption('chat')
    await send('好。',2)
    const turnsFile=p.join(record.root,'turns.jsonl')
    const approvals=()=>f.readFileSync(turnsFile,'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(e=>e.type==='fixture_owner_approval')
    assert.equal(approvals().length,0)
    await page.locator('#proposal button').click()
    await page.waitForFunction(()=>document.getElementById('proposal').textContent.includes('已更新隔離測試記錄'))
    assert.equal(approvals().length,1)
    const [approval]=approvals()
    const replay=await page.evaluate(async row=>{
      const r=await fetch('/approve',{method:'POST',headers:{authorization:'Bearer '+sessionStorage.getItem('xxnext'),'content-type':'application/json'},
        body:JSON.stringify({conversation:row.sessionId,id:row.id})})
      return r.status
    },approval)
    assert.equal(replay,400)
    await page.locator('#new').click()
    await page.locator('#mode').selectOption('analysis')
    const analysis=await send('虛構簡餐店：前一週 120 單、收入 $6,000、購入 $1,740；今週 90 單、收入 $5,400、購入 $1,890。逐項算單量變幅、兩週每單收入、兩週購入佔比，解釋能否因此確認食材耗用升。',1)
    const result={analysis,fixtureApproval:true,fixtureReplayRejected:replay,chatMutationCount:0,desktop:true,mobile:true,restartedSameEngine:true,priorPid:prior.pid,newPid:active().pid,
      deniedWithoutSession:unauth,wrongOriginDenied:wrongOrigin.status,first,second}
    f.writeFileSync(p.join(record.root,'owner-browser-proof.json'),JSON.stringify(result,null,2))
    console.log(JSON.stringify({result,root:record.root}))
  }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
