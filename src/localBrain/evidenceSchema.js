'use strict'
// Constrain local structured generation to fields already carried by this turn.
// This supplies names, not values or authority. Existing row/value/derivation
// validation still decides what can be published, including cross-row bindings.
function withEvidenceFields(schema,groups=[],evidence=[]){
  const names=new Set()
  for(const source of evidence)for(const [name,spec] of Object.entries(source?.derivations||{})){
    if(Array.isArray(spec?.minus)&&spec.minus.length===2)names.add(name)
  }
  for(const source of evidence)for(const name of Object.keys(source?.metrics||{}))names.add(name)
  for(const group of groups)for(const row of group?.items||[])for(const [name,value] of Object.entries(row?.fields||{})){
    // Identity is already rendered from the proven row, not an extra fact slot.
    if(String(value)!==String(row.sourceId)&&String(value)!==String(row.title))names.add(name)
  }
  if(!names.size||names.size>200||!schema?.properties?.answerPlan?.properties?.sections)return schema
  const out=structuredClone(schema)
  const field=out.properties.answerPlan.properties.sections.items.properties.items.items.properties.facts.items.properties.field
  field.enum=[...names]
  field.description='Select an exact supplied field name or declared derivation label. Never invent an alias. The host computes derivations; the model value is not arithmetic evidence.'
  const derived=evidence.flatMap(source=>Object.entries(source?.derivations||{}).filter(([,spec])=>Array.isArray(spec?.minus)&&spec.minus.length===2).map(([label,spec])=>({field:label,value:'0',formula:spec.minus.join(' minus ')})))
  if(derived.length)out.properties.answerPlan.properties.sections.description='For any requested computed quantity, include a fact selection in the appropriate row. The host replaces the placeholder value with its own arithmetic. Available computed fact selections: '+JSON.stringify(derived)
  return out
}
function withMemoryReferences(schema,rows=[]){
  const {present}=require('../memory/replySources')
  const ids=[...new Set(rows.map(r=>r.documentId).filter(id=>present('[memory:'+id+'] reference',rows).memorySources))]
  if(!ids.length)return schema
  const out=structuredClone(schema)
  // A constrained selection is easier for a small model than copying opaque IDs
  // into prose. It still chooses its references; the existing presenter rechecks
  // each pointer against the actual active owner-visible gateway rows.
  out.properties={memoryReferences:{type:'array',items:{type:'string',enum:ids},maxItems:12,description:'Select the document IDs actually used to answer. Empty only when this answer does not use supplied memory. These are source pointers, not proof that your prose is correct.'},...out.properties}
  out.required=[...new Set(['memoryReferences',...(out.required||[])])]
  return out
}
function projectMemoryReferences(text,schema){
  if(!schema?.properties?.memoryReferences)return text
  const body=JSON.parse(text),allowed=new Set(schema.properties.memoryReferences.items.enum)
  if(!Array.isArray(body.memoryReferences)||body.memoryReferences.length>12||body.memoryReferences.some(id=>!allowed.has(id)))throw Error('invalid_memory_reference_selection')
  if(typeof body.reply==='string')for(const id of new Set(body.memoryReferences)){
    const marker='[memory:'+id+']'
    if(!body.reply.includes(marker))body.reply+=' '+marker
  }
  delete body.memoryReferences
  return JSON.stringify(body)
}
// Complete a selected operand pair with its declared computed column. This only
// selects a label; answerPlan's existing validator still resolves the exact row,
// rejects ambiguous/missing operands and computes the number. No prose parsing,
// model arithmetic, new formulas, cross-row joins or tool calls are introduced.
function completeDerivedSelections(plan,groups=[],evidence=[]){
  if(!Array.isArray(plan?.sections))return plan
  const out=structuredClone(plan)
  for(const section of out.sections)for(const item of section?.items||[]){
    if(!Array.isArray(item?.facts))continue
    const matches=[]
    for(const group of groups)for(const row of group?.items||[]){
      const source=row.source||group.source,key=row.readKey||group.readKey||source
      if(`${key}#${row.sourceId}`===item.sourceId)matches.push({row,source})
    }
    if(matches.length!==1)continue
    const {row,source}=matches[0],selected=new Set(item.facts.map(f=>f.field))
    const declarations=evidence.filter(e=>e.source===source)
    const labels=new Map()
    for(const e of declarations)for(const [label,spec] of Object.entries(e.derivations||{})){
      if(!Array.isArray(spec?.minus)||spec.minus.length!==2||!spec.minus.every(x=>typeof x==='string'))continue
      const old=labels.get(label)
      labels.set(label,old===null||old&&JSON.stringify(old)!==JSON.stringify(spec.minus)?null:spec.minus)
    }
    for(const [label,operands] of labels){
      if(!operands||selected.has(label)||!operands.every(name=>selected.has(name)&&Object.hasOwn(row.fields||{},name)))continue
      item.facts.push({field:label,value:'0'});selected.add(label)
    }
  }
  return out
}
module.exports={withEvidenceFields,withMemoryReferences,projectMemoryReferences,completeDerivedSelections}
