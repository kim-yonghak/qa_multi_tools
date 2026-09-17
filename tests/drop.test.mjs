import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizeBooks,selectLatest,numericVersion} from '../server/drop-normalize.mjs';
import {makeDropIndex,percent} from '../server/drop-engine.mjs';
const source={sheet:'test',row:5,version:'v1'};
const r=(id,props={})=>({id:String(id),v:1,source,...props});
function fixture(){return {format:1,tables:{
 infos:[r(10,{groups:[{slot:1,id:'20',rate:500000}],direct:[]})],
 groups:[r(20,{entries:[{slot:1,id:'30',rate:1000000}]})],drops:[r(30,{itemId:'40',min:1,max:1})],
 npcs:[r(1,{abilityId:'2',level:10})],abilities:[r(2,{dropId:'10',level:10,name:'',eventId:'0'})],
 abilityNames:[r(2,{name:'검증 몬스터',map:'시험 지역'})],npcNames:[],
 items:[r(40,{baseId:'50',memo:'기획 메모'})],bases:[r(50,{stringId:'60'})],strings:[r(60,{nameId:'70',titleId:'0'})],names:[r(70,{name:'검증 아이템'})]
 }};}
const get=d=>makeDropIndex(d).detail('1');
test('latest version uses numeric v10 over v9, ignoring row order',()=>{
 assert.equal(numericVersion('v99'),99);assert.equal(numericVersion('//'),null);
 const diag=[],result=selectLatest([r(1,{v:10,name:'new'}),r(1,{v:9,name:'old'})],'x',diag);assert.equal(result[0].name,'new');
});
test('same latest version conflict is explicit; newer row resolves old conflicts',()=>{
 const diag=[];assert.equal(selectLatest([r(1,{name:'A'}),r(1,{name:'B'})],'x',diag)[0].conflict,true);assert.equal(diag.length,1);
 const selected=selectLatest([r(1,{name:'A'}),r(1,{name:'B'}),r(1,{v:2,name:'C'})],'x',[])[0];assert.equal(selected.name,'C');assert.ok(!selected.conflict);
});
test('identical values in two physical rows are not conflicting',()=>{
 const rows=selectLatest([r(1,{name:'A'}),r(1,{name:'A',source:{...source,row:6}})],'x',[]);assert.equal(rows.length,1);assert.ok(!rows[0].conflict);
});
test('NPC ability Drop_ID and full item -> base -> string -> Korean joins',()=>{
 const result=get(fixture());assert.equal(result.monster.dropId,'10');assert.equal(result.monster.name,'검증 몬스터');assert.equal(result.paths[0].name,'검증 아이템');assert.equal(result.paths[0].percent,'50%');
});
test('exact tiny probability is not rounded to zero',()=>{
 const d=fixture();d.tables.infos[0].groups[0].rate=1;d.tables.groups[0].entries=[{slot:1,id:'30',rate:1},{slot:2,id:'0',rate:999999}];assert.equal(get(d).paths[0].percent,'0.0000000001%');assert.equal(percent(720000000),'0.072%');
});
test('same group appearing twice is two distinct draws',()=>{
 const d=fixture();d.tables.infos[0].groups.push({slot:2,id:'20',rate:500000});const result=get(d);assert.equal(result.paths.length,2);assert.equal(result.summary[0].chance,0.75);assert.equal(result.summary[0].expectedSelections,1);
});
test('duplicate item outcomes within ONE draw sum before independent probability',()=>{
 const d=fixture();d.tables.groups[0].entries=[{slot:1,id:'30',rate:500000},{slot:2,id:'30',rate:500000}];const s=get(d).summary[0];assert.equal(s.chance,0.5);assert.equal(s.expectedSelections,0.5);
});
test('direct item grant and group path preserve distinct quantity and trials',()=>{
 const d=fixture();d.tables.infos[0].direct=[{slot:1,id:'40',rate:1000000,min:5,max:10}];const result=get(d);assert.equal(result.paths[0].min,5);assert.equal(result.paths[0].percent,'100%');assert.equal(result.summary[0].chance,1);assert.equal(result.summary[0].expectedSelections,1.5);
});
test('missing names display item ID without substituting a planning memo',()=>{
 const d=fixture();d.tables.names=[];const p=get(d).paths[0];assert.equal(p.name,'40');assert.equal(p.nameFound,false);assert.equal(p.percent,'50%');
});
test('missing group/drop and invalid sum remain errors, not 0% results',()=>{
 for(const kind of ['groups','drops']){const d=fixture();d.tables[kind]=[];const p=get(d).paths[0];assert.equal(p.numerator,null);assert.ok(p.issue);assert.equal(p.percent,'계산 불가');}
 const d=fixture();d.tables.groups[0].entries[0].rate=900000;assert.equal(get(d).paths[0].numerator,null);
});
test('zero Drop_ID means no normal drop; direct ID lookup remains separate',()=>{
 const d=fixture();d.tables.abilities[0].dropId='0';const idx=makeDropIndex(d);assert.equal(idx.detail('1').paths.length,0);assert.equal(idx.detail('10',{direct:true}).paths.length,1);
});
test('exact ID and same-name NPCs remain separate searchable candidates',()=>{
 const d=fixture();d.tables.npcs.push(r(11,{abilityId:'2'}));const idx=makeDropIndex(d);assert.equal(idx.search('검증몬스터').total,3);assert.equal(idx.search('11').rows[0].id,'11');assert.equal(idx.search('<script>').total,0);
});
test('latest conflicting records are never used to calculate a drop chance',()=>{
 const d=fixture();d.tables.groups[0].conflict=true;assert.equal(get(d).paths[0].numerator,null);
});
test('explicit no-item outcome is preserved and not counted in item summary',()=>{
 const d=fixture();d.tables.groups[0].entries=[{slot:1,id:'30',rate:100000},{slot:2,id:'0',rate:900000}];const out=get(d);assert.equal(out.paths[1].kind,'미지급');assert.equal(out.summary.length,1);assert.equal(out.paths[0].percent,'5%');
});
function grid(cols,values){return [cols.map(()=>null),cols,cols.map(()=>null),cols,...values];}
function books(){return {
 drop:{Drop_Info:grid(['VERSION','ID','GroupRate_1000000_1','Drop_Group_Id_1'],[['v9',10,1259.9999999999998,20],['v10',10,2000,20]]),Drop_Group:grid(['VERSION','ID','DropItemRate_1000000_1','Drop_Item_Id_1'],[['v1',20,1e6,30]]),Drop_Item:grid(['VERSION','ID','Item_Info_Id','MinAmount','MaxAmount'],[['v1',30,40,1,1]])},
 npc:{NPC_Info:grid(['VERSION','ID','NPC_Abil_ID'],[['v1',1,2]]),NPC_Abil:grid(['VERSION','ID','Drop_ID'],[['v1',2,10]])},
 item:{Item_Info:grid(['VERSION','ID','Item_Base_ID'],[['v1',40,50]]),Item_Base:grid(['VERSION','ID','Item_String_ID'],[['v1',50,60]]),Item_String:grid(['VERSION','ID','String_Item_Name'],[['v1',60,70]])},
 string:{String_itemName:grid(['VERSION','ID','KOR'],[['v1',70,'이름']])}
};}
test('real schema header detection, latest normalization, and source row tracking',()=>{
 const b=books();const d=normalizeBooks(b);assert.equal(d.tables.infos[0].v,10);assert.equal(d.tables.infos[0].source.row,6);assert.equal(get(d).paths[0].percent,'0.2%');
});
test('only machine-level integer residue is restored; genuine fractional values fail',()=>{
 const b=books();b.drop.Drop_Info.pop();assert.equal(normalizeBooks(b).tables.infos[0].groups[0].rate,1260);
 b.drop.Drop_Info[4][2]=1259.5;assert.equal(normalizeBooks(b).tables.infos[0].groups[0].rate,null);
});
test('commented-out VERSION rows are excluded and not resurrected as latest',()=>{
 const b=books();b.drop.Drop_Info.push(['//',10,999999,20]);const d=normalizeBooks(b);assert.equal(d.tables.infos[0].v,10);assert.equal(d.stats.excludedVersionRows,1);
});
