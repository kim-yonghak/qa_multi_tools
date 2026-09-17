import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createDropService,isLocalManager} from '../server/drop-service.mjs';
test('manager access requires BOTH loopback connection and local Host',()=>{
 const req=(remoteAddress,host)=>({socket:{remoteAddress},headers:{host}});
 assert.equal(isLocalManager(req('127.0.0.1','localhost:5175')),true);
 assert.equal(isLocalManager(req('192.168.1.10','localhost:5175')),false);
 assert.equal(isLocalManager(req('127.0.0.1','attacker.example:5175')),false);
});
test('shared dataset persists; protected registration and failed import preserve old data',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'qa-drop-api-'));let server;
 try{
  const seed={format:1,registeredAt:'test-original',sources:[],stats:{counts:{}},diagnostics:[],tables:{infos:[],groups:[],drops:[]}};
  await fs.mkdir(path.join(root,'data'));await fs.writeFile(path.join(root,'data/drop-seed.json'),JSON.stringify(seed));
  let handle=await createDropService(root);server=http.createServer((req,res)=>handle(req,res,new URL(req.url,'http://localhost')));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  const get=async route=>(await fetch(base+route)).json();
  assert.equal((await get('/api/drop/status')).metadata.registeredAt,'test-original');
  await fs.writeFile(path.join(root,'data/drop-seed.json'),JSON.stringify({...seed,registeredAt:'new-seed'}));
  handle=await createDropService(root);assert.equal((await get('/api/drop/status')).metadata.registeredAt,'test-original');
  const post=(route,body,extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-QA-Import':'1',...extra},body:JSON.stringify(body)});
  assert.equal((await post('/api/drop/import',{}, {'X-QA-Import':'','Origin':'http://evil.example'})).status,403);
  assert.equal((await post('/api/drop/import',{}, {'Origin':'http://evil.example'})).status,403);
  const names={drop:'Drop.xlsb',npc:'NPC.xlsx',item:'Item.xlsb',string:'String.xlsx'};
  const begin=await post('/api/drop/import',names);assert.equal(begin.status,201);const j=await begin.json();
  assert.equal((await post('/api/drop/import',names)).status,409);
  assert.equal((await post(`/api/drop/import/${j.id}/commit`,{})).status,400);
  for(const role of Object.keys(names))assert.equal((await fetch(`${base}/api/drop/import/${j.id}/${role}`,{method:'PUT',headers:{'X-QA-Import':'1'},body:'not an Excel file'})).status,200);
  assert.equal((await post(`/api/drop/import/${j.id}/commit`,{})).status,202);
  let status;for(let i=0;i<80;i++){status=await get('/api/drop/status');if(status.job.state==='error')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(status.job.state,'error');assert.equal(status.metadata.registeredAt,'test-original');
  assert.equal((await fetch(`${base}/api/drop/import/${j.id}`,{method:'DELETE',headers:{'X-QA-Import':'1'}})).status,200);
 }finally{if(server)await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
