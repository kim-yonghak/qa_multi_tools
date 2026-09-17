const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
export function summaryCard(group,index,onGroup,onMonster){
 const g=group,card=el('details',null,'dc-summary-card');
 const header=el('summary',null,'dc-card-head'),titles=el('div');titles.append(el('span',`변경 그룹 ${String(index+1).padStart(2,'0')}`,'dc-kicker'),el('h3',g.title));
 const badges=el('div',null,'dc-badges');for(const s of [g.npcType,`표시 Lv.${g.levelLabel}`,`몬스터 ${g.ids.length}종`])badges.append(el('span',s));titles.append(badges);
 const open=el('button','이 그룹 몬스터 보기 →','quiet');open.type='button';open.onclick=onGroup;header.append(titles);card.append(header);const actions=el('div',null,'dc-group-actions');actions.append(open);card.append(actions);
 const facts=el('dl',null,'dc-facts');for(const [label,value] of [['배치 맵',g.map||'미등록'],['배치 사냥터',g.areaLabel],['NPC 구분',g.npcType],['고유번호',g.uniqueNumber]]){const block=el('div');block.append(el('dt',label),el('dd',value));facts.append(block);}card.append(facts);
 const overview=el('div',null,'dc-overview');overview.append(el('h4','몬스터 기준 변경 요약'),el('p',g.description,'dc-category-description'));
 const list=el('ul',null,'dc-category-lines');
 if(g.rollups.length){for(const r of g.rollups){const tone={increase:'increase',decrease:'decrease',added:'increase',removed:'decrease',quantityUp:'increase',quantityDown:'decrease'}[r.kind]||'other';const li=el('li',null,'dc-'+tone);li.append(el('p',r.sentence),el('small',r.countText));list.append(li);}}
 else for(const line of g.highlights)list.append(el('li',line));
 overview.append(list,el('p',g.countNote,'dc-count-note'));card.append(overview);
 const members=el('details',null,'dc-members');members.append(el('summary',`대상 몬스터 ${g.members.length}종 · 이름과 ID 확인`));const memberList=el('div',null,'dc-member-list');for(const m of g.members){const b=el('button',null,'dc-member-link');b.type='button';b.append(el('strong',m.name),el('small',`ID ${m.id} · 표시 Lv.${m.level}`));b.onclick=()=>onMonster(m.id);memberList.append(b);}members.append(memberList);card.append(members);
 const basis=el('details',null,'dc-basis');basis.append(el('summary',`분류 근거 · (Temp)NPC_Info${g.versions.length?' · '+g.versions.join(', '):''}`),el('p','동일 ID는 v 뒤 숫자가 가장 큰 행을 사용합니다. 고유번호·배치 맵·배치 사냥터·NPC 구분이 모두 같은 몬스터끼리 묶었습니다.'));
 if(!g.sources.length)basis.append(el('p','이전 결과에는 분류 원본 행 정보가 없습니다. 최신 기준 파일로 다시 비교하면 확인할 수 있습니다.'));
 for(const s of g.sources)basis.append(el('p',`ID ${s.id} → ${s.sheet} ${s.row}행 · ${s.version}`));card.append(basis);return card;
}
