'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {inspectDocument,projectStructured,admitStructuredUrl}=require('./publicStructured')
const pageUrl='https://www.winnipeg.ca/recreation-leisure/libraries/locations-and-hours/millennium-library'
const jsonUrl='https://raw.githubusercontent.com/winnipegpublibrary/winnipeg-ca-openinghours/main/hours-schema/1262.json'
const binding={pageUrl,name:'Millennium',title:'Millennium Library'}
const hours={'@context':'https://schema.org','@type':'Library',name:'Millennium',address:'251 Donald St., Winnipeg, MB',openingHoursSpecification:[{'@type':'OpeningHoursSpecification',dayOfWeek:'https://schema.org/Monday',opens:'10:00',closes:'17:00'},{'@type':'OpeningHoursSpecification',dayOfWeek:'https://schema.org/Tuesday',opens:'10:00',closes:'20:00'}]}
const markup='<main><h1>Millennium Library</h1><h2>Hours</h2></main><script src="https://cdn.jsdelivr.net/gh/winnipegpublibrary/winnipeg-ca-openinghours@main/winnipeg_ca_library_hours_translation.js"></script><script src="https://cdn.jsdelivr.net/gh/winnipegpublibrary/winnipeg-ca-openinghours@main/hours-schema-inject.js"></script>'

test('the observed official directory exposes registered branch links as navigation, never invented URLs',()=>{
 const directory='https://www.winnipeg.ca/recreation-leisure/libraries/locations-and-hours';
 const inspected=inspectDocument('<a href="/recreation-leisure/libraries/locations-and-hours/millennium-library">Millennium Library</a><a href="https://evil.invalid/millennium-library">Millennium Library</a>',directory,'Library locations and hours');
 assert.equal(inspected.navigation.length,1);assert.equal(inspected.navigation[0].url,pageUrl);assert.equal(inspected.navigation[0].subject,'Millennium Library');
 assert.deepEqual(inspectDocument('<a href="'+pageUrl+'">Millennium Library</a>','https://www.winnipeg.ca/unrelated','Other').navigation,[]);
});

test('a registered publisher reference binds the exact branch without executing or fetching scripts',()=>{
 const inspected=inspectDocument(markup,pageUrl,'Millennium Library')
 assert.equal(inspected.references.length,1);assert.equal(inspected.references[0].url,jsonUrl)
 for(const url of ['https://evil.invalid/recreation-leisure/libraries/locations-and-hours/millennium-library',pageUrl.replace('millennium-library','unknown-library')])assert.equal(inspectDocument(markup,url,'Millennium Library').references.length,0)
 assert.equal(inspectDocument(markup.replace('hours-schema-inject.js','other.js'),pageUrl,'Millennium Library').references.length,0)
 for(const url of [jsonUrl+'?token=secret',jsonUrl.replace('/1262.json','/9999.json'),jsonUrl.replace('/winnipegpublibrary/','/another-owner/'),'https://raw.githubusercontent.com/secret'])assert.equal(admitStructuredUrl(url),null)
 assert.equal(admitStructuredUrl(jsonUrl),jsonUrl)
})
test('structured recurring hours retain observed values, missing weekdays and unknown exception/date coverage',()=>{
 const projected=projectStructured(hours,binding)
 assert.match(projected.text,/Monday: opens 10:00; closes 17:00/)
 assert.match(projected.text,/Tuesday: opens 10:00; closes 20:00/)
 assert.ok(projected.coverage.missingDays.includes('Sunday'));assert.equal(projected.coverage.exceptions,'unknown')
 assert.equal(projected.publishedAt,null);assert.deepEqual(projected.times,[])
 assert.equal(projectStructured({...hours,name:'Another branch'},binding),null)
 assert.equal(projectStructured({...hours,openingHoursSpecification:[]},binding),null)
 assert.equal(projectStructured({...hours,openingHoursSpecification:[{...hours.openingHoursSpecification[0],validFrom:'2026-10-12',validThrough:'2026-10-12'}]},binding),null)
 const invalid=projectStructured({...hours,openingHoursSpecification:[...hours.openingHoursSpecification,{dayOfWeek:'https://schema.org/Sunday',opens:'25:99',closes:'17:00'}]},binding)
 assert.equal(invalid.coverage.invalidFields,1);assert.ok(invalid.coverage.missingDays.includes('Sunday'))
})
test('embedded JSON-LD and same-publisher alternate JSON are read as data, with subject binding and no context egress',()=>{
 const article={'@context':'https://schema.org','@type':'NewsArticle',headline:'Official release',datePublished:'2026-10-09',description:'The library will reopen after repairs.'}
 const html='<h1>Official release</h1><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@graph':[article,{...article,headline:'Other subject'}]})+'</script><link rel="alternate" type="application/ld+json" href="/release.json">'
 const out=inspectDocument(html,'https://news.gov.mb.ca/news/release','Official release')
 assert.equal(out.records.length,1);assert.equal(out.records[0].publishedAt,'2026-10-09');assert.equal(out.references[0].url,'https://news.gov.mb.ca/release.json')
 assert.equal(inspectDocument(html.replace('application/ld+json','application/javascript'),'https://news.gov.mb.ca/news/release','Official release').records.length,0)
 assert.equal(projectStructured({...article,'@context':'https://evil.invalid/context'},{pageUrl:'https://news.gov.mb.ca/news/release',title:'Official release'}),null)
 assert.equal(inspectDocument('<link type="application/json" href="/release.json?token=private">','https://news.gov.mb.ca/news/release','Official release').references.length,0)
})
