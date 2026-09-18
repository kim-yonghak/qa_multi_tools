import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJSON } from '../src/compare.js';
import { buildReview, reviewPage } from '../src/json-review.js';
function fixture(){
 const before=Array.from({length:123},(_,i)=>({ID:i,Remove:0,HP:i}));
 const after=before.map(({ID,HP})=>({ID,HP:HP+1,AddFlag:1}));after[0].UniqueAdded=7;
 const a=JSON.stringify(before,null,2),b=JSON.stringify(after,null,2);
 return {a,b,review:buildReview(parseJSON(a),parseJSON(b),a,b)};
}
test('repeat additions grouped and addition filter preserves total, group and individual row',()=>{
 const {a,b,review}=fixture(),page=reviewPage(review,a,b,{changeType:'added'});
 assert.equal(page.total,370);assert.equal(page.filteredTotal,124);assert.equal(page.groupedCount,123);assert.equal(page.listTotal,1);
 assert.equal(page.groups.length,1);assert.equal(page.groups[0].type,'added');assert.equal(page.groups[0].before,'(항목 없음)');assert.equal(page.groups[0].after,'1');
 assert.equal(page.rows[0].type,'added');assert(page.rows[0].path.endsWith('.UniqueAdded'));
 const group=reviewPage(review,a,b,{changeType:'added',mode:'group',groupId:page.groups[0].id,offset:100});assert.equal(group.rows.length,23);assert(group.rows.every(r=>r.type==='added'&&r.path.endsWith('.AddFlag')));
});
test('delete/modify filters exclude other types from both rows and summaries',()=>{
 const {a,b,review}=fixture();const deleted=reviewPage(review,a,b,{changeType:'deleted'});
 assert.equal(deleted.filteredTotal,123);assert.equal(deleted.listTotal,0);assert.equal(deleted.groupedCount,123);assert(deleted.groups.every(g=>g.type==='deleted'));
 const expanded=reviewPage(review,a,b,{changeType:'deleted',mode:'all',offset:100});assert.equal(expanded.listTotal,123);assert.equal(expanded.rows.length,23);assert(expanded.rows.every(r=>r.type==='deleted'));
 const modified=reviewPage(review,a,b,{changeType:'modified'});assert.equal(modified.filteredTotal,123);assert.equal(modified.groupedCount,0);assert.equal(modified.rows.length,50);assert(modified.rows.every(r=>r.type==='modified'));
});
test('all view, empty type and changed-page bounds retain accurate counts',()=>{
 const {a,b,review}=fixture();const all=reviewPage(review,a,b,{changeType:'all'});assert.equal(all.filteredTotal,370);assert.equal(all.groupedCount,246);assert.equal(all.listTotal,124);
 const empty=reviewPage(review,a,b,{changeType:'reordered',offset:100});assert.equal(empty.filteredTotal,0);assert.equal(empty.offset,0);assert.deepEqual(empty.groups,[]);assert.deepEqual(empty.rows,[]);
 const last=reviewPage(review,a,b,{changeType:'added',mode:'all',offset:99999});assert.equal(last.offset,100);assert.equal(last.rows.length,24);
});
test('order changes have a separate type and are not lost in all view',()=>{
 const a='[{"ID":1},{"ID":2}]',b='[{"ID":2},{"ID":1}]',review=buildReview(parseJSON(a),parseJSON(b),a,b);
 assert.equal(reviewPage(review,a,b,{changeType:'all'}).filteredTotal,1);
 assert.equal(reviewPage(review,a,b,{changeType:'modified'}).filteredTotal,0);
 const reordered=reviewPage(review,a,b,{changeType:'reordered'});assert.equal(reordered.filteredTotal,1);assert.equal(reordered.rows[0].type,'reordered');
});
