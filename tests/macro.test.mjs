import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {buildMacroPython} from '../src/items/macro.js';
import {convertCells,gridToCells} from '../src/items/rules.js';
import {EXAMPLE_GRID} from '../src/items/example.js';
const template=readFileSync(new URL('../src/items/macro-template.py',import.meta.url),'utf8');
const sample=convertCells(gridToCells(EXAMPLE_GRID));

test('download source contains all 238 valid rows in order, including duplicates and zero',()=>{
 const code=buildMacroPython(template,sample.valid);
 const a=/^a = """([\s\S]*?)"""/m.exec(code)[1].split('\n');
 const b=/^b = """([\s\S]*?)"""/m.exec(code)[1].split('\n');
 assert.equal(a.length,238);assert.equal(b.length,238);
 assert.equal(a.map((c,i)=>`${c}\t${b[i]}`).join('\n'),sample.tsv);
 assert.equal(a[0],a[1]);assert.equal(b[0],'0');assert.equal(b[1],'0');
 assert.ok(!code.includes('__QA_ITEM_CODES__'));assert.ok(!code.includes('카말리아'));
});
test('download rejects empty, invalid and unacknowledged mixed rows',()=>{
 for(const rows of [[],null,sample.rows,[{ok:false,code:'110120101',enhancement:'9'}],
  [{ok:true,code:'101',enhancement:'9'}],[{ok:true,code:'110120101',enhancement:'-1'}]])
  assert.throws(()=>buildMacroPython(template,rows));
});
test('spreadsheet values cannot inject Python code',()=>{
 for(const field of ['code','enhancement']) {
  const row={ok:true,code:'110120101',enhancement:'9'};
  row[field]='9\n"""; __import__("os").system("bad")';
  assert.throws(()=>buildMacroPython(template,[row]));
 }
 const row={...sample.valid[0],original:'"""\n__import__("os").system("bad")'};
 assert.ok(!buildMacroPython(template,[row]).includes('.system("bad")'));
});
test('missing or duplicate template markers produce a clear error',()=>{
 assert.throws(()=>buildMacroPython('<html>404</html>',sample.valid));
 assert.throws(()=>buildMacroPython(template+'__QA_ITEM_CODES__',sample.valid));
});
test('large enhancement strings are not rounded through JavaScript numbers',()=>{
 const code=buildMacroPython(template,[{ok:true,code:'110120101',enhancement:'9007199254740993'}]);
 assert.match(code,/b = """9007199254740993"""/);
});
test('generated script compiles and its actual Python parser reproduces the full TSV',t=>{
 const python=process.env.PYTHON || (process.platform==='win32'?'python':'python3');
 const script=`import sys\nsource=sys.stdin.read()\nnamespace={'__name__':'macro_test'}\nexec(compile(source,'download.py','exec'),namespace)\nrows=namespace['parse_data'](namespace['a'],namespace['b'])\nprint('\\n'.join(c+'\\t'+e for c,e in rows))\n`;
 const run=spawnSync(python,['-c',script],{input:buildMacroPython(template,sample.valid),encoding:'utf8'});
 if(run.error?.code==='ENOENT'){t.skip('Python is not installed; run Python tests separately.');return;}
 assert.equal(run.status,0,run.stderr);assert.equal(run.stdout.trimEnd(),sample.tsv);
});
