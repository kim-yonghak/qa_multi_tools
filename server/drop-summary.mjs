const GRADES={2:'일반',3:'고급',4:'희귀',5:'영웅',6:'전설',7:'신화'};
const text=v=>String(v??'').trim();
const known=v=>!['','없음','0','미등록','미지정'].includes(text(v));
// Summaries aggregate monster/item sets only. Names, values and paths stay in monster details.
export function groupSummaries(monsters){
 const groups=new Map();
 for(const entry of monsters){
  const m=entry.monster,key=JSON.stringify([m.uniqueNumber||`ID ${m.id}`,m.map||'',m.area||'',m.npcType||'']);
  if(!groups.has(key))groups.set(key,{key,uniqueNumber:m.uniqueNumber||'미등록',map:m.map||'',area:m.area||'',npcType:m.npcType||'미등록',ids:[],members:[],levels:[],gradeCodes:new Set(),buckets:new Map(),versions:[],sources:[]});
  const g=groups.get(key);g.ids.push(m.id);g.members.push({id:m.id,name:m.name,level:m.displayLevel||m.level||'미등록'});g.levels.push(m.displayLevel||m.level||'미등록');
  if(m.classificationSource){g.versions.push(m.classificationSource.version);g.sources.push({id:m.id,...m.classificationSource});}
  const add=(kind,c)=>{if(!g.buckets.has(kind))g.buckets.set(kind,new Map());const bucket=g.buckets.get(kind);if(!bucket.has(m.id))bucket.set(m.id,new Set());bucket.get(m.id).add(c.itemId);};
  for(const c of entry.changes){
   g.gradeCodes.add(GRADES[c.grade]||null);
   if(['increase','decrease','added','removed','error'].includes(c.direction))add(c.direction,c);
   if(c.quantityChanged)add(c.quantityDirection==='increase'?'quantityUp':c.quantityDirection==='decrease'?'quantityDown':'quantityMixed',c);
   if(c.direction==='other'&&!c.quantityChanged)add('structure',c);
  }
 }
 return [...groups.values()].map(g=>{
  g.levels=[...new Set(g.levels)].sort((a,b)=>Number(a)-Number(b));g.versions=[...new Set(g.versions)].sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
  g.title=known(g.map)?g.map.replace(/^SPECIAL_/,''):known(g.area)?g.area:'지역 정보 미등록';g.areaLabel=known(g.area)?g.area:'미지정';
  g.levelLabel=g.levels.length>6&&g.levels.every(x=>Number.isFinite(Number(x)))?`${g.levels[0]}–${g.levels.at(-1)} (${g.levels.length}개 레벨)`:g.levels.join(', ');
  g.uniformGrade=g.gradeCodes.size===1?[...g.gradeCodes][0]:null;
  const grade=g.uniformGrade?`${g.uniformGrade} 등급 `:'';
  g.description=`${g.title}${known(g.area)&&g.area!==g.map?' / '+g.area:''}의 ${g.npcType} ${g.ids.length}종입니다. 표시 레벨은 ${g.levelLabel}입니다.`;
  g.rollups=[];
  for(const [kind,verb] of [['increase','드랍 확률이 상승했습니다'],['decrease','드랍 확률이 하락했습니다'],['added','드랍 목록에 추가되었습니다'],['removed','드랍 목록에서 제거되었습니다'],['quantityUp','지급 수량이 증가했습니다'],['quantityDown','지급 수량이 감소했습니다'],['quantityMixed','지급 수량이 변경되었습니다'],['structure','추첨 구성이 변경되었습니다'],['error','확률을 계산할 수 없어 상세 확인이 필요합니다']]){
   const bucket=g.buckets.get(kind);if(!bucket)continue;
   const items=new Set([...bucket.values()].flatMap(s=>[...s])),counts=[...bucket.values()].map(s=>s.size),min=Math.min(...counts),max=Math.max(...counts);
   const scope=bucket.size===g.ids.length?`해당 몬스터 ${g.ids.length}종 모두에서`:`해당 몬스터 ${g.ids.length}종 중 ${bucket.size}종에서`;
   const per=min===max?`${min}종`:`${min}–${max}종`;
   const subject=['added','removed'].includes(kind)?'아이템이':'아이템의';
   const sentence=kind==='error'?`${scope} 일부 아이템의 ${verb}.`:`${scope} ${grade}${subject} ${verb}.`;
   g.rollups.push({kind,monsterCount:bucket.size,itemCount:items.size,perMonsterMin:min,perMonsterMax:max,sentence,countText:`변경 아이템: 몬스터별 ${per} · 카테고리 전체 ${items.size}종 (중복 제외)`});
  }
  g.highlights=g.rollups.length?g.rollups.map(r=>r.sentence):['드랍 테이블 또는 연결 정보가 변경되었습니다. 몬스터를 선택해 상세 진단을 확인하세요.'];
  g.countNote='아이템 종류 수는 ID 기준입니다. 같은 카테고리여도 몬스터마다 변경된 아이템은 다를 수 있으며, 상승·하락이 모두 있는 아이템은 각 방향에 포함됩니다.';
  g.text=[`${g.title} | ${g.npcType}`,g.description,`배치 맵: ${g.map||'미등록'}`,`배치 사냥터: ${g.areaLabel}`,`고유번호: ${g.uniqueNumber}`,'','변경 요약',...(g.rollups.length?g.rollups.flatMap(r=>['• '+r.sentence,'  '+r.countText]):g.highlights), '',g.countNote,'',`분류 기준: (Temp)NPC_Info · ID별 가장 큰 v숫자${g.versions.length?' · 적용 '+g.versions.join(', '):''}`].join('\n');
  delete g.gradeCodes;delete g.buckets;return g;
 });
}
