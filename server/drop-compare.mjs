import {groupSummaries} from './drop-summary.mjs';
import {makeDropIndex} from './drop-engine.mjs';
export const GRADES={2:'일반',3:'고급',4:'희귀',5:'영웅',6:'전설',7:'신화'};
const canonical=p=>{
 const draws=new Map();
 for(const x of p){if(x.numerator===0)continue;const key=x.draw;if(!draws.has(key))draws.set(key,new Map());const bucket=draws.get(key),q=JSON.stringify([x.min,x.max,x.issue||'']);bucket.set(q,(bucket.get(q)||0)+(x.numerator??-1));}
 return JSON.stringify([...draws.values()].map(m=>[...m].sort((a,b)=>a[0].localeCompare(b[0]))).map(x=>JSON.stringify(x)).sort());
};
const amount=p=>JSON.stringify([...new Set(p.filter(x=>x.numerator!==0).map(x=>`${x.min}~${x.max}`))].sort());
export function compareDrops(oldDrop,newDrop,references){
 const make=d=>makeDropIndex({...references,tables:{...references.tables,...d.tables}}),a=make(oldDrop),b=make(newDrop);
 const ids=[...new Set([...a.search('',0,100000).rows,...b.search('',0,100000).rows].map(x=>x.id))];
 const changed=[],details={},count={checked:ids.length,changed:0,addedMonsters:0,removedMonsters:0,items:0,errors:0};
 const oldIds=new Set(oldDrop.tables.infos.map(x=>x.id)),newIds=new Set(newDrop.tables.infos.map(x=>x.id));
 for(const id of ids){
  const before=a.detail(id),after=b.detail(id),monster=after?.monster||before?.monster;
  const oldExists=oldIds.has(monster.dropId),newExists=newIds.has(monster.dropId);
  if(!oldExists&&!newExists)continue;
  const oldPaths=before?.paths||[],newPaths=after?.paths||[];
  const oldInvalid=oldExists&&(oldPaths.some(p=>p.numerator===null)||oldDrop.tables.infos.find(x=>x.id===monster.dropId)?.conflict),newInvalid=newExists&&(newPaths.some(p=>p.numerator===null)||newDrop.tables.infos.find(x=>x.id===monster.dropId)?.conflict);
  const byItem=p=>{const m=new Map();for(const x of p){if(x.kind==='미지급'||!x.itemId)continue;if(!m.has(x.itemId))m.set(x.itemId,[]);m.get(x.itemId).push(x);}return m;},op=byItem(oldPaths),np=byItem(newPaths);
  const os=new Map((before?.summary||[]).map(x=>[x.itemId,x])),ns=new Map((after?.summary||[]).map(x=>[x.itemId,x]));const changes=[];
  for(const itemId of new Set([...op.keys(),...np.keys()])){
   const x=op.get(itemId)||[],y=np.get(itemId)||[];
   if(canonical(x)===canonical(y))continue;
   const prev=os.get(itemId),next=ns.get(itemId),label=b.itemLabel(itemId),oldChance=oldInvalid?null:prev?prev.chance:0,newChance=newInvalid?null:next?next.chance:0;
   let direction=oldChance===null||newChance===null?'error':!x.some(p=>p.numerator!==0)?'added':!y.some(p=>p.numerator!==0)?'removed':newChance>oldChance+1e-15?'increase':newChance<oldChance-1e-15?'decrease':'other';
   changes.push({itemId,name:label.name,grade:label.grade,gradeName:GRADES[label.grade]||'미등록',oldChance,newChance,direction,quantityChanged:!oldInvalid&&!newInvalid&&x.some(p=>p.numerator>0)&&y.some(p=>p.numerator>0)&&amount(x)!==amount(y),quantityDirection:x.length===1&&y.length===1?(y[0].min<=x[0].min&&y[0].max<=x[0].max?'decrease':y[0].min>=x[0].min&&y[0].max>=x[0].max?'increase':'mixed'):'mixed',oldQuantity:amount(x),newQuantity:amount(y),oldExpected:oldInvalid?null:prev?.expectedSelections??(prev?null:0),newExpected:newInvalid?null:next?.expectedSelections??(next?null:0),before:x,after:y});
  }
  const issues=p=>p.filter(x=>x.numerator===null).map(x=>`${x.groupId}:${x.dropItemId}:${x.issue}`).sort();
  const unresolved=oldExists&&newExists&&(JSON.stringify(issues(oldPaths))!==JSON.stringify(issues(newPaths))||(!changes.length&&JSON.stringify(before?.warnings)!==JSON.stringify(after?.warnings)));
  const status=!oldExists?'추가':!newExists?'제거':'변경';
  if(!changes.length&&!unresolved&&status==='변경')continue;
  const metrics={increase:0,decrease:0,added:0,removed:0,other:0,error:0};for(const c of changes)metrics[c.direction]++;
  const warnings=[...(before?.warnings||[]).map(x=>'구버전: '+x),...(after?.warnings||[]).map(x=>'신버전: '+x)];
  const entry={monster,status,metrics,itemChanges:changes.length,changes:changes.map(({before,after,...x})=>x),warnings};
  changed.push(entry);details[id]={...entry,changes};count.items+=changes.length;if(status==='추가')count.addedMonsters++;if(status==='제거')count.removedMonsters++;if(metrics.error||unresolved)count.errors++;
 }
 count.changed=changed.length;
 return {format:1,createdAt:new Date().toISOString(),sources:{old:oldDrop.sources,new:newDrop.sources,references:references.sources.filter(x=>x.role!=='drop')},referenceRegisteredAt:references.registeredAt,metadataAvailable:!!references.referenceMetadataVersion,count,groups:groupSummaries(changed),monsters:changed.map(({changes,...x})=>x),details,assumptions:['같은 그룹 슬롯 내부는 배타 선택, 서로 다른 슬롯은 독립 추첨으로 계산합니다.','아이템별 1회 이상 획득 확률, 수량 범위와 추첨 구성을 비교합니다. 행 순서·버전·그룹 ID만 달라지고 계산 결과가 같으면 제외합니다.','증감 건수는 몬스터–아이템 조합 수입니다. 추가·제거는 별도로 집계하며 혼합된 증감을 하나의 방향으로 단정하지 않습니다.','일반 드랍만 비교합니다. 이벤트·기간 드랍은 포함하지 않습니다.']};
}
