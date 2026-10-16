'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
test('Node filesystem mutation APIs are intercepted or explicitly refused, including future additions',()=>{
 const source=fs.readFileSync(path.join(__dirname,'quiescenceFence.js'),'utf8')
 const mutation=/^(?:append|write|rename|unlink|mkdir|rmdir|rm|copy|cp|truncate|ftruncate|chmod|fchmod|lchmod|chown|lchown|fchown|utimes|lutimes|futimes|link|symlink|mkdtemp|fsync|fdatasync|open|createWriteStream)/
 const readonly=new Set(['openAsBlob','opendir','opendirSync'])
 for(const name of Object.keys(fs).filter(n=>typeof fs[n]==='function'&&mutation.test(n)&&!readonly.has(n))){
  const base=name.endsWith('Sync')?name:name+'Sync'
  assert.ok(source.includes("'"+name+"'")||source.includes("'"+base+"'"),'unfenced fs API: '+name)
 }
})
test('production sources do not acquire unsupported writable FileHandles or bypass Node interlocks',()=>{
 const root=path.resolve(__dirname,'../..'),bad=[]
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(/\.[cm]?js$/.test(e.name)&&!/(?:\.test\.|\.fixture\.)/.test(e.name)){const text=fs.readFileSync(file,'utf8');if(/\bprocess\.(?:binding|_linkedBinding)\s*\(|\bpromises\.open\s*\(|require\(['"](?:node:)?fs\/promises['"]\)/.test(text))bad.push(path.relative(root,file))}}}
 walk(path.join(root,'src'));walk(path.join(root,'scripts'));assert.deepEqual(bad,[])
})
