'use strict'
const cp=require('node:child_process')
const {SHA}=require('./policy')
const REPOSITORY='Louielui/aroma-agent-backend',PREFIX='/repos/'+REPOSITORY
const CONTEXTS=Object.freeze(['imagine/promotion-tests','imagine/promotion-review','imagine/preservation','imagine/policy'])
function tokenFromGit (root) {
  let output
  try{output=cp.execFileSync('git',['-C',root,'credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'},windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:30000})}catch{throw Error('github_authentication_required')}
  const fields=Object.fromEntries(output.trim().split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)]}))
  if(!fields.password)throw Error('github_authentication_required')
  return fields.password
}
function createGitHub ({root,fetchImpl=fetch,tokenProvider=tokenFromGit}) {
  let auth
  async function api (route,{method='GET',body}={}) {
    if(!route.startsWith(PREFIX+'/')&&route!=='/graphql')throw Error('github_route_outside_policy')
    if(/\.\.|%2e|%2f|%5c|\\/i.test(route.split('?')[0]))throw Error('github_route_outside_policy')
    auth ||= tokenProvider(root)
    const r=await fetchImpl('https://api.github.com'+route,{method,headers:{Authorization:'Bearer '+auth,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Imagine-repository-promotion',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})
    if(!r.ok){const error=Error('github_request_failed');error.status=r.status;throw error}
    return r.status===204?null:r.json()
  }
  async function main () {const r=await api(PREFIX+'/commits/main');if(!SHA.test(r.sha||''))throw Error('remote_main_unavailable');return r.sha}
  async function pullRequest ({branch,head,title,body}) {
    if(!/^(?:codex|feat|feature|reconcile|policy|rollback)\/[A-Za-z0-9_./-]+$/.test(branch)||!SHA.test(head||''))throw Error('invalid_pr_request')
    const found=await api(PREFIX+'/pulls?state=open&head='+encodeURIComponent('Louielui:'+branch))
    const r=found[0]?await api(PREFIX+'/pulls/'+found[0].number,{method:'PATCH',body:{title,body}}):await api(PREFIX+'/pulls',{method:'POST',body:{title,body,head:branch,base:'main',draft:false}})
    if(r.head?.sha!==head||r.base?.ref!=='main'||r.head?.repo?.full_name!==REPOSITORY)throw Error('pr_identity_mismatch')
    return{number:r.number,url:r.html_url,head:r.head.sha,base:r.base.sha,state:r.state}
  }
  async function recordChecks (number,head,proof) {
    if(!Number.isSafeInteger(number)||!SHA.test(head||'')||proof.commit!==head||require('./policy').promotionDecision({...proof,pr:{...proof.pr,checksState:'success'}}).allowed!==true)throw Error('invalid_status_proof')
    const descriptions=['Full isolated Node suite passed','Independent Claude subscription review passed','Exact SHA and rollback history preserved','Promotion policy evidence gates passed']
    for(let i=0;i<CONTEXTS.length;i++)await api(PREFIX+'/statuses/'+head,{method:'POST',body:{state:'success',context:CONTEXTS[i],description:descriptions[i],target_url:'https://github.com/'+REPOSITORY+'/pull/'+number}})
  }
  async function inspectPR (number) {
    if(!Number.isSafeInteger(number))throw Error('invalid_pr_request')
    const pr=await api(PREFIX+'/pulls/'+number)
    async function pages (route,key=null) {
      const rows=[],seen=new Set();let total=null
      for(let page=1;page<=10;page++){
        const data=await api(route+(route.includes('?')?'&':'?')+'per_page=100&page='+page),items=key?data?.[key]:data
        if(!Array.isArray(items)||items.length>100)return{rows,complete:false}
        if(key){
          if(!Number.isSafeInteger(data.total_count)||data.total_count<0||total!==null&&data.total_count!==total)return{rows,complete:false}
          total=data.total_count
        }
        for(const item of items){
          const identity=key==='statuses'?item.context:item.id
          if(identity===undefined||seen.has(identity))return{rows,complete:false}
          seen.add(identity)
        }
        rows.push(...items)
        if(items.length<100)return{rows,complete:total===null||rows.length===total}
      }
      return{rows,complete:false}
    }
    const [statuses,checks,reviews,threads]=await Promise.all([
      pages(PREFIX+'/commits/'+pr.head.sha+'/status','statuses'),pages(PREFIX+'/commits/'+pr.head.sha+'/check-runs?filter=latest','check_runs'),pages(PREFIX+'/pulls/'+number+'/reviews'),
      api('/graphql',{method:'POST',body:{query:'query($number:Int!){repository(owner:"Louielui",name:"aroma-agent-backend"){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}pageInfo{hasNextPage}}}}}',variables:{number}}})
    ])
    const reviewThreads=threads.data?.repository?.pullRequest?.reviewThreads
    if(threads.errors||!reviewThreads||reviewThreads.pageInfo?.hasNextPage)throw Error('review_threads_unavailable')
    let completeEvidence=statuses.complete&&checks.complete&&reviews.complete
    const latestReviews=new Map();for(const review of reviews.rows)if(['CHANGES_REQUESTED','APPROVED'].includes(review.state)){
      if(typeof review.user?.login!=='string'||!review.user.login||review.user.login==='ghost'){completeEvidence=false;continue}
      latestReviews.set(review.user.id||review.user.login,review.state)
    }
    const requestedChanges=[...latestReviews.values()].some(x=>x==='CHANGES_REQUESTED')
    const allStatuses=statuses.rows,allChecks=checks.rows
    const ownPresent=CONTEXTS.every(context=>allStatuses.some(s=>s.context===context&&s.state==='success'))
    const checksOk=completeEvidence&&ownPresent&&allStatuses.every(s=>s.state==='success')&&allChecks.every(c=>c.status==='completed'&&['success','neutral','skipped'].includes(c.conclusion))&&!requestedChanges
    return{number,url:pr.html_url,head:pr.head.sha,base:pr.base.sha,state:pr.merged?'merged':pr.state,mergeable:pr.mergeable,mergeCommit:pr.merge_commit_sha,unresolvedThreads:reviewThreads.nodes.filter(x=>x.isResolved!==true).length+(requestedChanges?1:0),checksState:checksOk?'success':(allStatuses.some(s=>s.state==='failure'||s.state==='error')||allChecks.some(c=>c.conclusion==='failure')?'failure':'pending'),checkContexts:allStatuses.map(s=>({context:s.context,state:s.state})),checks:allChecks.map(c=>({name:c.name,state:c.status,conclusion:c.conclusion}))}
  }
  async function merge ({number,head,base}) {
    const current=await inspectPR(number)
    if(current.head!==head||current.base!==base||current.state!=='open'||current.mergeable!==true||current.unresolvedThreads!==0||current.checksState!=='success'||await main()!==base)throw Error('head_or_base_changed')
    const result=await api(PREFIX+'/pulls/'+number+'/merge',{method:'PUT',body:{sha:head,merge_method:'merge',commit_title:'Promote reviewed Imagine tranche #'+number}})
    if(result.merged!==true||!SHA.test(result.sha||''))throw Error('merge_unconfirmed')
    return{commit:result.sha,pr:number,head,base}
  }
  async function rollbackMerge ({pr,head,base,source,tree,failure,runId}) {
    if(!Number.isSafeInteger(pr)||![head,base,source,tree].every(s=>SHA.test(s||''))||!failure||!['runtime_mismatch','runtime_verification_failed','runtime_verification_unavailable'].includes(failure.reason)||!/^[a-f0-9-]{36}$/.test(runId||''))throw Error('rollback_not_authorized')
    const [candidate,original,pull]=await Promise.all([api(PREFIX+'/commits/'+head),api(PREFIX+'/commits/'+source),api(PREFIX+'/pulls/'+pr)])
    if(candidate.commit?.tree?.sha!==tree||original.commit?.tree?.sha!==tree||candidate.parents?.[0]?.sha!==base||pull.head?.sha!==head||pull.base?.sha!==base||await main()!==base)throw Error('rollback_source_mismatch')
    const result=await api(PREFIX+'/pulls/'+pr+'/merge',{method:'PUT',body:{sha:head,merge_method:'merge',commit_title:'Restore exact verified Imagine rollback tree'}})
    if(result.merged!==true||!SHA.test(result.sha||''))throw Error('rollback_merge_unconfirmed')
    return{commit:result.sha,head,base,pr}
  }
  const readOnlyApi=(route,options={})=>{
    if(options.method&&options.method!=='GET'||options.body)throw Error('raw_github_write_forbidden')
    return api(route)
  }
  return{api:readOnlyApi,main,pullRequest,recordChecks,inspectPR,merge,rollbackMerge}
}
module.exports={REPOSITORY,CONTEXTS,createGitHub}
