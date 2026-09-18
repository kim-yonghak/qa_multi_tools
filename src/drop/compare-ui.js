import {quantity,quantityList,probabilityText,probabilityString,probabilityDifference,averageKillChange,averageKills,averageHelp,dropTrace} from './display.js';
import {summaryCard} from './summary-ui.js';
const direction={increase:'확률 증가',decrease:'확률 감소',added:'추가',removed:'제거',other:'수량 / 추첨 변경',error:'계산 오류'};
const fmt=probabilityText;
const qty=quantityList;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
export function mountDropCompare(){
 const root=document.querySelector('#dropcompare-view'),$=s=>root.querySelector(s);
 let result=null,busy=false,jobId=null,poll=null,detailToken=0,page=0,selected=null,summaryPage=0;
 const MONSTERS_PER_PAGE=20,GROUPS_PER_PAGE=5;
 root.innerHTML=`<section class="intro"><div><div class="eyebrow">DROP CHANGE REVIEW</div><h1>드랍 변경 비교</h1><p>두 Drop 파일에서 달라진 몬스터를 찾고, 지역·레벨·아이템 등급별 변경을 확인합니다.</p></div><button class="quiet" id="dc-refresh">결과 새로고침</button></section>
 <details class="drop-admin" id="dc-admin" hidden><summary>담당자 · 비교할 Drop 파일 등록</summary><p>현재 등록된 NPC · Item · String을 두 버전에 동일하게 적용합니다. 기존 드랍 조회 데이터는 유지됩니다.</p><div class="drop-files"><label>구버전 Drop<input id="dc-old" type="file" accept=".xlsb,.xlsx"></label><label>신버전 Drop<input id="dc-new" type="file" accept=".xlsb,.xlsx"></label></div><div class="drop-register-actions"><button class="primary" id="dc-run">두 파일 비교</button><button class="quiet" id="dc-cancel" hidden>미완료 업로드 취소</button></div><progress id="dc-progress" max="100" value="0" hidden></progress></details>
 <p class="item-help" id="dc-note">담당자가 서버 PC의 localhost에서 비교 파일을 등록하면 직원 모두 결과를 볼 수 있습니다.</p><p id="dc-status" role="status" aria-live="polite"></p>
 <div class="dc-stats" id="dc-stats"></div><details class="drop-source"><summary>사용 파일 · 기준 · 계산 가정</summary><div id="dc-source"></div></details>
 <section class="dc-summary"><div class="dc-heading"><h2>그룹별 변경 요약</h2><button class="quiet" id="dc-export" disabled>요약 TXT 저장</button></div><input id="dc-summary-search" class="dc-summary-search" type="search" placeholder="요약 그룹 검색 · 지역, 분류, 몬스터 이름 또는 ID" aria-label="요약 그룹 검색"><p class="item-help">그룹은 페이지당 5개씩 표시합니다. 펼친 내용은 요약 영역 안에서 스크롤할 수 있습니다.</p><div id="dc-summary" tabindex="0" role="region" aria-label="그룹별 변경 요약 목록"><p>비교 파일을 등록하면 요약이 표시됩니다.</p></div><div class="pager"><button class="quiet" id="dc-summary-prev" disabled>이전</button><span id="dc-summary-page" aria-live="polite"></span><button class="quiet" id="dc-summary-next" disabled>다음</button></div></section>
 <div class="dc-filter"><input id="dc-search" type="search" aria-label="전체 변경 몬스터 검색" placeholder="전체 변경 몬스터 검색 · 이름, ID, 고유번호, 지역"><select id="dc-group" aria-label="요약 그룹"><option value="">모든 그룹</option></select></div>
 <div class="drop-workspace"><aside class="drop-candidates"><div id="dc-count" class="drop-list-title">변경된 몬스터</div><div id="dc-list" tabindex="0" role="region" aria-label="변경 몬스터 목록"></div><div class="pager"><button class="quiet" id="dc-prev">이전</button><span id="dc-page"></span><button class="quiet" id="dc-next">다음</button></div></aside><section id="dc-detail" class="drop-result" tabindex="0" aria-label="몬스터 상세 변경점"><div class="drop-empty">변경된 몬스터를 선택하세요.</div></section></div>`;
 const api=async(url,options)=>{const r=await fetch('/api/drop-compare/'+url,{cache:'no-store',...options});const d=await r.json();if(!r.ok)throw new Error(d.error||'서버 요청 실패');return d;};
 const msg=s=>$('#dc-status').textContent=s;
 function lock(v){busy=v;for(const s of ['#dc-run','#dc-old','#dc-new'])$(s).disabled=v;$('#dc-cancel').hidden=v;}
 function download(name,text){const link=el('a');const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function refresh(load=true){
  try{const s=await api('status');$('#dc-admin').hidden=!s.canManage;$('#dc-note').hidden=s.canManage;
   jobId=s.job?.id||null;const running=['processing','uploading'].includes(s.job?.state);lock(running);$('#dc-cancel').hidden=!(s.canManage&&s.job?.state==='uploading');
   if(s.job)msg(s.job.error||s.job.message);else msg(s.loadError||(!s.referencesReady?'먼저 드랍 테이블 검수 메뉴에서 기준 파일 4개를 등록하세요.':''));
   if(s.job?.state==='processing'&&!poll)poll=setTimeout(async()=>{poll=null;await refresh(true);},1500);
   if(s.available&&load&&s.job?.state!=='processing')await loadResult();
  }catch(e){lock(false);msg('결과 확인 실패: '+e.message);}
 }
 async function loadResult(){result=await api('result');detailToken++;selected=null;$('#dc-detail').replaceChildren(el('div','변경된 몬스터를 선택하세요.','drop-empty'));page=0;
  $('#dc-stats').replaceChildren();for(const [label,n] of [['검사한 ID',result.count.checked],['변경된 몬스터',result.count.changed],['아이템 변경',result.count.items],['오류 확인 필요',result.count.errors]]){const card=el('div');card.append(el('span',label),el('strong',n.toLocaleString()));$('#dc-stats').append(card);}
  $('#dc-source').replaceChildren(el('p',`비교 ${new Date(result.createdAt).toLocaleString('ko-KR')} · 기준 데이터 등록 ${new Date(result.referenceRegisteredAt).toLocaleString('ko-KR')}`));
  for(const [side,files] of Object.entries(result.sources))for(const f of files)$('#dc-source').append(el('p',`${side==='old'?'구버전':side==='new'?'신버전':'공통 기준'}: ${f.name} · SHA256 ${f.sha256}`));
  for(const x of result.assumptions)$('#dc-source').append(el('p',x));
  if(!result.metadataAvailable)$('#dc-source').append(el('p','분류 정보가 부족합니다. 드랍 테이블 검수에서 최신 기준 파일을 다시 등록하고 비교하세요.','dc-warning'));
  summaryPage=0;$('#dc-summary-search').value='';$('#dc-search').value='';
  $('#dc-group').replaceChildren(new Option('모든 그룹',''));
  result.groups.forEach((g,i)=>$('#dc-group').append(new Option(`${g.title} / ${g.npcType} / Lv.${g.levelLabel} / ${g.ids.length}종`,String(i))));
  $('#dc-export').disabled=false;renderSummary();renderList(true);$('#dc-detail').scrollTop=0;
 }
 function renderSummary(){if(!result)return;
  const q=$('#dc-summary-search').value.toLowerCase().replace(/\s/g,'');
  const groups=result.groups.map((g,i)=>({g,i})).filter(({g})=>[g.title,g.map,g.areaLabel,g.npcType,g.uniqueNumber,g.levelLabel,...g.ids,...(g.members||[]).map(m=>m.name)].join(' ').toLowerCase().replace(/\s/g,'').includes(q));
  const pages=Math.max(1,Math.ceil(groups.length/GROUPS_PER_PAGE));summaryPage=Math.max(0,Math.min(summaryPage,pages-1));
  const target=$('#dc-summary');target.replaceChildren();target.scrollTop=0;
  for(const {g,i} of groups.slice(summaryPage*GROUPS_PER_PAGE,(summaryPage+1)*GROUPS_PER_PAGE)){
   const selectGroup=()=>{$('#dc-search').value='';$('#dc-group').value=String(i);page=0;renderList(true);$('#dc-count').scrollIntoView({behavior:'smooth',block:'start'});};
   const selectMonster=id=>{$('#dc-search').value='';$('#dc-group').value=String(i);const members=result.monsters.filter(x=>g.ids.includes(x.monster.id));page=Math.floor(Math.max(0,members.findIndex(x=>x.monster.id===id))/MONSTERS_PER_PAGE);choose(id);$('#dc-list').scrollTop=0;$('#dc-detail').scrollIntoView({behavior:'smooth',block:'start'});};
   target.append(summaryCard(g,i,selectGroup,selectMonster));
  }
  if(!groups.length)target.append(el('p',result.groups.length?'검색 조건에 해당하는 그룹이 없습니다.':'비교 기준에 해당하는 변경이 없습니다.'));
  $('#dc-summary-prev').disabled=summaryPage===0;$('#dc-summary-next').disabled=summaryPage>=pages-1;
  $('#dc-summary-page').textContent=`${groups.length?summaryPage+1:0} / ${groups.length?pages:0}페이지 · ${groups.length}개 그룹`;
 }

 function renderList(resetScroll=false){if(!result)return;const q=$('#dc-search').value.toLowerCase().replace(/\s/g,''),g=$('#dc-group').value,ids=g===''?null:new Set(result.groups[Number(g)].ids);
  const rows=result.monsters.filter(x=>(!ids||ids.has(x.monster.id))&&[x.monster.id,x.monster.name,x.monster.uniqueNumber,x.monster.map,x.monster.area].join(' ').toLowerCase().replace(/\s/g,'').includes(q));
  page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(rows.length/MONSTERS_PER_PAGE)-1)));
  $('#dc-list').replaceChildren();if(resetScroll)$('#dc-list').scrollTop=0;$('#dc-count').textContent=`변경된 몬스터 ${rows.length}종`;
  for(const r of rows.slice(page*MONSTERS_PER_PAGE,(page+1)*MONSTERS_PER_PAGE)){const m=r.monster,b=el('button',null,'drop-monster');b.classList.toggle('active',selected===m.id);b.append(el('strong',`${m.name} · ${r.status}`),el('span',`ID ${m.id} · 표시 Lv.${m.displayLevel||m.level||'미등록'}`),el('small',`${m.npcType||'분류 미등록'} · ${m.area&&m.area!=='없음'?m.area:m.map||'지역 미등록'}`),el('small',`아이템 ${r.itemChanges}건 · 증가 ${r.metrics.increase} / 감소 ${r.metrics.decrease}`));b.onclick=()=>choose(m.id);$('#dc-list').append(b);}
  $('#dc-prev').disabled=page===0;$('#dc-next').disabled=(page+1)*MONSTERS_PER_PAGE>=rows.length;$('#dc-page').textContent=`${rows.length?page+1:0} / ${Math.ceil(rows.length/MONSTERS_PER_PAGE)}페이지 · ${rows.length?page*MONSTERS_PER_PAGE+1:0}–${Math.min((page+1)*MONSTERS_PER_PAGE,rows.length)} / ${rows.length}종`;
 }
 async function choose(id){const token=++detailToken;selected=id;renderList();$('#dc-detail').scrollTop=0;$('#dc-detail').replaceChildren(el('div','상세 변경점 읽는 중…','drop-empty'));
  try{const data=await api('monster?id='+encodeURIComponent(id)+'&createdAt='+encodeURIComponent(result.createdAt));if(token!==detailToken)return;const target=$('#dc-detail'),m=data.monster;target.replaceChildren();
   const head=el('div',null,'drop-result-head');head.append(el('h2',m.name),el('p',`ID ${id} · 고유번호 ${m.uniqueNumber||'미등록'} · 표시 Lv.${m.displayLevel||m.level||'미등록'}`),el('p',`${m.map||''} / ${m.area||''} / ${m.npcType||''}`));target.append(head);
   const save=el('button','상세 TSV 저장','quiet');save.onclick=()=>{const safe=v=>{const t=String(v??'').replace(/[\t\r\n]/g,' ');return /^[=+@-]/.test(t)?"'"+t:t;};download(`drop-${id}-changes.tsv`,[['아이템 ID','이름','등급','변경','이전 확률','변경 확률','이전 수량','변경 수량','확률 차이','평균 필요 처치 수 변화'],...data.changes.map(c=>[c.itemId,c.name,c.gradeName,direction[c.direction],fmt(c.oldChance),fmt(c.newChance),qty(c.oldQuantity),qty(c.newQuantity),probabilityDifference(c.oldChance,c.newChance),averageKillChange(c.oldExpected,c.newExpected)])].map(row=>row.map(safe).join('\t')).join('\n'));};head.append(save);
   for(const warning of data.warnings)target.append(el('p',warning,'drop-warnings'));
   target.append(el('p','확률은 해당 아이템을 1회 이상 획득할 확률입니다. 각 항목을 펼치면 이전·변경 계산 경로와 원본 행이 표시됩니다. '+averageHelp,'drop-calculation'));
   for(const c of data.changes){const tone=['increase','added'].includes(c.direction)?'increase':['decrease','removed'].includes(c.direction)?'decrease':'neutral';const d=el('details',null,'dc-change dc-change-'+tone),sum=el('summary');sum.append(el('strong',`${c.name} (${c.itemId})`),el('span',`${c.gradeName} · ${direction[c.direction]}${c.quantityChanged?' · 수량 변경':''}`,`dc-${c.direction}`));d.append(sum);d.open=data.changes.length<=10;
    const grid=el('div',null,'dc-values');for(const [label,value] of [['이전 확률',fmt(c.oldChance)],['변경 확률',fmt(c.newChance)],['차이',probabilityDifference(c.oldChance,c.newChance)],['이전 수량',qty(c.oldQuantity)],['변경 수량',qty(c.newQuantity)],['평균 필요 처치 수',averageKillChange(c.oldExpected,c.newExpected)]]){const block=el('div');if(label==='평균 필요 처치 수')block.title=averageHelp;block.append(el('small',label),el('strong',value));grid.append(block);}d.append(grid);
    for(const [side,paths] of [['이전',c.before],['변경',c.after]]){d.append(el('h3',side));if(!paths.length)d.append(el('p','해당 아이템 경로 없음'));const scroll=el('div',null,'drop-table-scroll'),table=el('table',null,'drop-table dc-path-table'),thead=el('thead'),tr=el('tr');for(const h of ['경로','최종 확률','수량','원본 시트 · 행'])tr.append(el('th',h));thead.append(tr);table.append(thead);const body=el('tbody');for(const p of paths){const row=el('tr');for(const v of [`${p.kind} / 그룹 ${p.groupId||'—'} / Drop_Item ${p.dropItemId||'—'} / 슬롯 ${p.groupSlot}`,p.issue||probabilityString(p.percent),quantity(p.min,p.max),dropTrace(p.trace)])row.append(el('td',v));body.append(row);}table.append(body);scroll.append(table);d.append(scroll);}target.append(d);
   }
   if(!data.changes.length)target.append(el('p','테이블 추가·제거 또는 연결 오류 변경입니다. 위 진단을 확인하세요.','drop-empty'));
  }catch(e){if(token===detailToken)$('#dc-detail').replaceChildren(el('p',e.message,'drop-warnings'));}
 }
 function upload(role,file){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',`/api/drop-compare/import/${jobId}/${role}`);xhr.setRequestHeader('X-QA-Import','1');xhr.upload.onprogress=e=>{if(e.lengthComputable){$('#dc-progress').value=e.loaded/e.total*100;msg(`${role==='old'?'구버전':'신버전'} 전송 ${Math.round(e.loaded/e.total*100)}%`);}};xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)resolve();else reject(new Error('파일 전송 실패: '+xhr.responseText));};xhr.onerror=()=>reject(new Error('서버 연결이 끊겼습니다.'));xhr.send(file);});}
 $('#dc-run').onclick=async()=>{const old=$('#dc-old').files[0],next=$('#dc-new').files[0];if(!old||!next){msg('구버전과 신버전 파일을 모두 선택하세요.');return;}if([old,next].some(f=>f.size>160*1024*1024)){msg('각 파일은 160MB 이하로 선택하세요.');return;}lock(true);try{const j=await api('import',{method:'POST',headers:{'Content-Type':'application/json','X-QA-Import':'1'},body:JSON.stringify({old:old.name,new:next.name})});jobId=j.id;$('#dc-progress').hidden=false;await upload('old',old);await upload('new',next);await api(`import/${jobId}/commit`,{method:'POST',headers:{'X-QA-Import':'1'}});$('#dc-progress').hidden=true;await refresh(false);}catch(e){lock(false);$('#dc-progress').hidden=true;$('#dc-cancel').hidden=!jobId;msg(e.message);}};
 $('#dc-cancel').onclick=async()=>{try{await api(`import/${jobId}`,{method:'DELETE',headers:{'X-QA-Import':'1'}});await refresh(false);msg('미완료 업로드를 취소했습니다.');}catch(e){msg(e.message);}};
 $('#dc-refresh').onclick=()=>{if(!busy)refresh();};$('#dc-search').oninput=$('#dc-group').onchange=()=>{page=0;renderList(true);};$('#dc-prev').onclick=()=>{page--;renderList(true);};$('#dc-next').onclick=()=>{page++;renderList(true);};
 $('#dc-summary-search').oninput=()=>{summaryPage=0;renderSummary();};$('#dc-summary-prev').onclick=()=>{summaryPage--;renderSummary();};$('#dc-summary-next').onclick=()=>{summaryPage++;renderSummary();};
 $('#dc-export').onclick=()=>download('drop-change-summary.txt',[`드랍 변경 비교 (${result.createdAt})`,`구: ${result.sources.old[0].name} / 신: ${result.sources.new[0].name}`,`기준 등록: ${result.referenceRegisteredAt}`,...result.sources.references.map(x=>`${x.role}: ${x.name} (${x.sha256})`),'',...result.groups.map(g=>g.text+'\n\n────────────────────────\n'),'',`변경 카테고리 ${result.groups.length}개 · 변경 몬스터 ${result.count.changed}종`,'',...result.assumptions].join('\n'));
 refresh();
}
