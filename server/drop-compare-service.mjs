import {groupSummaries} from './drop-summary.mjs';
import {makeDropIndex} from './drop-engine.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Worker} from 'node:worker_threads';
import crypto from 'node:crypto';
import {isLocalManager} from './drop-service.mjs';
const ROLES=['old','new'];
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
function mutationAllowed(req){
 if(!isLocalManager(req)||req.headers['x-qa-import']!=='1')return false;
 return !req.headers.origin||req.headers.origin==='http://'+req.headers.host;
}
async function smallJSON(req){let data='';for await(const part of req){data+=part;if(data.length>12000)throw new Error('요청이 너무 큽니다.');}return JSON.parse(data||'{}');}
export async function createCompareService(root,getReferences){
 const folder=process.env.QA_DROP_DATA_DIR||path.join(root,'data');
 await fs.mkdir(folder,{recursive:true});
 const current=path.join(folder,'drop-comparison.json');
 let dataset=null,loadError=null,job=null;
 try{dataset=JSON.parse(await fs.readFile(current,'utf8'));}catch(e){if(e.code!=='ENOENT')loadError=e.message;}
 function refreshSummary(data){
  const refs=getReferences(),saved=data.sources?.references||[];
  if(refs&&['npc','item','string'].every(role=>{const a=saved.find(x=>x.role===role),b=refs.sources.find(x=>x.role===role);return a?.sha256&&a.sha256===b?.sha256;})){
   const lookup=new Map(makeDropIndex(refs).search('',0,100000).rows.map(m=>[m.id,m]));
   for(const entry of Object.values(data.details)){const m=lookup.get(entry.monster.id);if(!m)continue;
    for(const key of ['map','area','npcType','uniqueNumber','displayLevel','classificationSource','classificationConflict'])entry.monster[key]=m[key];
   }
   for(const entry of data.monsters){const m=data.details[entry.monster.id]?.monster;if(m)entry.monster=m;}
  }
  data.groups=groupSummaries(Object.values(data.details));return data;
 }
 if(dataset)refreshSummary(dataset);
 const publicJob=()=>job?{id:job.id,state:job.state,message:job.message,uploaded:Object.keys(job.files),error:job.error}:null;
 async function cleanup(old){if(old?.folder)await fs.rm(old.folder,{recursive:true,force:true});}
 async function beginBuild(active){
  active.state='processing';active.message='엑셀 파일 분석을 시작합니다…';
  const output=path.join(active.folder,'result.json');
  const references=path.join(active.folder,'references.json');await fs.writeFile(references,JSON.stringify(getReferences()));
  const worker=new Worker(new URL('./drop-compare-worker.mjs',import.meta.url),{workerData:{files:active.files,output,references},resourceLimits:{maxOldGenerationSizeMb:3072}});
  active.worker=worker;let finished=false;
  const timer=setTimeout(()=>{fail(new Error('분석이 10분을 초과했습니다. 파일 크기와 내용을 확인하세요.'));worker.terminate();},600000);timer.unref();
  function fail(error){if(finished)return;finished=true;clearTimeout(timer);active.state='error';active.error=error.message;active.message='등록에 실패했습니다. 이전 비교 결과는 유지됩니다.';cleanup(active).catch(()=>{});}
  worker.on('message',async message=>{
   if(finished)return;
   if(message.error){fail(new Error(message.error));return;}
   if(message.message)active.message=message.message;
   if(message.done){
    try{
     const next=JSON.parse(await fs.readFile(output,'utf8'));if(next.format!==1||!next.details)throw new Error('잘못된 비교 결과');
     // Validate first, then atomically replace the persistent snapshot. Failed imports keep old data.
     await fs.rename(output,current);
     dataset=refreshSummary(next);loadError=null;finished=true;clearTimeout(timer);
     active.state='done';active.message='드랍 비교 완료';await cleanup(active);
    }catch(error){fail(error);}
   }
  });
  worker.on('error',fail);worker.on('exit',code=>{if(code!==0&&!finished)fail(new Error(`분석 프로세스가 종료되었습니다 (${code}).`));});
 }
 return async function handle(req,res,url){
  if(!url.pathname.startsWith('/api/drop-compare/'))return false;
  try{
   if(req.method==='GET'){
    if(url.pathname==='/api/drop-compare/status'){json(res,200,{available:!!dataset,canManage:isLocalManager(req),referencesReady:!!getReferences(),loadError,job:publicJob()});return true;}
    if(!dataset){json(res,409,{error:'비교 결과가 없습니다. 담당자가 구버전·신버전 Drop을 등록하세요.'});return true;}
    if(url.pathname==='/api/drop-compare/result'){const {details,...result}=dataset;json(res,200,result);return true;}
    if(url.pathname==='/api/drop-compare/monster'){if(url.searchParams.has('createdAt')&&url.searchParams.get('createdAt')!==dataset.createdAt){json(res,409,{error:'비교 결과가 갱신되었습니다. 결과 새로고침을 눌러 주세요.'});return true;}const id=url.searchParams.get('id');const result=Object.hasOwn(dataset.details,id)?dataset.details[id]:null;json(res,result?200:404,result||{error:'몬스터를 찾지 못했습니다.'});return true;}
   }
   if(!['POST','PUT','DELETE'].includes(req.method)){json(res,404,{error:'지원하지 않는 주소입니다.'});return true;}
   if(!mutationAllowed(req)){json(res,403,{error:'데이터 등록은 서버 PC의 http://localhost 주소에서만 가능합니다.'});return true;}
   if(req.method==='POST'&&url.pathname==='/api/drop-compare/import'){
    if(job&&['uploading','processing'].includes(job.state)){json(res,409,{error:'다른 등록 작업이 진행 중입니다. 완료하거나 취소해 주세요.'});return true;}
    if(!getReferences())throw new Error('기준 NPC·Item·String 데이터를 먼저 등록하세요.');
    const input=await smallJSON(req);
    const names={};for(const role of ROLES){const name=input[role];if(typeof name!=='string'||!/^.{1,200}\.(xlsx|xlsb)$/i.test(name))throw new Error('구버전과 신버전 Drop 파일 2개를 선택하세요.');names[role]=path.basename(name);}
    if(job)await cleanup(job);
    const id=crypto.randomBytes(16).toString('hex'),dir=path.join(folder,'compare-upload-'+id);await fs.mkdir(dir);
    job={id,folder:dir,state:'uploading',message:'파일 전송 대기',names,files:{},receiving:false};json(res,201,publicJob());return true;
   }
   const match=/^\/api\/drop-compare\/import\/([a-f0-9]{32})(?:\/(old|new|commit))?$/.exec(url.pathname);
   if(!match||!job||job.id!==match[1]){json(res,404,{error:'등록 작업을 찾을 수 없습니다.'});return true;}
   if(req.method==='DELETE'&&!match[2]){
    if(job.state==='processing'){json(res,409,{error:'분석 중입니다. 완료 후 다시 등록해 주세요.'});return true;}
    if(job.receiving){json(res,409,{error:'파일 전송이 끝난 후 취소하세요.'});return true;}
    await cleanup(job);job=null;json(res,200,{ok:true});return true;
   }
   if(job.state!=='uploading'){json(res,409,{error:'파일을 전송할 수 없는 작업 상태입니다.'});return true;}
   if(req.method==='PUT'&&ROLES.includes(match[2])){
    if(job.receiving){json(res,409,{error:'파일은 하나씩 전송하세요.'});return true;}
    const active=job,role=match[2],file=path.join(active.folder,role+path.extname(active.names[role]).toLowerCase());
    active.receiving=true;delete active.files[role];let size=0;
    try{
     const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>160*1024*1024)callback(new Error('파일 하나는 160MB 이하로 등록하세요.'));else callback(null,chunk);}});
     await pipeline(req,limit,createWriteStream(file));
     if(!size)throw new Error('파일이 비어 있습니다.');
     active.files[role]={path:file,name:active.names[role]};active.message=`${role.toUpperCase()} 전송 완료`;json(res,200,publicJob());
    }finally{active.receiving=false;}
    return true;
   }
   if(req.method==='POST'&&match[2]==='commit'){
    if(job.receiving||ROLES.some(role=>!job.files[role]))throw new Error('2개 파일의 전송을 먼저 완료하세요.');
    try{await beginBuild(job);}catch(e){job.state='error';job.error=e.message;await cleanup(job);throw e;}json(res,202,publicJob());return true;
   }
   json(res,404,{error:'지원하지 않는 주소입니다.'});return true;
  }catch(error){if(!res.headersSent&&!res.destroyed)json(res,400,{error:error.message});return true;}
 };
}
