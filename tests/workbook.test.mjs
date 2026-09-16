import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {readWorkbook,parseXML} from '../src/items/workbook.js';
import {convertCells,gridToCells,address} from '../src/items/rules.js';
import {EXAMPLE_GRID} from '../src/items/example.js';

// Small in-memory OpenXML fixtures exercise the importer; not user-facing workbooks.
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
function zip(entries,compression=true){
 const local=[],central=[];let offset=0;
 for(const [name,text] of Object.entries(entries)){
  const raw=Buffer.from(text),data=compression?deflateRawSync(raw):raw,n=Buffer.from(name),h=Buffer.alloc(30),c=Buffer.alloc(46),method=compression?8:0,sum=crc(raw);
  h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(method,8);h.writeUInt32LE(sum,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(n.length,26);
  c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(method,10);c.writeUInt32LE(sum,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
  local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22),count=Object.keys(entries).length;
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function fixture(sheetXML,{shared='',compression=true}={}){
 const base='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const entries={
  '_rels/.rels':`<Relationships><Relationship Id="rId1" Type="${base}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml':'<workbook xmlns:r="urn:relationships"><sheets><sheet name="아이템" sheetId="1" r:id="sheet1"/><sheet name="숨김" state="hidden" sheetId="2" r:id="sheet2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':`<Relationships><Relationship Id="sheet1" Type="${base}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="sheet2" Type="${base}/worksheet" Target="/xl/worksheets/sheet2.xml"/>${shared?`<Relationship Id="strings" Type="${base}/sharedStrings" Target="sharedStrings.xml"/>`:''}</Relationships>`,
  'xl/worksheets/sheet1.xml':`<worksheet><sheetData>${sheetXML}</sheetData></worksheet>`,
  'xl/worksheets/sheet2.xml':'<worksheet><sheetData/></worksheet>'
 };
 if(shared)entries['xl/sharedStrings.xml']=shared;
 return new File([zip(entries,compression)],'fixture.xlsx');
}
test('XLSX inline strings: entire supplied sample equals direct cell conversion',async()=>{
 const xml=EXAMPLE_GRID.map((row,r)=>`<row r="${r+1}">${row.map((value,c)=>typeof value==='number'?`<c r="${address(r,c)}"><v>${value}</v></c>`:`<c r="${address(r,c)}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`).join('')}</row>`).join('');
 const book=await readWorkbook(fixture(xml));assert.equal(book.sheets.length,2);assert.equal(book.sheets[1].hidden,true);
 const result=convertCells(await book.loadSheet(0));const expected=convertCells(gridToCells(EXAMPLE_GRID));
 assert.equal(result.tsv,expected.tsv);assert.equal(result.rows.length,240);assert.equal(result.errors.length,2);assert.deepEqual(await book.loadSheet(1),[]);
});
test('XLSX shared rich strings, phonetic runs, blank cells, numeric notation',async()=>{
 const file=fixture('<row r="3"><c r="C3" t="s"><v>0</v></c><c r="D3"><v>9.0</v></c><c r="E3" s="5"/></row>',{shared:'<sst><si><r><t>초심자의 </t></r><r><t>권갑</t></r><rPh><t>phonetic</t></rPh></si></sst>',compression:false});
 const book=await readWorkbook(file),r=convertCells(await book.loadSheet(0));assert.equal(r.valid[0].code,'110120101');assert.equal(r.valid[0].enhancement,'9');assert.equal(r.valid[0].cell,'C3');
});
test('cached formula result used; missing cache and Excel errors are explicit',async()=>{
 const item='<c r="A1" t="inlineStr"><is><t>초심자의 권갑</t></is></c>';
 const cached=await readWorkbook(fixture(`<row r="1">${item}<c r="B1"><f>3*3</f><v>9</v></c></row>`));
 const r=convertCells(await cached.loadSheet(0));assert.equal(r.valid[0].enhancement,'9');assert.match(r.valid[0].notes[0],/수식/);
 for(const value of ['<f>3*3</f>','<v>#VALUE!</v>']){
  const b=await readWorkbook(fixture(`<row r="1">${item}<c r="B1" ${value.includes('#')?'t="e"':''}>${value}</c></row>`));assert.equal(convertCells(await b.loadSheet(0)).errors.length,1);
 }
});
test('CSV and TSV input keep duplicates and zero',async()=>{
 const book=await readWorkbook(new File(['초심자의 사이드,0,초심자의 사이드,0'],'items.csv'));
 assert.equal(convertCells(book.sheets[0].cells).tsv,'112220101\t0\n112220101\t0');
});
test('legacy, invalid UTF8, invalid ZIP, malformed XML and DTD rejected',async()=>{
 await assert.rejects(()=>readWorkbook(new File(['bad'],'items.xls')),/xlsx/);
 await assert.rejects(()=>readWorkbook(new File([new Uint8Array([0xff])],'items.csv')),/UTF-8/);
 await assert.rejects(()=>readWorkbook(new File(['bad'],'items.xlsx')),/xlsx/);
 assert.throws(()=>parseXML('<x><y></x>'));
 assert.throws(()=>parseXML('<!DOCTYPE x><x/>'),/DTD/);
});
