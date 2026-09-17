import {parentPort,workerData} from 'node:worker_threads';
import {writeFile} from 'node:fs/promises';
import {importDropFiles} from './drop-import.mjs';
try{
 const result=await importDropFiles(workerData.files,message=>parentPort.postMessage({message}));
 await writeFile(workerData.output,JSON.stringify(result),'utf8');
 parentPort.postMessage({done:true});
}catch(error){parentPort.postMessage({error:error.message});}
