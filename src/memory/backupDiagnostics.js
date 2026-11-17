'use strict'
const PHASES=Object.freeze(['stage_files','snapshot_database','verify_database','seal_bundle','restore_files'])
const milliseconds=v=>Number.isSafeInteger(v)&&v>=0&&v<=300000
function safeDiagnostic(value){
 if(!value||value.version!==1||!['unknown',...PHASES].includes(value.phase)||value.lastCompletedPhase!==null&&!PHASES.includes(value.lastCompletedPhase)||!milliseconds(value.elapsedMs)||!milliseconds(value.phaseElapsedMs)||value.phaseElapsedMs>value.elapsedMs)return null
 return{version:1,phase:value.phase,lastCompletedPhase:value.lastCompletedPhase,elapsedMs:value.elapsedMs,phaseElapsedMs:value.phaseElapsedMs}
}
function createProgress(clock=()=>performance.now()){
 const start=clock();let buffer='',bytes=0,next=0,active=null,phaseStart=start,completed=null
 return{
  push(chunk){
   bytes+=Buffer.byteLength(chunk);if(bytes>65536){buffer='';return}
   buffer+=chunk;for(;;){const at=buffer.indexOf('\n');if(at<0)break;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line.length>1024)continue
    let v;try{v=JSON.parse(line)}catch{continue}
    if(!v||Object.keys(v).sort().join(',')!=='event,phase,state,version'||v.event!=='BACKUP_PHASE'||v.version!==1||v.phase!==PHASES[next])continue
    if(v.state==='started'&&active===null){active=v.phase;phaseStart=clock()}
    else if(v.state==='succeeded'&&active===v.phase){completed=active;active=null;next++}
   }
   if(buffer.length>1024)buffer=''
  },
  snapshot(){const now=clock();return safeDiagnostic({version:1,phase:active||completed||'unknown',lastCompletedPhase:completed,elapsedMs:Math.round(now-start),phaseElapsedMs:active?Math.round(now-phaseStart):0})}
 }
}
module.exports={PHASES,safeDiagnostic,createProgress}
