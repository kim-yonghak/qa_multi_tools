export function quantity(min,max){if(min==null||max==null)return '—';return String(min)===String(max)?String(min):`${min}–${max}`;}
export function quantityList(value){try{return JSON.parse(value).map(s=>{const [a,b]=String(s).split('~');return quantity(a,b??a);}).join(', ')||'없음';}catch{return value||'없음';}}
export function averageKills(expected){
 if(expected==null||!Number.isFinite(expected)||expected<0)return '계산 불가';
 if(expected===0)return '획득 불가';
 const n=1/expected;if(!Number.isFinite(n))return '계산 불가';
 return n<1?'1마리 미만':`${Math.round(n).toLocaleString('ko-KR')}마리`;
}
export const averageHelp='평균 필요 처치 수 = 1 ÷ 처치당 기대 당첨 횟수. 반올림한 평균 환산값이며, 첫 획득까지의 대기 시간이나 획득 보장 횟수가 아닙니다.';
export function dropSource(source){return source?`Drop 엑셀 · ${source.sheet} 시트, ${source.row}행${source.version?' ('+source.version+')':''}`:'';}
export function dropTrace(trace){const parts=String(trace||'').split(' → ').filter(s=>/^Drop_/i.test(s));return parts.length?'Drop 엑셀 · '+parts.map(s=>s.replace(/^([^!]+)!(\d+)/,'$1 시트, $2행')).join(' → '):'—';}
export function groupColor(key){let hash=2166136261;for(const c of String(key))hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;const hue=((hash*137.507764)%360).toFixed(2);return `hsl(${hue} var(--group-saturation,38%) calc(var(--group-lightness,94%) + ${hash%3}%))`;}
export const pathGroupKey=p=>p.kind==='직접 지급'?'direct':`group:${p.groupId||'unknown'}`;
export const monsterGroupKey=m=>m.kind==='table'?`table:${m.dropId}`:JSON.stringify([m.uniqueNumber||m.id,m.map||'',m.area||'',m.npcType||'']);
// Presentation only: retain original data and probability calculations unchanged.
export const decimal4=value=>Number(value).toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:4});
export const probabilityText=value=>value==null||!Number.isFinite(value)?'계산 불가':decimal4(value*100)+'%';
export function probabilityString(value){const s=String(value??'');return /^-?\d+(?:\.\d+)?%$/.test(s)?decimal4(Number(s.slice(0,-1)))+'%':s;}
export function probabilityDifference(before,after){
 if(before==null||after==null||!Number.isFinite(before)||!Number.isFinite(after))return '계산 불가';
 const delta=after-before;if(Math.abs(delta)<=Number.EPSILON*Math.max(1,Math.abs(before),Math.abs(after)))return '차이 없음';
 const rounded=decimal4(delta*100);return Number(rounded)===0?'0 %p (반올림)':(delta>0?'+':'')+rounded+' %p';
}
export function averageKillChange(before,after){
 const a=averageKills(before),b=averageKills(after);
 if(a==='계산 불가'||b==='계산 불가')return `${a} → ${b}`;
 return a===b?'차이 없음':`${a} → ${b}`;
}
