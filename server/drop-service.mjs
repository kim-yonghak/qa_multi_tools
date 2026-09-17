import fs from 'node:fs/promises';
import path from 'node:path';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Worker} from 'node:worker_threads';
import crypto from 'node:crypto';
import {createCompareService} from './drop-compare-service.mjs';
import {makeDropIndex} from './drop-engine.mjs';
const ROLES=['drop','npc','item','string'];
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
export function isLocalManager(req){
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return false;
 try{const url=new URL('http://'+req.headers.host);return ['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch{return false;}
}
function mutationAllowed(req){
 if(!isLocalManager(req)||req.headers['x-qa-import']!=='1')return false;
 return !req.headers.origin||req.headers.origin==='http://'+req.headers.host;
}
async function smallJSON(req){let data='';for await(const part of req){data+=part;if(data.length>12000)throw new Error('요청이 너무 큽니다.');}return JSON.parse(data||'{}');}
export async function createDropService(root){
 const folder=process.env.QA_DROP_DATA_DIR||path.join(root,'data');
 await fs.mkdir(folder,{recursive:true});
 const current=path.join(folder,'drop-current.json');
 let dataset=null,index=null,loadError=null,job=null;
 async function load(file){const data=JSON.parse(await fs.readFile(file,'utf8'));const next=makeDropIndex(data);dataset=data;index=next;loadError=null;}
 try{await load(current);}catch(error){
  if(error.code==='ENOENT'){
   try{await load(path.join(folder,'drop-seed.json'));await fs.copyFile(path.join(folder,'drop-seed.json'),current);}catch(e){if(e.code!=='ENOENT')loadError=e.message;}
  }else loadError=error.message;
 }
 // Enrich older snapshots only when the actual reference files match the bundled seed.
 if(dataset&&!dataset.referenceMetadataVersion){
  try{const seed=JSON.parse(await fs.readFile(path.join(folder,'drop-seed.json'),'utf8'));
   if(seed.referenceMetadataVersion&&['npc','item','string'].every(role=>{const a=dataset.sources.find(x=>x.role===role),b=seed.sources.find(x=>x.role===role);return a?.sha256&&a.sha256===b?.sha256;})){
    for(const k of ['npcNames','bases'])dataset.tables[k]=seed.tables[k];dataset.referenceMetadataVersion=1;index=makeDropIndex(dataset);
    const temp=current+'.tmp';await fs.writeFile(temp,JSON.stringify(dataset));await fs.rename(temp,current);
   }
  }catch(e){loadError='분류 정보 갱신 실패: '+e.message;}
 }
 const handleCompare=await createCompareService(root,()=>dataset);
 const publicJob=()=>job?{id:job.id,state:job.state,message:job.message,uploaded:Object.keys(job.files),error:job.error}:null;
 async function cleanup(old){if(old?.folder)await fs.rm(old.folder,{recursive:true,force:true});}
 async function beginBuild(active){
  active.state='processing';active.message='엑셀 파일 분석을 시작합니다…';
  const output=path.join(active.folder,'result.json');
  const worker=new Worker(new URL('./drop-import-worker.mjs',import.meta.url),{workerData:{files:active.files,output},resourceLimits:{maxOldGenerationSizeMb:3072}});
  active.worker=worker;let finished=false;
  const timer=setTimeout(()=>{fail(new Error('분석이 10분을 초과했습니다. 파일 크기와 내용을 확인하세요.'));worker.terminate();},600000);timer.unref();
  function fail(error){if(finished)return;finished=true;clearTimeout(timer);active.state='error';active.error=error.message;active.message='등록에 실패했습니다. 이전 데이터는 유지됩니다.';cleanup(active).catch(()=>{});}
  worker.on('message',async message=>{
   if(finished)return;
   if(message.error){fail(new Error(message.error));return;}
   if(message.message)active.message=message.message;
   if(message.done){
    try{
     const next=JSON.parse(await fs.readFile(output,'utf8')),nextIndex=makeDropIndex(next);
     // Validate first, then atomically replace the persistent snapshot. Failed imports keep old data.
     await fs.rename(output,current);
     dataset=next;index=nextIndex;loadError=null;finished=true;clearTimeout(timer);
     active.state='done';active.message='공유 데이터 등록 완료';await cleanup(active);
    }catch(error){fail(error);}
   }
  });
  worker.on('error',fail);worker.on('exit',code=>{if(code!==0&&!finished)fail(new Error(`분석 프로세스가 종료되었습니다 (${code}).`));});
 }
 return async function handle(req,res,url){
  if(await handleCompare(req,res,url))return true;
  if(!url.pathname.startsWith('/api/drop/'))return false;
  try{
   if(req.method==='GET'){
    if(url.pathname==='/api/drop/status'){json(res,200,{available:!!dataset,canManage:isLocalManager(req),loadError,job:publicJob(),metadata:dataset?{registeredAt:dataset.registeredAt,sources:dataset.sources,stats:dataset.stats,indexStats:index.stats,diagnostics:dataset.diagnostics.slice(0,100),diagnosticCount:dataset.diagnostics.length}:null});return true;}
    if(!index){json(res,409,{error:'담당자가 드랍 데이터를 먼저 등록해야 합니다.'});return true;}
    if(url.pathname==='/api/drop/search'){
     const q=(url.searchParams.get('q')||'').slice(0,160),offset=Math.min(100000,Math.max(0,Number(url.searchParams.get('offset'))||0));
     json(res,200,index.search(q,offset));return true;
    }
    if(url.pathname==='/api/drop/monster'){
     const id=url.searchParams.get('id')||'';
     if(!/^\d{1,20}$/.test(id)){json(res,400,{error:'올바른 몬스터 ID를 입력하세요.'});return true;}
     const result=index.detail(id,{direct:url.searchParams.get('direct')==='1'});
     json(res,result?200:404,result||{error:'해당 ID를 찾을 수 없습니다.'});return true;
    }
   }
   if(!['POST','PUT','DELETE'].includes(req.method)){json(res,404,{error:'지원하지 않는 주소입니다.'});return true;}
   if(!mutationAllowed(req)){json(res,403,{error:'데이터 등록은 서버 PC의 http://localhost 주소에서만 가능합니다.'});return true;}
   if(req.method==='POST'&&url.pathname==='/api/drop/import'){
    if(job&&['uploading','processing'].includes(job.state)){json(res,409,{error:'다른 등록 작업이 진행 중입니다. 완료하거나 취소해 주세요.'});return true;}
    const input=await smallJSON(req);
    const names={};for(const role of ROLES){const name=input[role];if(typeof name!=='string'||!/^.{1,200}\.(xlsx|xlsb)$/i.test(name))throw new Error('Drop, NPC, Item, String 엑셀 파일 4개를 선택하세요.');names[role]=path.basename(name);}
    if(job)await cleanup(job);
    const id=crypto.randomBytes(16).toString('hex'),dir=path.join(folder,'upload-'+id);await fs.mkdir(dir);
    job={id,folder:dir,state:'uploading',message:'파일 전송 대기',names,files:{},receiving:false};json(res,201,publicJob());return true;
   }
   const match=/^\/api\/drop\/import\/([a-f0-9]{32})(?:\/(drop|npc|item|string|commit))?$/.exec(url.pathname);
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
    if(job.receiving||ROLES.some(role=>!job.files[role]))throw new Error('4개 파일의 전송을 먼저 완료하세요.');
    await beginBuild(job);json(res,202,publicJob());return true;
   }
   json(res,404,{error:'지원하지 않는 주소입니다.'});return true;
  }catch(error){if(!res.headersSent&&!res.destroyed)json(res,400,{error:error.message});return true;}
 };
}
