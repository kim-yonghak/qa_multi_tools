import { convertCells, gridToCells, parsePasted } from './rules.js';
import { readWorkbook } from './workbook.js';
import { EXAMPLE_TSV } from './example.js';
import { buildMacroPython, loadMacroTemplate } from './macro.js';

export function mountItemTool() {
 const $=s=>document.querySelector(s),fmt=n=>n.toLocaleString('ko-KR');
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 let source='paste',book=null,cells=[],result=null,page=0,version=0,loading=false,macroLoading=false;
 $('#items-view').innerHTML=`
  <section class="intro"><div><div class="eyebrow">ITEM CODE CONVERTER</div><h1>아이템 코드 변환</h1><p>아이템명과 강화수치를 입력하면 엑셀에 붙여넣을 수 있는 두 열로 정리합니다.</p></div><button class="quiet" id="item-example">제공 예시 불러오기</button></section>
  <div class="item-workspace"><section class="item-input-panel"><div class="item-tabs" role="group" aria-label="입력 방법"><button id="item-paste-tab" class="active" aria-pressed="true">셀 붙여넣기</button><button id="item-file-tab" aria-pressed="false">엑셀 파일</button></div>
    <div id="item-paste-area"><label class="item-label" for="item-paste">엑셀에서 필요한 셀 범위를 복사해 붙여넣으세요.</label><textarea id="item-paste" spellcheck="false" placeholder="초심자의 사이드&#9;0&#9;초심자의 사이드&#9;0&#10;초심자의 권갑&#9;9&#9;개척자 검/방패&#9;12"></textarea><p class="item-help">아이템명 · 강화수치가 반복되는 표를 그대로 붙여넣을 수 있습니다. 첫 행도 데이터로 처리합니다.</p></div>
    <div id="item-file-area" hidden><label class="item-file-label" for="item-file"><strong>엑셀 파일 선택</strong><span>.xlsx · UTF-8 .csv / .tsv</span></label><input type="file" id="item-file" accept=".xlsx,.csv,.tsv,.txt" /><p id="item-file-name" class="item-help">선택한 파일이 없습니다.</p><label class="item-label" for="item-sheet">변환할 시트</label><select id="item-sheet" disabled></select><p class="item-help">시트 한 개씩 변환합니다. .xls 파일은 .xlsx로 저장하거나 셀을 복사해 붙여넣으세요.</p></div>
    <div class="item-options"><label>셀 배치<select id="item-mode"><option value="pairs">아이템명 | 강화수치 반복</option><option value="names">각 셀에 아이템명 (이름 뒤 +강화)</option></select></label><label>처리 범위 (선택)<input id="item-range" placeholder="예: A1:L56 · 비우면 전체" /></label></div><p class="item-help">행마다 왼쪽 → 오른쪽 순서로 처리하며 중복을 유지합니다. 머리글이나 설명이 있으면 범위에서 제외하세요. 붙여넣기 범위의 시작은 A1입니다.</p>
    <div class="item-run"><button class="quiet" id="item-clear">초기화</button><button class="primary" id="item-convert">아이템 변환 →</button></div>
  </section><aside class="item-guide"><span class="eyebrow">CONVERSION RULES</span><h2>장비 4자리 + 이름 5자리</h2><div class="code-example"><span>일리아나 권갑 +9</span><strong>110160106 <em>9</em></strong></div><ul><li>무기 11종 · 방어구 15종 · 망토 4종 · 장신구 5종을 지원합니다.</li><li>이름 코드는 모든 장비에 공통 적용합니다.</li><li>강화수치가 없으면 0을 사용합니다.</li><li>별도 강화 셀의 숫자를 우선합니다.</li><li>빈 아이템 쌍은 건너뜁니다.</li><li>확인된 오타와 띄어쓰기를 보정합니다.</li><li>등록되지 않은 명칭은 오류로 표시합니다.</li></ul><p>‘초심자’ → ‘초심자의’, ‘숙련자’ → ‘숙련자의’, ‘그을린의’ → ‘그을린’, ‘경속의’ → ‘결속의’. 그 밖에 확정할 수 없는 명칭은 자동 추측하지 않습니다.</p></aside></div>
  <p id="item-status" class="status" role="status" aria-live="polite">입력 후 아이템 변환을 눌러주세요.</p>
  <section id="item-results" hidden><div class="metrics item-metrics" id="item-metrics"></div><div id="item-error-banner" class="item-error-banner" hidden></div>
   <div class="item-output-panel"><div class="item-output-top"><div><h2>엑셀 붙여넣기 결과</h2><p>머리글 없이 아이템 코드와 강화수치만 출력합니다.</p></div><div class="item-export-actions"><button id="item-copy" class="primary">결과 복사</button><button id="item-download" class="quiet">TSV 저장</button><button id="item-macro" class="quiet" disabled>매크로 Python 다운로드</button></div></div>
    <label id="item-partial-label" class="item-partial" hidden><input type="checkbox" id="item-partial" /> 오류 항목을 제외하고 정상 항목만 출력합니다.</label><textarea id="item-output" readonly spellcheck="false" aria-label="아이템 코드와 강화수치 TSV 결과"></textarea>
    <div class="item-macro-guide"><strong>게임 매크로로 실행하기</strong><p>위 결과가 포함된 .py 파일을 다운로드합니다. 실행하면 준비 안내와 전체 / 절반 실행 GUI가 열립니다.</p><p>실행 조건: <b>전체 화면, 로비 화면에서 채팅을 켜둔 상태에서 실행</b> · 기본 모니터 1920 × 1080</p><details><summary>처음 실행하는 PC의 준비 방법</summary><p>Windows에 Python이 필요합니다. PowerShell에서 최초 한 번 설치하세요.</p><code>py -m pip install pyautogui pydirectinput keyboard</code><p>다운로드한 .py를 Python으로 실행하고 Windows 관리자 승인 창에서 허용하세요. GUI의 실행 버튼을 누른 후 5초 안에 게임 창을 선택합니다. F8로 중지할 수 있습니다.</p><p>절반 실행 후에는 나머지 실행을 누릅니다. 진행은 해당 PC에 저장되며, 같은 데이터로 처음부터 다시 실행하려면 GUI에서 진행 초기화를 누르세요. 지급 결과는 게임에서 확인하세요.</p></details></div>
   </div>
   <div class="item-review"><div class="item-review-top"><h2>변환 내역</h2><select id="item-filter" aria-label="변환 상태 필터"><option value="all">전체 항목</option><option value="error">오류만</option><option value="corrected">보정된 항목만</option></select></div><div class="item-table-wrap"><table class="item-table"><thead><tr><th>순서 / 셀</th><th>입력 아이템</th><th>아이템 코드</th><th>강화</th><th>상태 / 상세</th></tr></thead><tbody id="item-rows"></tbody></table></div><div class="pager"><button id="item-prev" class="quiet">← 이전</button><span id="item-page"></span><button id="item-next" class="quiet">다음 →</button></div></div>
  </section>`;
 const status=text=>{$('#item-status').textContent=text;};
 function invalidate(message='입력이 바뀌었습니다. 아이템 변환을 다시 눌러주세요.'){
  result=null;page=0;$('#item-results').hidden=true;$('#item-output').value='';$('#item-copy').disabled=true;$('#item-download').disabled=true;$('#item-macro').disabled=true;status(message);
 }
 function switchSource(next){
  source=next;$('#item-paste-area').hidden=next!=='paste';$('#item-file-area').hidden=next!=='file';
  for(const key of ['paste','file']){$(`#item-${key}-tab`).classList.toggle('active',next===key);$(`#item-${key}-tab`).setAttribute('aria-pressed',String(next===key));}
  invalidate();
 }
 function setLoading(value){loading=value;for(const id of ['item-convert','item-sheet','item-paste-tab','item-file-tab','item-example'])$('#'+id).disabled=value||(id==='item-sheet'&&!book);}
 $('#item-paste-tab').onclick=()=>switchSource('paste');$('#item-file-tab').onclick=()=>switchSource('file');
 for(const id of ['item-paste','item-mode','item-range'])$('#'+id).addEventListener('input',()=>invalidate());
 $('#item-example').onclick=()=>{switchSource('paste');$('#item-paste').value=EXAMPLE_TSV;$('#item-mode').value='pairs';$('#item-range').value='';status('제공 예시를 불러왔습니다. 중복과 첫 행을 포함하며, 마지막 미등록 항목 2건은 오류로 표시됩니다.');};
 async function loadSheet(){
  const token=++version;invalidate('시트를 읽고 있습니다…');setLoading(true);
  try{const index=Number($('#item-sheet').value),sheet=book.sheets[index];const loaded=book.loadSheet?await book.loadSheet(index):sheet.cells;if(token!==version)return;cells=loaded;status(`${sheet.name} · 값이 있는 셀 ${fmt(cells.length)}개를 읽었습니다. 범위를 확인하고 변환하세요.`);}
  catch(error){if(token===version){cells=[];status(error.message);}}
  finally{if(token===version)setLoading(false);}
 }
 $('#item-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;const token=++version;book=null;cells=[];invalidate('엑셀 파일을 읽고 있습니다…');setLoading(true);$('#item-sheet').replaceChildren();$('#item-file-name').textContent=file.name;
  try{const loaded=await readWorkbook(file);if(token!==version)return;book=loaded;book.sheets.forEach((sheet,i)=>{const option=el('option','',sheet.name+(sheet.hidden?' (숨김 시트)':''));option.value=String(i);$('#item-sheet').append(option);});await loadSheet();}
  catch(error){if(token===version){status(error.message);setLoading(false);}}
 };
 $('#item-sheet').onchange=loadSheet;
 $('#item-clear').onclick=()=>{version++;book=null;cells=[];setLoading(false);$('#item-file').value='';$('#item-file-name').textContent='선택한 파일이 없습니다.';$('#item-sheet').replaceChildren();$('#item-paste').value='';$('#item-range').value='';invalidate('입력을 초기화했습니다.');};
 $('#item-convert').onclick=()=>{
  if(loading)return;
  try{
   const input=source==='paste'?gridToCells(parsePasted($('#item-paste').value)):cells;
   if(!input.length){invalidate('변환할 데이터가 없습니다. 셀을 붙여넣거나 엑셀 파일을 선택하세요.');return;}
   result=convertCells(input,{mode:$('#item-mode').value,range:$('#item-range').value,sheetName:source==='file'?book?.sheets[Number($('#item-sheet').value)]?.name:'붙여넣기'});
   if(!result.rows.length){invalidate('선택한 범위에 변환할 데이터가 없습니다.');return;}
   page=0;$('#item-filter').value='all';$('#item-partial').checked=false;$('#item-results').hidden=false;
   const metrics=$('#item-metrics');metrics.replaceChildren();for(const [label,n,cls] of [['입력 항목',result.rows.length,'same'],['정상 변환',result.valid.length,'added'],['자동 보정',result.corrected,'modified'],['확인 필요',result.errors.length,'error']]){const card=el('div','metric '+cls);card.append(el('span','',label),el('strong','',fmt(n)));metrics.append(card);}
   const banner=$('#item-error-banner');banner.hidden=!result.errors.length;banner.textContent=`오류 ${fmt(result.errors.length)}건은 코드를 생성하지 않았습니다. 변환 내역에서 원본 위치와 이유를 확인하세요.`;
   $('#item-partial-label').hidden=!result.errors.length;updateOutput();renderRows();status(`변환 완료 · 총 ${fmt(result.rows.length)}건 · 정상 ${fmt(result.valid.length)}건 · 오류 ${fmt(result.errors.length)}건. 입력 순서와 중복을 유지했습니다.`);
  }catch(error){invalidate(error.message);}
 };
 function updateOutput(){if(!result)return;const allowed=!result.errors.length||$('#item-partial').checked;$('#item-output').value=allowed?result.tsv:'';$('#item-output').placeholder=allowed?'출력할 정상 항목이 없습니다.':'오류를 확인한 후, 위의 “정상 항목만 출력”을 선택하면 부분 결과가 표시됩니다.';$('#item-copy').disabled=!allowed||!result.valid.length;$('#item-download').disabled=!allowed||!result.valid.length;$('#item-macro').disabled=macroLoading||!allowed||!result.valid.length;$('#item-copy').textContent=result.errors.length?'정상 항목만 복사':'결과 복사';}
 $('#item-partial').onchange=updateOutput;
 function renderRows(){
  if(!result)return;const filter=$('#item-filter').value,rows=result.rows.filter(r=>filter==='error'?!r.ok:filter==='corrected'?r.corrected:true),body=$('#item-rows');body.replaceChildren();
  for(const row of rows.slice(page*100,page*100+100)){
   const tr=el('tr',!row.ok?'item-invalid':'');const position=el('td');position.append(el('strong','',String(row.number)),el('small','',row.sheet+' · '+row.cell));
   const original=el('td');original.append(el('span','',row.original||'(이름 없음)'));if(row.inputEnhancement!=='')original.append(el('small','',`강화 셀 ${row.enhancementCell}: ${row.inputEnhancement}`));
   const detail=el('td');detail.append(el('span','badge '+(!row.ok?'error':row.corrected?'modified':'added'),!row.ok?'오류':row.corrected?'보정':'정상'),el('small','',row.ok?(row.notes.join(' / ')||'규칙표 일치'):row.error));
   tr.append(position,original,el('td','item-code',row.code||'—'),el('td','',row.enhancement??'—'),detail);body.append(tr);
  }
  if(!rows.length){const tr=el('tr'),td=el('td','','해당 항목이 없습니다.');td.colSpan=5;tr.append(td);body.append(tr);}
  $('#item-prev').disabled=page===0;$('#item-next').disabled=(page+1)*100>=rows.length;$('#item-page').textContent=`${fmt(rows.length?page*100+1:0)}–${fmt(Math.min((page+1)*100,rows.length))} / ${fmt(rows.length)}`;
 }
 $('#item-filter').onchange=()=>{page=0;renderRows();};$('#item-prev').onclick=()=>{page--;renderRows();};$('#item-next').onclick=()=>{page++;renderRows();};
 $('#item-copy').onclick=async()=>{
  const text=$('#item-output').value;if(!text)return;
  try{try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(text);}catch{$('#item-output').focus();$('#item-output').select();if(!document.execCommand('copy'))throw new Error();}status(`${fmt(result.valid.length)}건을 복사했습니다. 엑셀에서 시작 셀을 선택하고 Ctrl+V를 누르세요.${result.errors.length?' 오류 항목 '+result.errors.length+'건은 제외됐습니다.':''}`);}
  catch{$('#item-output').focus();$('#item-output').select();status('자동 복사를 사용할 수 없습니다. 선택된 결과에서 Ctrl+C를 누르거나 TSV 저장을 이용하세요.');}
 };
 $('#item-macro').onclick=async()=>{
  if(macroLoading||!result||!result.valid.length||(result.errors.length&&!$('#item-partial').checked))return;
  const snapshot=result;macroLoading=true;updateOutput();$('#item-macro').textContent='Python 파일 준비 중…';
  try{
   const template=await loadMacroTemplate();
   if(result!==snapshot||(snapshot.errors.length&&!$('#item-partial').checked))return;
   const code=buildMacroPython(template,snapshot.valid);
   const url=URL.createObjectURL(new Blob([code],{type:'text/x-python;charset=utf-8'})),link=el('a');
   const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'').replace('T','_');
   link.href=url;link.download=`ItemCollection_${stamp}${snapshot.errors.length?'_partial':''}.py`;
   document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
   status(`${fmt(snapshot.valid.length)}개 데이터가 포함된 Python 매크로를 다운로드했습니다.${snapshot.errors.length?' 오류 항목 '+snapshot.errors.length+'건은 제외됐습니다.':''} 파일을 실행하면 준비 안내 GUI가 열립니다.`);
  }catch(error){if(result===snapshot)status(error.message);}
  finally{macroLoading=false;$('#item-macro').textContent='매크로 Python 다운로드';if(result)updateOutput();}
 };
 $('#item-download').onclick=()=>{const text=$('#item-output').value;if(!text)return;const url=URL.createObjectURL(new Blob([text],{type:'text/tab-separated-values;charset=utf-8'})),a=el('a');a.href=url;a.download=result.errors.length?'item_codes_partial.tsv':'item_codes.tsv';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
}
