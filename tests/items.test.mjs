import {test} from 'node:test';
import assert from 'node:assert/strict';
import {convertItem,convertCells,gridToCells,parsePasted,parseDelimited,parseRange,PREFIX_CODES,WEAPON_CODES} from '../src/items/rules.js';
import {EXAMPLE_GRID,EXAMPLE_TSV} from '../src/items/example.js';
const convert=(grid,options)=>convertCells(gridToCells(grid),options);

test('all user verification examples',()=>{
 for(const [name,code,enh] of [['초심자의 사이드','112220101','0'],['초심자의 권갑 +9','110120101','9'],['개척자 검/방패 +12','111030101','12'],['푸른 월광의 전투 방패 +7','112040104','7'],['결속의 단검 +9','113155201','9'],['동행의 대검 +12','112155202','12'],['정점의 워드럼','111170170','0'],['일리아나 권갑','110160106','0'],['정점의 대검','112170170','0']]){
  const r=convertItem(name);assert.equal(r.ok,true,name);assert.equal(r.code,code,name);assert.equal(r.enhancement,enh,name);
 }
});
test('final mapping widths and unique canonical combinations',()=>{
 for(const [p,pc] of Object.entries(PREFIX_CODES))for(const [w,wc] of Object.entries(WEAPON_CODES)){
  const r=convertItem(`${p} ${w}`);assert.equal(r.code,wc+pc);assert.match(r.code,/^\d{9}$/);assert.equal(r.corrected,false);
 }
 assert.equal(convertItem('진시르이 권갑').code,'110155302');assert.equal(convertItem('계승자의 권갑').code,'110140110');assert.equal(convertItem('계승의 권갑').code,'110150170');
});
test('240 items: duplicates and row-major order, only two unknown names',()=>{
 const r=convert(EXAMPLE_GRID);assert.equal(EXAMPLE_GRID.length,56);assert.equal(r.rows.length,240);assert.equal(r.valid.length,238);assert.equal(r.corrected,24);
 assert.deepEqual(r.errors.map(x=>[x.original,x.cell]),[['카말리아의 심장','A56'],['카말리아의 날개','C56']]);
 assert.deepEqual(r.tsv.split('\n').slice(0,8),['112220101\t0','112220101\t0','112220101\t9','110120101\t9','111020101\t9','112020101\t9','113120101\t9','112120101\t9']);
 assert.equal(r.tsv.split('\n').length,238);assert.ok(r.tsv.split('\n').every(x=>/^\d{9}\t\d+$/.test(x)));
});
test('approved aliases and spacing variants',()=>{
 for(const [name,code] of [['그을린의 사이드','112220103'],['경속의 단검','113155201'],['초심자 전투방패','112020101'],['숙련자 단검','113120102'],['푸른   월광의   전투방패','112040104'],['개척자 검 / 방패','111030101']]){const r=convertItem(name);assert.equal(r.code,code);assert.equal(r.corrected,true);}
});
test('unregistered prefixes and weapons never get guessed codes',()=>{
 for(const s of ['카말리아의 심장','카말리아의 날개','아무개의 단검','진실의 권갑','초심자의 도끼','초심자의 검',''])assert.equal(convertItem(s).ok,false,s);
});
test('separate zero overrides inline enhancement and leaves audit note',()=>{
 const r=convertItem('초심자의 권갑 +9',0);assert.equal(r.enhancement,'0');assert.match(r.notes[0],/별도 셀 0/);
});
test('inline/plain enhancement, blank enhancement, plus handling',()=>{
 assert.equal(convertItem('초심자의 권갑 12').enhancement,'12');assert.equal(convertItem('초심자의 권갑+9','').enhancement,'9');assert.equal(convertItem('초심자의 권갑','+9').enhancement,'9');assert.equal(convertItem('초심자의 권갑',null).enhancement,'0');
});
test('invalid enhancement produces an error, not silent default zero',()=>{
 for(const value of ['abc','-1','1.5','NaN','Infinity'])assert.equal(convertItem('초심자의 권갑',value).ok,false);
});
test('empty pairs skip, orphan enhancement remains an error with cell',()=>{
 const r=convert([['',null,'초심자의 사이드',0,'',9]]);assert.equal(r.rows.length,2);assert.equal(r.valid[0].cell,'C1');assert.equal(r.errors[0].cell,'E1');
});
test('range selection shifts pairing anchor to selected first column',()=>{
 const r=convert([['title','item','enh'],['row1','초심자의 권갑',9],['row2','숙련자의 권갑',12]],{range:'B2:C3'});assert.equal(r.rows.length,2);assert.equal(r.valid[0].cell,'B2');assert.equal(r.valid[1].code,'110120102');
 assert.throws(()=>parseRange('B3:A1'));assert.throws(()=>parseRange('A0:B1'));
});
test('name-per-cell mode consumes every nonblank cell in row-major order',()=>{
 const r=convert([['초심자의 사이드 +9','','일리아나 권갑'],['정점의 대검']],{mode:'names'});assert.deepEqual(r.valid.map(x=>x.cell),['A1','C1','A2']);assert.deepEqual(r.valid.map(x=>x.enhancement),['9','0','0']);
});
test('pasted TSV preserves entire sample and blank columns',()=>{
 assert.equal(convert(parsePasted(EXAMPLE_TSV)).tsv,convert(EXAMPLE_GRID).tsv);
 assert.deepEqual(parsePasted('초심자의 사이드\t0\t\t\r\n초심자의 권갑\t9'),[['초심자의 사이드','0','',''],['초심자의 권갑','9']]);
});
test('Markdown separator skips but first data row remains',()=>{
 const text='| 초심자의 사이드 | 0 | 초심자의 사이드 | 0 |\n| --- | -- | --- | -- |\n| 초심자의 권갑 | 9 | | |';
 const r=convert(parsePasted(text));assert.equal(r.valid.length,3);assert.equal(r.valid[0].enhancement,'0');assert.equal(r.valid[1].enhancement,'0');
});
test('quoted delimited text and UTF8 BOM',()=>{
 assert.deepEqual(parseDelimited('\ufeff"초심자의 사이드",9\r\n"quote""text",12',','),[['초심자의 사이드','9'],['quote"text','12']]);
 assert.throws(()=>parseDelimited('"unterminated'));
});
test('formula issues propagate with location and do not create code',()=>{
 const r=convertCells([{r:1,c:0,value:'초심자의 권갑'},{r:1,c:1,value:'',issue:'수식 결과 없음'}]);assert.equal(r.errors.length,1);assert.equal(r.errors[0].cell,'A2');assert.equal(r.tsv,'');
});
