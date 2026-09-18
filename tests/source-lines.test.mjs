import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexSource, sourceLines } from '../src/source-lines.js';
import { parseJSON, summarize } from '../src/compare.js';
test('full selected value retains all text beyond preview, with original offsets',()=>{
 const text=JSON.stringify({padding:1,rows:Array.from({length:3000},(_,i)=>({ID:i,Name:'몬스터'}))},null,2);
 const result=summarize(undefined,parseJSON(text),'',text,{},0,1),value=result.rows[0].latest;
 assert(value.truncated);assert.equal(value.value.length,1800);
 const source=indexSource(text,value);const full=[];
 for(let i=0;i<source.starts.length;i+=120)full.push(...sourceLines(source,i,120).map(r=>r.text));
 assert.equal(full.join('\n'),text);assert.equal(sourceLines(source,source.starts.length-1,1)[0].text,'}');
});
test('mixed line endings, nested value starting mid-line, and missing version',()=>{
 const text='head\r\n  [1,\r2,\n3]\r\ntail';const start=text.indexOf('['),end=text.indexOf(']')+1;
 assert.deepEqual(sourceLines(indexSource(text,{start,end,line:2}),0,10),[{line:2,text:'[1,'},{line:3,text:'2,'},{line:4,text:'3]'}]);
 assert.equal(indexSource('',null),null);assert.deepEqual(sourceLines(null,0),[]);
});
test('long single line is not shortened, invalid offsets are rejected',()=>{
 const text='"'+ '가'.repeat(25000)+'"';assert.equal(sourceLines(indexSource(text,{start:0,end:text.length,line:1}),0,1)[0].text,text);
 assert.throws(()=>indexSource(text,{start:-1,end:2,line:1}));
});
