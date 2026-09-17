// Read-only extraction of the supplied game's spreadsheet schema.
const clean = v => v == null ? '' : String(v).trim();
export function numericVersion(value) {
 const match=/^v(\d+)$/i.exec(clean(value));
 return match ? Number(match[1]) : null;
}
function identifier(value) {
 if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?String(value):null;
 const s=clean(value);return /^\d+$/.test(s)?s.replace(/^0+(?=\d)/,''):null;
}
function integer(value){if(value===null||value===undefined||value==='')return null;const n=Number(value),rounded=Math.round(n);return Number.isSafeInteger(rounded)&&Math.abs(n-rounded)<=Number.EPSILON*Math.max(1,Math.abs(n))*8?rounded:null;}
export function selectLatest(rows, label, diagnostics) {
 const map=new Map();
 for(const row of rows){
  const prev=map.get(row.id);
  if(!prev||row.v>prev.v){map.set(row.id,row);continue;}
  if(row.v<prev.v)continue;
  const values=x=>{const {source,conflict,...rest}=x;return JSON.stringify(rest);};
  if(values(prev)!==values(row)){
   map.set(row.id,{...prev,conflict:true});
  }
 }
 const selected=[...map.values()];
 for(const row of selected)if(row.conflict)diagnostics.push(`${label}: ID ${row.id}, v${row.v}에 서로 다른 값이 있어 계산에서 제외합니다.`);
 return selected;
}
function table(workbook, name, required) {
 const rows=workbook[name];if(!rows)throw new Error(`${name} 시트를 찾을 수 없습니다.`);
 const hi=rows.slice(0,15).findIndex(row=>required.every(k=>row.some(v=>clean(v).toLowerCase()===k.toLowerCase())));
 if(hi<0)throw new Error(`${name}: 필수 열(${required.join(', ')})을 찾지 못했습니다.`);
 const headers=rows[hi].map(clean), lookup=new Map(headers.map((h,i)=>[h.toLowerCase(),i]));
 const col=k=>lookup.get(k.toLowerCase());
 const human=label=>{for(let i=hi-1;i>=0;i--){const c=rows[i].findIndex(v=>clean(v)===label);if(c>=0)return c;}return undefined;};
 return {name,headers,col,human,rows:rows.slice(hi+1).map((row,i)=>({raw:row,row:i+hi+2})),headerRow:hi+1};
}
export function normalizeBooks(books, sources=[], registeredAt=new Date().toISOString(), dropOnly=false) {
 const diagnostics=[],stats={excludedVersionRows:0,invalidIdRows:0};
 const output={format:1,registeredAt,sources,diagnostics,stats,tables:{},sheets:{}};
 function extract(kind,bookKey,name,required,convert){
  const t=table(books[bookKey],name,required);output.sheets[kind]=name;const records=[];
  for(const entry of t.rows){
   const {raw,row}=entry,id=identifier(raw[t.col('ID')]);
   if(id===null){if(raw.some(v=>v!=null&&v!==''))stats.invalidIdRows++;continue;}
   const vc=t.col('VERSION'),v=vc===undefined?0:numericVersion(raw[vc]);
   if(v===null){stats.excludedVersionRows++;continue;}
   const get=k=>raw[t.col(k)],hget=k=>raw[t.human(k)];
   records.push({id,v,source:{sheet:name,row,version:vc===undefined?'없음':`v${v}`},...convert(get,hget,t,raw)});
  }
  output.tables[kind]=selectLatest(records,name,diagnostics);
  if(!output.tables[kind].length&&['infos','groups','drops','abilities','names'].includes(kind))throw new Error(`${name}: 읽을 수 있는 데이터 행이 없습니다.`);
 }
 const slots=(t,pattern)=>t.headers.flatMap((h,i)=>{const m=pattern.exec(h);return m?[{slot:Number(m[1]),index:i}]:[];});
 extract('infos','drop','Drop_Info',['ID','GroupRate_1000000_1'],(get,h,t,raw)=>({
  groups:slots(t,/^Drop_Group_Id_(\d+)$/i).map(({slot,index})=>({slot,id:identifier(raw[index]),rate:integer(get(`GroupRate_1000000_${slot}`))})).filter(x=>x.id!=='0'||(x.rate!==0&&x.rate!==null)),
  direct:slots(t,/^Item_Info_Id_(\d+)$/i).map(({slot,index})=>({slot,id:identifier(raw[index]),rate:integer(get(`GetItem_Rate_1000000_${slot}`)),min:integer(get(`ItemAmountMin_${slot}`)),max:integer(get(`ItemAmountMax_${slot}`))})).filter(x=>x.id!=='0'||(x.rate!==0&&x.rate!==null)),
  isApply:get('IsApply')??null
 }));
 extract('groups','drop','Drop_Group',['ID','DropItemRate_1000000_1'],(get,h,t,raw)=>({
  entries:slots(t,/^Drop_Item_Id_(\d+)$/i).map(({slot,index})=>({slot,id:identifier(raw[index]),rate:integer(get(`DropItemRate_1000000_${slot}`))})).filter(x=>x.id!=='0'||(x.rate!==0&&x.rate!==null))
 }));
 extract('drops','drop','Drop_Item',['ID','Item_Info_Id','MinAmount','MaxAmount'],get=>({itemId:identifier(get('Item_Info_Id')),min:integer(get('MinAmount')),max:integer(get('MaxAmount'))}));
 if(dropOnly){stats.counts=Object.fromEntries(Object.entries(output.tables).map(([k,v])=>[k,v.length]));return output;}
 output.referenceMetadataVersion=1;
 extract('npcs','npc','NPC_Info',['ID','NPC_Abil_ID'],get=>({abilityId:identifier(get('NPC_Abil_ID')),level:integer(get('NPC_Level')),nameId:identifier(get('String_NPCName'))}));
 extract('abilities','npc','NPC_Abil',['ID','Drop_ID'],(get,h)=>({dropId:identifier(get('Drop_ID')),level:integer(get('Lv')),name:clean(h('이름')),map:clean(h('맵')),eventId:identifier(get('Drop_Event_ID')),eventTimeId:identifier(get('NPC_Drop_EventTime_ID'))}));
 const abilityNames=Object.keys(books.npc).find(n=>n==='(Temp)NPC_Abil');
 if(abilityNames)extract('abilityNames','npc',abilityNames,['ID','Drop_ID'],(get,h)=>({name:clean(h('이름')),map:clean(h('맵'))}));
 if(books.npc['(Temp)NPC_Info'])extract('npcNames','npc','(Temp)NPC_Info',['ID','NPC_Abil_ID'],(get,h)=>({name:clean(h('NPC 실제 이름')),map:clean(h('배치 맵')),area:clean(h('배치 사냥터')),title:clean(h('칭호')),uniqueNumber:clean(h('고유번호')),npcType:clean(h('NPC 구분')),displayLevel:clean(h('NPC 레벨 표기용'))}));
 extract('items','item','Item_Info',['ID','Item_Base_ID'],get=>({baseId:identifier(get('Item_Base_ID')),enchant:integer(get('Current_Enchant')),memo:clean(get('!comment'))}));
 extract('bases','item','Item_Base',['ID','Item_String_ID'],get=>({stringId:identifier(get('Item_String_ID')),grade:integer(get('T_GradeType')),memo:clean(get('!comment'))}));
 extract('strings','item','Item_String',['ID','String_Item_Name'],get=>({nameId:identifier(get('String_Item_Name')),titleId:identifier(get('String_Item_Name_Title'))}));
 const nameSheet=Object.keys(books.string).find(n=>n.toLowerCase()==='string_itemname');
 if(!nameSheet)throw new Error('String_itemName 시트를 찾을 수 없습니다.');
 extract('names','string',nameSheet,['ID','KOR'],get=>({name:clean(get('KOR'))}));
 stats.counts=Object.fromEntries(Object.entries(output.tables).map(([key,rs])=>[key,rs.length]));
 diagnostics.push('정수 확률 열의 Excel 계산 잔차(예: 1259.9999999999998)는 부동소수점 오차 범위 안에서만 정수로 복원합니다.');
 diagnostics.unshift('같은 ID는 v 뒤 숫자가 가장 큰 행을 사용합니다. // 및 숫자 버전이 아닌 행은 제외합니다. 분기(&)·Temp 드랍 시트는 병합하지 않습니다.');
 return output;
}
