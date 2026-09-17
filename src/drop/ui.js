import {quantity,averageKills,averageHelp,probabilityText,probabilityString,dropSource,dropTrace,groupColor,pathGroupKey,monsterGroupKey} from './display.js';
export function mountDropTool(){
 const root=document.querySelector('#drop-view'),$=s=>root.querySelector(s);
 const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
 let state=null,selected=null,view='paths',page=0,searchOffset=0,searchCount=0,query='',request=0,detailRequest=0,busy=false,polling=null,jobId=null;
 root.innerHTML=`
 <section class="intro"><div><div class="eyebrow">DROP TABLE INSPECTOR</div><h1>드랍 테이블 검수</h1><p>몬스터 이름 또는 ID로 아이템과 확률을 조회합니다.</p></div><button class="quiet" id="drop-refresh">공유 데이터 새로고침</button></section>
 <section class="drop-data-bar"><div><strong id="drop-data-title">공유 데이터 확인 중…</strong><p id="drop-data-meta"></p></div><span class="drop-version">ID별 최신 v숫자 적용</span></section>
 <details class="drop-admin" id="drop-admin" hidden><summary>담당자 데이터 등록 / 갱신</summary><p>Drop · NPC · Item · String 파일을 한 번 등록하면 모든 직원이 같은 데이터를 조회합니다. 기존 데이터는 새 파일 4개의 분석이 끝난 뒤 교체됩니다.</p>
 <div class="drop-files"><label>Drop (.xlsb / .xlsx)<input type="file" id="drop-file-drop" accept=".xlsb,.xlsx"></label><label>NPC (.xlsx / .xlsb)<input type="file" id="drop-file-npc" accept=".xlsx,.xlsb"></label><label>Item (.xlsb / .xlsx)<input type="file" id="drop-file-item" accept=".xlsb,.xlsx"></label><label>String (.xlsx / .xlsb)<input type="file" id="drop-file-string" accept=".xlsx,.xlsb"></label></div>
 <div class="drop-register-actions"><button class="primary" id="drop-register">공유 데이터 등록</button><button class="quiet" id="drop-cancel" hidden>미완료 등록 취소</button><span id="drop-job" role="status" aria-live="polite"></span></div><progress id="drop-upload-progress" max="100" value="0" hidden></progress>
 </details><p class="item-help" id="drop-manager-note" hidden>데이터 갱신은 담당자가 서버 PC에서 localhost 주소로 접속하여 진행합니다.</p>
 <details class="drop-source"><summary>사용 파일 · 계산 기준 · 데이터 진단</summary><div id="drop-sources"></div><p>기본 시트의 같은 ID 중 v 뒤 숫자가 가장 큰 행을 선택합니다. 같은 최신 버전에 서로 다른 값이 있으면 충돌로 표시합니다. &amp; 분기 시트는 병합하지 않습니다.</p><p>최종 확률 = 그룹 확률 ÷ 1,000,000 × 아이템 확률 ÷ 1,000,000. 직접 지급 재화도 포함합니다. 이벤트·버프·서버 보정은 기본 확률에 포함하지 않습니다.</p><ul id="drop-diagnostics"></ul></details>
 <section class="drop-search-panel"><form id="drop-search-form"><label for="drop-search">몬스터 이름 / ID</label><div class="drop-search-line"><input id="drop-search" placeholder="예: 마레크 또는 1330000" autocomplete="off"><button class="primary" id="drop-search-button">조회</button></div><label class="drop-direct"><input type="checkbox" id="drop-direct"> Drop_Info ID로 직접 조회 (이벤트 드랍 포함)</label></form><p class="item-help">같은 이름의 몬스터는 ID·레벨·지역을 보고 선택하세요. NPC_Abil의 Drop_ID 연결을 따라 조회합니다.</p></section>
 <p id="drop-status" class="status" role="status" aria-live="polite"></p>
 <div class="drop-workspace"><aside class="drop-candidates"><div id="drop-candidates-title" class="drop-list-title">몬스터 검색 결과</div><div id="drop-candidates"></div><div class="pager"><button class="quiet" id="drop-search-prev">이전</button><span id="drop-search-page"></span><button class="quiet" id="drop-search-next">다음</button></div></aside>
 <section id="drop-result" class="drop-result"><div class="drop-empty">몬스터를 검색하고 선택하면 드랍 목록이 표시됩니다.</div></section></div>`;
 const message=s=>{$('#drop-status').textContent=s;};
 async function api(url,options){const r=await fetch(url,{cache:'no-store',...options});let data;try{data=await r.json();}catch{throw new Error('새 server.mjs로 서버를 실행해 주세요. 드랍 조회에는 Node 서버가 필요합니다.');}if(!r.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');return data;}
 function setBusy(value){busy=value;$('#drop-register').disabled=value;for(const input of root.querySelectorAll('.drop-files input'))input.disabled=value;}
 async function refresh(){
  try{
   state=await api('/api/drop/status');const m=state.metadata;
   $('#drop-admin').hidden=!state.canManage;$('#drop-manager-note').hidden=state.canManage;
   $('#drop-data-title').textContent=m?`공유 데이터 등록됨 · 몬스터/드랍 ID ${m.indexStats.monsters.toLocaleString()}개`:'등록된 공유 데이터가 없습니다.';
   $('#drop-data-meta').textContent=m?`갱신 ${new Date(m.registeredAt).toLocaleString('ko-KR')} · 그룹 ${m.stats.counts.groups.toLocaleString()}개 · 드랍 아이템 ${m.stats.counts.drops.toLocaleString()}개`:(state.loadError||'담당자가 엑셀 파일 4개를 등록하면 조회할 수 있습니다.');
   $('#drop-sources').replaceChildren();for(const source of m?.sources||[]){const p=make('p','',`${source.name} · ${(source.bytes/1024/1024).toFixed(1)}MB`);p.append(make('small','',source.sheets.join(', ')));$('#drop-sources').append(p);}
   $('#drop-diagnostics').replaceChildren();for(const text of m?.diagnostics||[])$('#drop-diagnostics').append(make('li','',text));
   if(m?.diagnosticCount>100)$('#drop-diagnostics').append(make('li','',`진단 ${m.diagnosticCount}건 중 앞 100건 표시. 개별 조회에서도 해당 오류를 확인할 수 있습니다.`));
   $('#drop-search-button').disabled=!state.available;
   if(state.job){jobId=state.job.id;$('#drop-job').textContent=state.job.error||state.job.message;$('#drop-cancel').hidden=state.job.state!=='uploading'||busy;}
   if(state.job?.state==='processing'){setBusy(true);schedulePoll();}else if(!busy)$('#drop-cancel').hidden=state.job?.state!=='uploading';
   return state;
  }catch(e){message(e.message);$('#drop-data-title').textContent='서버 연결을 확인하세요.';return null;}
 }
 function schedulePoll(){if(polling)return;polling=setTimeout(async()=>{polling=null;const next=await refresh();if(!next){setBusy(false);return;}if(next.job?.state==='processing')schedulePoll();else{
  setBusy(false);$('#drop-upload-progress').hidden=true;$('#drop-cancel').hidden=true;
  if(next.job?.state==='done'){detailRequest++;selected=null;$('#drop-result').replaceChildren(make('div','drop-empty','공유 데이터가 갱신되었습니다. 몬스터를 다시 선택하세요.'));await search();message('새 공유 데이터로 갱신했습니다.');}
 }},1500);}
 async function search(){
  const token=++request;query=$('#drop-search').value.trim();
  if($('#drop-direct').checked){if(!/^\d+$/.test(query)){message('직접 조회에는 Drop_Info의 숫자 ID를 입력하세요.');return;}await choose(query,true);return;}
  try{message('검색 중…');const data=await api(`/api/drop/search?q=${encodeURIComponent(query)}&offset=${searchOffset}`);if(token!==request)return;
   searchCount=data.total;$('#drop-candidates-title').textContent=`검색 결과 ${data.total.toLocaleString()}개`;$('#drop-candidates').replaceChildren();
   for(const m of data.rows){const b=make('button','drop-monster drop-group-tint');b.style.setProperty('--drop-group-color',groupColor(monsterGroupKey(m)));b.type='button';b.append(make('strong','',m.name),make('span','',`ID ${m.id}${m.level!=null?' · Lv.'+m.level:''}`),make('small','',[m.map,m.area,m.kind==='table'?'NPC 미연결 드랍 ID':''].filter(Boolean).join(' · ')));b.onclick=()=>{for(const el of root.querySelectorAll('.drop-monster'))el.classList.remove('active');b.classList.add('active');choose(m.id,m.kind==='table');};$('#drop-candidates').append(b);}
   $('#drop-search-prev').disabled=searchOffset===0;$('#drop-search-next').disabled=searchOffset+50>=searchCount;$('#drop-search-page').textContent=`${data.total?searchOffset+1:0}–${Math.min(searchOffset+50,searchCount)}`;
   if(!data.total)$('#drop-candidates').append(make('p','drop-empty','일치하는 몬스터가 없습니다.'));
   message('몬스터를 선택하면 해당 드랍 목록을 표시합니다.');if(data.rows.length===1)await choose(data.rows[0].id,data.rows[0].kind==='table');
  }catch(e){if(token===request)message(e.message);}
 }
 async function choose(id,direct){const token=++detailRequest;try{message('드랍 경로를 조회하고 있습니다…');const data=await api(`/api/drop/monster?id=${encodeURIComponent(id)}${direct?'&direct=1':''}`);if(token!==detailRequest)return;selected=data;page=0;renderResult();message(`${data.monster.name} · 드랍 경로 ${data.paths.length.toLocaleString()}개`);}catch(e){if(token===detailRequest)message(e.message);}}
 const smallPercent=probabilityText;
 function filtered(){if(!selected)return[];const rows=view==='paths'?selected.paths:selected.summary,q=($('#drop-item-filter')?.value||'').trim().toLowerCase(),zero=$('#drop-show-zero')?.checked;return rows.filter(r=>(!q||(r.name+' '+r.itemId+' '+(r.groupId||'')).toLowerCase().includes(q))&&(zero||(view==='paths'?r.numerator!==0:r.chance!==0)));}
 function renderResult(){
  const target=$('#drop-result');target.innerHTML=`<div class="drop-result-head"><h2 id="drop-monster-name"></h2><p id="drop-monster-meta"></p><p id="drop-monster-source" class="item-help"></p></div><div class="drop-warnings" id="drop-warnings"></div><div class="drop-result-toolbar"><div class="item-tabs"><button id="drop-paths">드랍 목록</button><button id="drop-summary">아이템별 요약</button></div><button class="quiet" id="drop-tsv">결과 TSV 저장</button></div><p class="drop-calculation" id="drop-calculation"></p><div class="drop-result-filters"><input id="drop-item-filter" placeholder="아이템 이름 / ID / 그룹 ID 필터"><label><input id="drop-show-zero" type="checkbox"> 0% 포함</label></div><details class="drop-columns" id="drop-extra"><summary>계산 근거 및 검수 열 펼치기</summary><p>그룹 확률 · 그룹 내 확률 · 그룹 ID · 추첨 슬롯 · Drop_Item ID · 검수 · 원본 경로</p></details><div class="drop-table-scroll"><table class="drop-table drop-lookup-table"><thead id="drop-head"></thead><tbody id="drop-rows"></tbody></table></div><div class="pager"><button class="quiet" id="drop-prev">이전</button><span id="drop-page"></span><button class="quiet" id="drop-next">다음</button></div>`;
  const m=selected.monster;$('#drop-monster-name').textContent=m.name;$('#drop-monster-meta').textContent=`몬스터 ID ${m.id}${m.level!=null?' · Lv.'+m.level:''}`;
  $('#drop-monster-source').textContent=dropSource(m.dropSource);
  $('#drop-extra').ontoggle=()=>renderRows();
  for(const w of selected.warnings)$('#drop-warnings').append(make('p','',w));$('#drop-warnings').hidden=!selected.warnings.length;
  for(const key of ['paths','summary'])$('#drop-'+key).onclick=()=>{view=key;page=0;renderRows();};
  $('#drop-item-filter').oninput=()=>{page=0;renderRows();};$('#drop-show-zero').onchange=()=>{page=0;renderRows();};$('#drop-prev').onclick=()=>{page--;renderRows();};$('#drop-next').onclick=()=>{page++;renderRows();};$('#drop-tsv').onclick=download;renderRows();
 }
 function summaryQuantity(r){return [...new Set(selected.paths.filter(p=>p.itemId===r.itemId&&p.numerator!==0).map(p=>quantity(p.min,p.max)))].join(', ')||'—';}
 function cellsFor(r,expanded=true){
  if(view==='paths'){const primary=[r.name,r.itemId,quantity(r.min,r.max),probabilityString(r.percent)];return expanded?[...primary,probabilityString(r.groupPercent),probabilityString(r.itemPercent),r.kind==='직접 지급'?'직접 지급':r.groupId,r.groupSlot,r.dropItemId||'—',r.issue||'',dropTrace(r.trace)]:primary;}
  const primary=[r.name,r.itemId,summaryQuantity(r),smallPercent(r.chance),averageKills(r.expectedSelections)];return expanded?[...primary,r.paths,r.issues.join(' / ')]:primary;
 }
 function headers(expanded=true){const primary=view==='paths'?['아이템명','인게임 ID','수량','최종 확률']:['아이템명','인게임 ID','수량','최종 확률*','평균 필요 처치 수'];return !expanded?primary:view==='paths'?[...primary,'그룹 확률','그룹 내 확률','그룹 ID','추첨 슬롯','Drop_Item ID','검수','원본 경로']:[...primary,'경로 수','검수'];}
 function renderRows(){
  $('#drop-paths').classList.toggle('active',view==='paths');$('#drop-summary').classList.toggle('active',view==='summary');
  $('#drop-calculation').textContent=view==='paths'?'최종 확률 = 그룹 확률 × 그룹 내 아이템 확률. 같은 드랍 그룹은 같은 배경색입니다. 서로 다른 추첨 슬롯은 각각 표시하며, 수량은 당첨 시 기준입니다.':'*아이템별 최종 확률은 서로 다른 추첨 슬롯이 독립이라는 가정으로 합산한 1회 이상 획득 확률입니다. '+averageHelp;
  const expanded=$('#drop-extra').open,rows=filtered(),head=$('#drop-head'),body=$('#drop-rows');head.closest('table').classList.toggle('drop-expanded',expanded);head.replaceChildren();body.replaceChildren();const tr=make('tr');for(const h of headers(expanded))tr.append(make('th','',h));head.append(tr);
  const itemGroups=new Map();for(const p of selected.paths){if(!itemGroups.has(p.itemId))itemGroups.set(p.itemId,new Set());itemGroups.get(p.itemId).add(pathGroupKey(p));}
  for(const r of rows.slice(page*100,(page+1)*100)){
   const invalid=r.issue||r.issues?.length,row=make('tr','drop-group-tint'+(invalid?' drop-invalid':''));const groups=itemGroups.get(r.itemId);
   const key=view==='paths'?pathGroupKey(r):groups?.size===1?[...groups][0]:null;
   if(key)row.style.setProperty('--drop-group-color',groupColor(key));
   cellsFor(r,expanded).forEach((value,i)=>{const td=make('td',i===3?'drop-probability':'',String(value));if(i===0&&!r.nameFound)td.append(make('small','','이름 미연결 · ID 표시'));if(i===0&&invalid)td.append(make('small','drop-issue-flag','계산 오류 · 검수 열 확인'));if(i===0&&r.memo)td.title=`기획용 메모: ${r.memo}`;if(view==='summary'&&i===4)td.title=averageHelp;row.append(td);});body.append(row);
  }
  if(!rows.length){const tr=make('tr'),td=make('td','','표시할 드랍 항목이 없습니다.');td.colSpan=headers(expanded).length;tr.append(td);body.append(tr);}
  $('#drop-prev').disabled=page===0;$('#drop-next').disabled=(page+1)*100>=rows.length;$('#drop-page').textContent=`${rows.length?page*100+1:0}–${Math.min((page+1)*100,rows.length)} / ${rows.length}`;$('#drop-tsv').disabled=!rows.length;
 }
 function download(){const safe=v=>{const s=String(v??'').replace(/[\t\r\n]+/g,' ');return /^[=+@-]/.test(s)?"'"+s:s;};const text=[headers(),...filtered().map(r=>cellsFor(r,true))].map(r=>r.map(safe).join('\t')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/tab-separated-values;charset=utf-8'}));const a=make('a');a.href=url;a.download=`drop_${selected.monster.id}_${view}.tsv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function upload(role,file,id){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',`/api/drop/import/${id}/${role}`);xhr.setRequestHeader('X-QA-Import','1');xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.upload.onprogress=e=>{if(e.lengthComputable){$('#drop-upload-progress').value=e.loaded/e.total*100;$('#drop-job').textContent=`${file.name} 전송 ${Math.round(e.loaded/e.total*100)}%`;}};xhr.onload=()=>{try{const data=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300)resolve(data);else reject(new Error(data.error));}catch{reject(new Error('파일 전송 응답을 확인하세요.'));}};xhr.onerror=()=>reject(new Error('전송이 중단되었습니다. 미완료 등록을 취소하고 다시 시도하세요.'));xhr.send(file);});}
 $('#drop-register').onclick=async()=>{
  if(busy)return;const files={};for(const key of ['drop','npc','item','string']){files[key]=$('#drop-file-'+key).files[0];if(!files[key]){message('Drop, NPC, Item, String 파일 4개를 모두 선택하세요.');return;}if(files[key].size>160*1024*1024){message('파일 하나는 160MB 이하로 등록하세요.');return;}}
  setBusy(true);$('#drop-cancel').hidden=true;$('#drop-upload-progress').hidden=false;
  try{const j=await api('/api/drop/import',{method:'POST',headers:{'Content-Type':'application/json','X-QA-Import':'1'},body:JSON.stringify(Object.fromEntries(Object.entries(files).map(([k,f])=>[k,f.name])))});jobId=j.id;
   for(const [role,file] of Object.entries(files))await upload(role,file,j.id);
   await api(`/api/drop/import/${j.id}/commit`,{method:'POST',headers:{'X-QA-Import':'1'}});$('#drop-upload-progress').hidden=true;$('#drop-job').textContent='엑셀을 분석하고 있습니다. 이전 데이터는 계속 조회할 수 있습니다.';schedulePoll();
  }catch(e){setBusy(false);message(e.message);$('#drop-upload-progress').hidden=true;await refresh();}
 };
 $('#drop-cancel').onclick=async()=>{try{await api(`/api/drop/import/${jobId}`,{method:'DELETE',headers:{'X-QA-Import':'1'}});jobId=null;$('#drop-job').textContent='미완료 등록을 취소했습니다.';$('#drop-cancel').hidden=true;}catch(e){message(e.message);}};
 $('#drop-search-form').onsubmit=e=>{e.preventDefault();searchOffset=0;search();};$('#drop-search-prev').onclick=()=>{searchOffset=Math.max(0,searchOffset-50);search();};$('#drop-search-next').onclick=()=>{searchOffset+=50;search();};
 $('#drop-refresh').onclick=async()=>{await refresh();if(state?.available){detailRequest++;selected=null;$('#drop-result').replaceChildren(make('div','drop-empty','공유 데이터를 새로 읽었습니다. 몬스터를 다시 선택하세요.'));searchOffset=0;await search();}};
 refresh().then(s=>{if(s?.available)search();});
}
