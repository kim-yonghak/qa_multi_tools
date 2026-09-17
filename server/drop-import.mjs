import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as XLSX from './vendor/xlsx.mjs';
import {normalizeBooks} from './drop-normalize.mjs';
const wanted={drop:['Drop_Info','Drop_Group','Drop_Item'],npc:['NPC_Info','NPC_Abil','(Temp)NPC_Abil','(Temp)NPC_Info'],item:['Item_Info','Item_Base','Item_String'],string:['String_itemName']};
export async function importDropFiles(files, progress=()=>{},dropOnly=false){
 const books={},sources=[];
 for(const role of (dropOnly?['drop']:['drop','npc','item','string'])){
  progress(`${role.toUpperCase()} 파일 읽는 중…`);
  const input=files[role];if(!input)throw new Error(`${role} 파일이 필요합니다.`);
  const bytes=await fs.readFile(input.path);
  if(bytes.length>160*1024*1024)throw new Error('파일 하나는 160MB 이하로 등록하세요.');
  const sheetNames=XLSX.read(bytes,{bookSheets:true}).SheetNames;
  const selected=wanted[role].map(n=>sheetNames.find(s=>s.toLowerCase()===n.toLowerCase())).filter(Boolean);
  const wb=XLSX.read(bytes,{sheets:selected,dense:true,cellText:false,cellHTML:false,cellFormula:false,bookVBA:false});
  books[role]={};
  for(const name of selected){
   const standard=wanted[role].find(s=>s.toLowerCase()===name.toLowerCase());
   // Preserve physical worksheet row numbers (including entirely blank rows).
   const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null,blankrows:true});
   books[role][standard]=rows;
  }
  sources.push({role,name:path.basename(input.name||input.path),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sheets:selected});
 }
 progress('최신 버전 선택 및 ID 연결 검사 중…');
 return normalizeBooks(books,sources,new Date().toISOString(),dropOnly);
}
