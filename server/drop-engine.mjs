export const RATE_BASE=1_000_000;
const positive=id=>id&&id!=='0';
const validRate=n=>Number.isSafeInteger(n)&&n>=0&&n<=RATE_BASE;
const norm=s=>String(s??'').normalize('NFC').replace(/\s+/g,'').toLowerCase();
const src=s=>s?`${s.sheet}!${s.row} (${s.version})`:'';
const available=row=>row&&!row.conflict;
export function percent(numerator,denominator=1e12){
 if(numerator===null||numerator===undefined)return '계산 불가';
 // Integer numerator <= 10^12: exact decimal percent without floating-point multiplication.
 let scaled=BigInt(numerator)*100n,den=BigInt(denominator),whole=scaled/den,rem=scaled%den,dec='';
 for(let i=0;rem&&i<12;i++){rem*=10n;dec+=rem/den;rem%=den;}
 return String(whole)+(dec?'.'+dec:'')+'%';
}
export function makeDropIndex(dataset){
 if(dataset?.format!==1||!dataset.tables)throw new Error('저장 데이터 형식을 확인하세요.');
 const t=Object.fromEntries(Object.entries(dataset.tables).map(([key,rows])=>[key,new Map(rows.map(r=>[r.id,r]))]));
 const get=(key,id)=>t[key]?.get(id);
 const monsters=[],used=new Set();
 function monster(id,npc,ability){
  const nameRow=get('abilityNames',ability?.id||id),rawClassification=get('npcNames',id),fallback=available(rawClassification)?rawClassification:null;
  const name=(available(ability)&&ability.name)||(available(nameRow)&&nameRow.name)||(available(fallback)&&fallback.name)||id;
  const source=(available(ability)&&ability.name&&ability.source)||(available(nameRow)&&nameRow.name&&nameRow.source)||fallback?.source;
  return {id,name,abilityId:ability?.id||npc?.abilityId||id,dropId:available(ability)?ability.dropId:null,
   level:ability?.level??npc?.level??null,map:fallback?.map||(available(nameRow)&&nameRow.map)||'',area:fallback?.area||'',title:fallback?.title||'',uniqueNumber:fallback?.uniqueNumber||'',npcType:fallback?.npcType||'',displayLevel:fallback?.displayLevel||'',classificationSource:fallback?.source||null,classificationConflict:!!rawClassification?.conflict,
   source:npc?.source||ability?.source,nameSource:source,abilitySource:ability?.source,conflict:!!(npc?.conflict||ability?.conflict),kind:'npc',
   eventId:ability?.eventId,eventTimeId:ability?.eventTimeId};
 }
 for(const npc of t.npcs?.values()||[]){const a=get('abilities',npc.abilityId);monsters.push(monster(npc.id,npc,a));used.add(npc.id);}
 for(const a of t.abilities?.values()||[])if(!used.has(a.id)){monsters.push(monster(a.id,null,a));used.add(a.id);}
 // Raw Drop_Info IDs stay searchable even if NPC has not yet been provided for them.
 for(const info of t.infos.values())if(!used.has(info.id))monsters.push({id:info.id,name:`드랍 테이블 ${info.id}`,dropId:info.id,kind:'table',source:info.source});
 for(const m of monsters)m.search=norm(m.id+' '+m.name+' '+m.title+' '+m.map+' '+m.area);
 const byId=new Map(monsters.map(m=>[m.id,m]));
 function search(query='',offset=0,limit=50){
  const q=norm(query),matches=monsters.filter(m=>!q||m.search.includes(q));
  matches.sort((a,b)=>(Number(a.kind==='table')-Number(b.kind==='table'))||(Number(b.id===q)-Number(a.id===q))||(Number(positive(b.dropId))-Number(positive(a.dropId)))||a.id.localeCompare(b.id,undefined,{numeric:true}));
  return {total:matches.length,offset,rows:matches.slice(offset,offset+limit).map(({search,...m})=>m)};
 }
 function itemLabel(id){
  const item=get('items',id),baseId=available(item)?item.baseId:id,base=get('bases',baseId),string=get('strings',available(base)?base.stringId:baseId);
  // Exact name ID lookup is a fallback for direct string-index datasets.
  const nameId=available(string)?string.nameId:baseId;
  const name=get('names',nameId),title=available(string)&&positive(string.titleId)?get('names',string.titleId):null;
  const broken=[item,base,string,name,title].some(r=>r?.conflict);
  const found=!broken&&available(name)&&name.name&&(!positive(string?.titleId)||(available(title)&&title.name));
  return {itemId:id||'',name:found?[title?.name,name.name].filter(Boolean).join(' '):(id||'ID 없음'),nameFound:!!found,
   grade:available(base)?base.grade??null:null,memo:item?.memo||base?.memo||'',baseId:baseId||'',nameId:nameId||'',enchant:item?.enchant??null,
   nameSource:found?name.source:null,nameTrace:[item,base,string,title,name].filter(Boolean).map(r=>src(r.source)).join(' → ')};
 }
 function detail(id,{direct=false}={}){
  let m=byId.get(String(id));
  if(direct){const i=get('infos',String(id));if(i)m={id:String(id),name:`드랍 테이블 ${id}`,dropId:String(id),kind:'table',source:i.source};}
  if(!m)return null;
  const {search,...monster}=m,paths=[],warnings=[];
  if(m.conflict){warnings.push('NPC 또는 능력치 ID의 최신 버전에 중복 충돌이 있습니다. 해당 연결을 계산하지 않습니다.');return {monster,paths,summary:[],warnings};}
  if(!positive(m.dropId)){warnings.push(m.dropId==='0'?'NPC_Abil.Drop_ID가 0이므로 일반 드랍 연결이 없습니다.':'NPC_Abil 연결을 찾을 수 없습니다.');return {monster,paths,summary:[],warnings};}
  const info=get('infos',m.dropId);
  if(!available(info)){warnings.push(info?'Drop_Info 최신 버전이 중복되어 계산할 수 없습니다.':`Drop_Info ID ${m.dropId}를 찾을 수 없습니다.`);return {monster,paths,summary:[],warnings};}
  monster.dropSource=info.source;
  if(positive(m.eventId))warnings.push(`이벤트 드랍 ID ${m.eventId} / 기간 ID ${m.eventTimeId}: 일반 드랍과 분리하여 드랍 ID 직접 조회로 확인하세요.`);
  const add=(path)=>paths.push({...path,percent:percent(path.numerator),groupPercent:validRate(path.groupRate)?percent(path.groupRate,1e6):'계산 불가',itemPercent:validRate(path.itemRate)?percent(path.itemRate,1e6):'계산 불가'});
  for(const e of info.direct){
   const ok=validRate(e.rate)&&positive(e.id)&&Number.isSafeInteger(e.min)&&Number.isSafeInteger(e.max)&&e.min>0&&e.max>=e.min;
   add({...itemLabel(e.id),kind:'직접 지급',draw:'direct:'+e.slot,groupSlot:e.slot,groupId:'',dropItemId:'',itemSlot:'',groupRate:e.rate,itemRate:1e6,
    min:e.min,max:e.max,numerator:ok?e.rate*1e6:null,issue:ok?'':'직접 지급의 확률·ID·수량을 확인하세요.',trace:src(info.source)});
  }
  for(const slot of info.groups){
   const group=get('groups',slot.id);
   const problem=!available(group)?(group?'최신 버전 중복 충돌':'드랍 그룹 없음'):!validRate(slot.rate)?'그룹 확률 범위 오류':'';
   const sum=group?.entries.reduce((s,e)=>s+(Number.isSafeInteger(e.rate)?e.rate:0),0);
   const badGroup=available(group)&&(sum!==1e6||group.entries.some(e=>!validRate(e.rate)));
   if(problem||badGroup)warnings.push(`그룹 ${slot.id} / 슬롯 ${slot.slot}: ${problem||`아이템 확률 합계 ${sum} / 1,000,000`}`);
   if(!available(group)){
    add({kind:'그룹',draw:'group:'+slot.slot,groupSlot:slot.slot,groupId:slot.id||'',dropItemId:'',itemSlot:'',itemId:'',name:'그룹 연결 오류',nameFound:false,min:null,max:null,groupRate:slot.rate,itemRate:null,numerator:null,issue:problem,trace:src(info.source)});continue;
   }
   for(const e of group.entries){
    // A positive-probability zero ID is an explicit no-item outcome, retained for auditing.
    const drop=get('drops',e.id),noItem=e.id==='0';
    const quantityOK=available(drop)&&positive(drop.itemId)&&Number.isSafeInteger(drop.min)&&Number.isSafeInteger(drop.max)&&drop.min>0&&drop.max>=drop.min;
    const issue=problem||(badGroup?'그룹 확률 합계/범위 오류':'')||(!noItem&&!available(drop)?(drop?'Drop_Item 최신 버전 중복 충돌':'Drop_Item 연결 없음'):'')||(!noItem&&!quantityOK?'아이템 ID 또는 지급 수량을 확인하세요.':'');
    add({...itemLabel(drop?.itemId||e.id),name:noItem?'미지급 (ID 0)':itemLabel(drop?.itemId||e.id).name,
     kind:noItem?'미지급':'그룹',draw:'group:'+slot.slot,groupSlot:slot.slot,groupId:slot.id,dropItemId:e.id,itemSlot:e.slot,
     itemId:drop?.itemId||(noItem?'0':e.id),min:drop?.min??null,max:drop?.max??null,groupRate:slot.rate,itemRate:e.rate,numerator:!issue?slot.rate*e.rate:null,issue,
     trace:[info,group,drop].filter(Boolean).map(r=>src(r.source)).join(' → ')});
   }
  }
  const summaries=new Map();
  for(const p of paths){if(p.kind==='미지급'||!p.itemId)continue;
   if(!summaries.has(p.itemId))summaries.set(p.itemId,{...itemLabel(p.itemId),draws:new Map(),paths:0,issues:[]});
   const s=summaries.get(p.itemId);s.paths++;
   if(p.numerator===null)s.issues.push(p.issue);else s.draws.set(p.draw,(s.draws.get(p.draw)||0)+p.numerator/1e12);
  }
  // Same group slot = mutually exclusive choices; different slots = independent draws (explicit assumption).
  const summary=[...summaries.values()].map(({draws,...s})=>{
   const ps=[...draws.values()];
   if(paths.some(p=>p.numerator===null))s.issues.push('일부 드랍 경로를 계산할 수 없어 전체 합산을 보류합니다.');
   const valid=!s.issues.length&&ps.every(p=>p<=1);
   const chance=valid?(ps.length===1?ps[0]:ps.includes(1)?1:-Math.expm1(ps.reduce((sum,p)=>sum+Math.log1p(-p),0))):null;
   return {...s,chance,expectedSelections:valid?ps.reduce((sum,p)=>sum+p,0):null};
  });
  if(paths.some(p=>!p.nameFound&&p.kind!=='미지급'))warnings.push('한글 이름 연결이 없는 항목은 ID를 표시합니다. 기획용 메모는 이름으로 대체하지 않습니다.');
  return {monster,paths,summary,warnings:[...new Set(warnings)]};
 }
 return {search,detail,stats:{monsters:monsters.length,withDrop:monsters.filter(m=>positive(m.dropId)).length},itemLabel};
}
