const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root='C:/Aroma/local-brain-runtime/strata-evaluation-20261127', prod='C:/Aroma/local-brain-runtime/ollama-0.40.16'
const conf=JSON.parse(fs.readFileSync(path.join(root,'strata-runs/ista-iq3-s/strata-model.json'),'utf8'))
const previous=JSON.parse(fs.readFileSync(path.join(root,'native-benchmark/STAGING.json'),'utf8'))
const rows=fs.readFileSync(path.join(root,'ista-iq3-s.transfer.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(x=>x.event==='verified')
function hash(p){return new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');fs.createReadStream(p).on('data',c=>h.update(c)).on('error',reject).on('end',()=>resolve(h.digest('hex')))})}
;(async()=>{
 const sources=[]
 for(const r of rows){const p=path.join(root,'weights/ista-iq3-s',path.basename(r.file));const sha=await hash(p);if(sha!==r.sha256||fs.statSync(p).size!==r.bytes)throw Error('model file failed pinned verification');sources.push({path:p,sha,bytes:r.bytes,mtimeMs:fs.statSync(p).mtimeMs});console.log('Verified',path.basename(p),sha)}
 const models=previous.models.find(x=>x.name==='qwen3.8:27b')
 const manifestIndex=path.join(previous.isolated,'manifests-v2/ollama.com/library/qwen3.8/27b'); const index=JSON.parse(fs.readFileSync(manifestIndex,'utf8')); const digest='sha256:'+models.digest; if(!index.manifests.some(x=>x.digest===digest))throw Error('pinned Ollama manifest missing'); const manifestFile=path.join(previous.isolated,'blobs',digest.replace(':','-')); if(await hash(manifestFile)!==models.digest)throw Error('manifest digest mismatch'); const m=JSON.parse(fs.readFileSync(manifestFile,'utf8'))
 const blobs=[{digest},m.config,...m.layers].map(x=>({path:path.join(previous.isolated,'blobs',x.digest.replace(':','-')),sha:x.digest.split(':')[1]}))
 for(const r of blobs){if(await hash(r.path)!==r.sha)throw Error('Ollama blob failed verification');r.bytes=fs.statSync(r.path).size;r.mtimeMs=fs.statSync(r.path).mtimeMs;}
 blobs.push({path:manifestIndex,sha:await hash(manifestIndex),bytes:fs.statSync(manifestIndex).size,mtimeMs:fs.statSync(manifestIndex).mtimeMs}); const binary=[]
 for(const p of [conf.exe,path.join(conf.cwd,'python/python.exe'),path.join(conf.cwd,'strata.py'),path.join(prod,'ollama.exe')])binary.push({path:p,sha:await hash(p),bytes:fs.statSync(p).size,mtimeMs:fs.statSync(p).mtimeMs})
 const tokenPack=[];for(const folder of [conf.tokenizer,path.dirname(conf.tokenizer)])for(const n of fs.readdirSync(folder)){const p=path.join(folder,n);if(fs.statSync(p).isFile()){tokenPack.push({path:p,sha:await hash(p),bytes:fs.statSync(p).size,mtimeMs:fs.statSync(p).mtimeMs})}}
 fs.writeFileSync('../asset-proof.json',JSON.stringify({strata:conf,ollamaExe:path.join(prod,'ollama.exe'),ollamaStore:previous.isolated,ollamaDigest:models.digest,ollamaQuant:models.details.quantization_level,strataRevision:rows[0].revision,files:[...sources,...blobs,...binary,...tokenPack]},null,2))
})().catch(e=>{console.error(e);process.exitCode=1})
