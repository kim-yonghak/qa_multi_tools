import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexSource, countSourceMatches, sourceMatch } from '../src/source-lines.js';
const source = (text,line=1) => indexSource(text,{start:0,end:text.length,line});
test('finds content past preview and outside rendered rows with original line',()=>{
 const text=Array.from({length:4000},(_,i)=>i===3500?'ID: 1284202':'unchanged').join('\n');const s=source(text,20);
 assert.equal(countSourceMatches(s,'1284202'),1);
 assert.deepEqual(sourceMatch(s,'1284202',0),{index:3500,line:3520,column:4,length:7});
});
test('literal case-sensitive queries, multiple hits per line and CRLF',()=>{
 const s=source('ID=10 ID=10\r\n[.*] id=10\rID=10',7);
 assert.equal(countSourceMatches(s,'ID=10'),3);
 assert.deepEqual(sourceMatch(s,'ID=10',1),{index:0,line:7,column:6,length:5});
 assert.deepEqual(sourceMatch(s,'ID=10',2),{index:2,line:9,column:0,length:5});
 assert.equal(countSourceMatches(s,'[.*]'),1);assert.equal(countSourceMatches(s,'id=10'),1);
});
test('search stays inside selected value; missing/empty/unmatched queries',()=>{
 const s=indexSource('needle|needle|needle',{start:7,end:13,line:5});
 assert.equal(countSourceMatches(s,'needle'),1);assert.equal(sourceMatch(s,'needle',1),null);
 assert.equal(countSourceMatches(null,'x'),0);assert.equal(countSourceMatches(s,''),0);assert.equal(countSourceMatches(s,'missing'),0);
 assert.equal(sourceMatch(s,'',0),null);assert.equal(sourceMatch(s,'needle',-1),null);
});
test('non-overlapping match order and large result count are not truncated',()=>{
 assert.equal(countSourceMatches(source('aaaaa'),'aa'),2);assert.equal(sourceMatch(source('aaaaa'),'aa',1).column,2);
 const s=source('x '.repeat(100001));assert.equal(countSourceMatches(s,'x'),100001);assert.equal(sourceMatch(s,'x',100000).column,200000);
});
