import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs/promises';
import {importDropFiles} from './drop-import.mjs';
import {compareDrops} from './drop-compare.mjs';
try{
 const progress=message=>parentPort.postMessage({message});
 progress('구버전 Drop 분석 중…');const old=await importDropFiles({drop:workerData.files.old},()=>{},true);
 progress('신버전 Drop 분석 중…');const next=await importDropFiles({drop:workerData.files.new},()=>{},true);
 progress('몬스터별 변경점과 요약 작성 중…');const refs=JSON.parse(await fs.readFile(workerData.references,'utf8'));
 const result=compareDrops(old,next,refs);await fs.writeFile(workerData.output,JSON.stringify(result));parentPort.postMessage({done:true});
}catch(e){parentPort.postMessage({error:e.message});}
