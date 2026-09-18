import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJSON } from '../src/compare.js';
import { buildReview, reviewPage, reviewHighlights, lineHighlight } from '../src/json-review.js';
const setup=(old,latest)=>{const a=JSON.stringify(old,null,2),b=JSON.stringify(latest,null,2);return {a,b,review:buildReview(parseJSON(a),parseJSON(b),a,b)}};
test('repeat short text grouped, numeric/ID/added/deleted/large changes kept individually',()=>{
 const before=Array.from({length:1000},(_,i)=>({ID:i,Name:'old label',HP:10,OtherId:'ab',DeleteMe:0,Description:'old long description with several words'}));
 const after=before.map(x=>({...x,Name:'new label',HP:11,OtherId:'ac',Added:1,Description:'new completely different full description with many words'}));for(const row of after)delete row.DeleteMe;
 const {a,b,review}=setup(before,after);assert.equal(review.total,6000);assert.equal(review.groups.length,1);assert.equal(review.groupedCount,1000);
 const main=reviewPage(review,a,b);assert.equal(main.listTotal,5000);assert(main.rows.some(r=>r.type==='deleted'));assert(main.rows.some(r=>r.type==='added'));assert(!main.rows.some(r=>r.path.endsWith('.Name')));
 const grouped=reviewPage(review,a,b,{mode:'group',groupId:review.groups[0].id,offset:950});assert.equal(grouped.listTotal,1000);assert.equal(grouped.rows.length,50);assert(grouped.rows.every(r=>r.path.endsWith('.Name')));
 assert.equal(reviewPage(review,a,b,{mode:'all'}).listTotal,6000);
 assert.equal(reviewPage(review,a,b,{offset:999999}).offset,4950);
});
test('single/two short edits and digit changes are never grouped',()=>{
 const {review}=setup([{ID:1,Name:'one',Label:'v1'},{ID:2,Name:'one',Label:'v1'},{ID:3,Name:'same',Label:'v1'}],[{ID:1,Name:'two',Label:'v2'},{ID:2,Name:'two',Label:'v2'},{ID:3,Name:'same',Label:'v2'}]);assert.equal(review.groupedCount,0);
});
test('repeated field removal remains in the main list',()=>{
 const before=Array.from({length:500},(_,i)=>({ID:i,Scope:0})),after=before.map(({ID})=>({ID}));const {review,a,b}=setup(before,after);
 assert.equal(review.groups.length,0);assert.equal(reviewPage(review,a,b).listTotal,500);
});
test('full-original line shades distinguish changed/added/deleted and unchanged content',()=>{
 const {review}=setup({Keep:1,Edit:2,Remove:3},{Keep:1,Edit:4,Add:5});
 const old=reviewHighlights(review,'old'),latest=reviewHighlights(review,'latest');
 assert.equal(lineHighlight(old,2),null);assert.equal(lineHighlight(latest,2),null);
 assert.equal(lineHighlight(old,3),'modified');assert.equal(lineHighlight(latest,3),'modified');
 assert.equal(lineHighlight(old,4),'deleted');assert.equal(lineHighlight(latest,4),'added');
});
test('overlapping reorder and value changes retain value change priority',()=>{
 const {review}=setup([{ID:1,V:10},{ID:2,V:20}],[{ID:2,V:25},{ID:1,V:10}]);const ranges=reviewHighlights(review,'latest');
 assert.equal(lineHighlight(ranges,1),'reordered');assert.equal(lineHighlight(ranges,4),'modified');
 for(let i=1;i<ranges.length;i++)assert(ranges[i-1].end<ranges[i].start);
});
test('semantic same with differing layout has no difference or shading',()=>{
 const a='{ "A": 1, "B": 2 }',b='{\n"B":2,\n"A":1\n}';const review=buildReview(parseJSON(a),parseJSON(b),a,b);
 assert.equal(review.total,0);assert.deepEqual(reviewHighlights(review,'old'),[]);assert.equal(reviewPage(review,a,b).rows.length,0);
});
test('new/deleted file shades complete JSON value',()=>{
 const text='[\n {"Name":"a"}\n]';const added=buildReview(undefined,parseJSON(text),'',text);
 assert.equal(lineHighlight(reviewHighlights(added,'latest'),2),'added');assert.deepEqual(reviewHighlights(added,'old'),[]);
 const deleted=buildReview(parseJSON(text),undefined,text,'');assert.equal(lineHighlight(reviewHighlights(deleted,'old'),3),'deleted');
});
