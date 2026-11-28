'use strict'

function createLifecycle({idleMs=0,unload,isLoaded=()=>true,onIdleError=()=>{},
  setTimer=setTimeout,clearTimer=clearTimeout}){
  let next=Promise.resolve()
  let pending=0, closed=null, idle=null, revision=0
  function disarm(){
    revision++
    if(idle!==null)clearTimer(idle)
    idle=null
  }
  function arm(){
    if(!idleMs||pending||closed||!isLoaded())return
    const expected=revision
    idle=setTimer(()=>{
      if(revision!==expected||pending||closed)return
      idle=null
      return schedule(()=>unload('idle'),false).catch(onIdleError)
    },idleMs)
    idle?.unref?.()
  }
  function schedule(fn,rearm=true){
    disarm()
    pending++
    const current=next.then(fn).finally(()=>{
      pending--
      if(rearm)arm()
    })
    next=current.catch(()=>{})
    return current
  }
  function run(fn){
    if(closed)return Promise.reject(Error('local_engine_manager_closed'))
    return schedule(fn)
  }
  function release(){
    if(closed)return Promise.reject(Error('local_engine_manager_closed'))
    if(pending)return Promise.reject(Error('local_engine_busy'))
    return schedule(()=>unload('manual'),false)
  }
  function close(){
    closed||=schedule(()=>unload('shutdown'),false)
    return closed
  }
  return {run,release,close,restart:()=>run(()=>unload('restart')),busy:()=>pending>0,idleMs}
}

module.exports={createLifecycle}
