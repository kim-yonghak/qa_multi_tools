// Read-only XLSX import. No network, macros, or formula execution.
import sax from '../vendor/sax.js';
import { gridToCells, parseDelimited, parseAddress } from './rules.js';

const MAX_PART = 32 * 1024 * 1024, MAX_TOTAL = 128 * 1024 * 1024;
const decode = bytes => new TextDecoder('utf-8', {fatal:true}).decode(bytes);
const crcTable = Array.from({length:256}, (_,n) => { for(let k=0;k<8;k++) n=n&1?0xedb88320^(n>>>1):n>>>1; return n>>>0; });
function crc32(bytes) { let c=0xffffffff; for(const b of bytes) c=crcTable[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0; }

export function openZip(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let end = -1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0) throw new Error('일반 .xlsx 파일이 아닙니다. 암호를 해제한 .xlsx 파일로 다시 저장하세요.');
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw new Error('분할 ZIP 형식은 지원하지 않습니다.');
  const count=view.getUint16(end+10,true); let offset=view.getUint32(end+16,true), total=0;
  if(count===65535||offset===0xffffffff)throw new Error('ZIP64 엑셀 파일은 지원하지 않습니다. 필요한 시트만 별도 .xlsx로 저장하세요.');
  const entries=new Map();
  for(let i=0;i<count;i++) {
    if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw new Error('엑셀 ZIP 목록이 손상되었습니다.');
    const flag=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),crc=view.getUint32(offset+16,true),size=view.getUint32(offset+20,true),unpacked=view.getUint32(offset+24,true);
    const nameSize=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
    if(offset+46+nameSize+extra+comment>bytes.length)throw new Error('잘못된 ZIP 경로 정보입니다.');
    const name=decode(bytes.subarray(offset+46,offset+46+nameSize));
    total+=unpacked;
    if(unpacked>MAX_PART||total>MAX_TOTAL)throw new Error('엑셀 내부 데이터가 너무 큽니다. 필요한 범위만 새 .xlsx로 저장하세요.');
    if(entries.has(name))throw new Error('중복된 ZIP 경로가 있습니다.');
    entries.set(name,{flag,method,crc,size,unpacked,local}); offset+=46+nameSize+extra+comment;
  }
  return {
    has: name=>entries.has(name),
    async text(name) {
      const item=entries.get(name); if(!item)throw new Error(`엑셀 구성 파일이 없습니다: ${name}`);
      const {flag,method,crc,size,unpacked,local}=item;
      if(flag&1)throw new Error('암호화된 엑셀 파일은 지원하지 않습니다.');
      if(local+30>bytes.length||view.getUint32(local,true)!==0x04034b50)throw new Error('엑셀 ZIP 데이터가 손상되었습니다.');
      const begin=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
      if(begin+size>bytes.length)throw new Error('엑셀 ZIP 크기가 올바르지 않습니다.');
      let result;
      if(method===0) result=bytes.subarray(begin,begin+size);
      else if(method===8) {
        let stream;
        try { stream=new Blob([bytes.subarray(begin,begin+size)]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
        catch { throw new Error('이 브라우저에서 .xlsx 압축을 해제할 수 없습니다. 최신 Chrome/Edge를 사용하거나 셀을 복사해 붙여넣으세요.'); }
        const reader=stream.getReader(),chunks=[];let actual=0;
        try { while(true){const {value,done}=await reader.read();if(done)break;actual+=value.length;if(actual>unpacked||actual>MAX_PART){await reader.cancel();throw new Error('엑셀 압축 해제 크기가 제한을 초과했습니다.');}chunks.push(value);} }
        finally { reader.releaseLock(); }
        result=new Uint8Array(actual);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}
      } else throw new Error('지원하지 않는 엑셀 ZIP 압축 방식입니다.');
      if(result.length!==unpacked||crc32(result)!==crc)throw new Error('엑셀 ZIP 데이터 검증에 실패했습니다. 파일을 다시 저장하세요.');
      return decode(result);
    }
  };
}

const localName = name => name.split(':').at(-1);
export function parseXML(text) {
  const root={name:'#document',attrs:{},children:[],text:''},stack=[root];
  const parser=sax.parser(true,{trim:false,normalize:false});
  parser.ondoctype=()=>{throw new Error('DTD가 포함된 XML은 지원하지 않습니다.');};
  parser.onopentag=tag=>{const node={name:localName(tag.name),attrs:tag.attributes,children:[],text:''};stack.at(-1).children.push(node);stack.push(node);};
  parser.ontext=parser.oncdata=text=>{stack.at(-1).text+=text;};
  parser.onclosetag=()=>{stack.pop();};
  parser.onerror=e=>{throw new Error(`엑셀 XML 오류: ${e.message.split('\n')[0]}`);};
  parser.write(text).close();return root;
}
const descendants = (node,name) => node.children.flatMap(c=>[...(c.name===name?[c]:[]),...descendants(c,name)]);
const child = (node,name) => node.children.find(x=>x.name===name);
const richText = node => node.name==='rPh'?'':(node.name==='t'?node.text:'')+node.children.map(richText).join('');
function resolvePath(base,target) {
  const parts=(target.startsWith('/')?target.slice(1):base+'/'+target).replace(/\\/g,'/').split('/'),out=[];
  for(const p of parts){if(p==='..'){if(!out.length)throw new Error('잘못된 엑셀 내부 경로입니다.');out.pop();}else if(p!=='.'&&p)out.push(p);}
  return out.join('/');
}

export async function readWorkbook(file) {
  if(file.size>25*1024*1024)throw new Error('아이템 변환 파일은 25MB 이하로 선택하세요.');
  if(/\.(csv|tsv|txt)$/i.test(file.name)) {
    let text;try{text=decode(new Uint8Array(await file.arrayBuffer()));}catch{throw new Error('텍스트 파일은 UTF-8로 저장하세요. 엑셀 복사·붙여넣기도 가능합니다.');}
    return {sheets:[{name:file.name,cells:gridToCells(parseDelimited(text,/\.csv$/i.test(file.name)?',':'\t'))}]};
  }
  if(!/\.xlsx$/i.test(file.name))throw new Error('.xlsx 파일을 선택하세요. .xls/.xlsm은 .xlsx로 저장하거나 셀을 복사해 붙여넣으세요.');
  const zip=openZip(await file.arrayBuffer());
  const relationships=descendants(parseXML(await zip.text('_rels/.rels')),'Relationship');
  const office=relationships.find(x=>/\/officeDocument$/.test(x.attrs.Type));
  if(!office||office.attrs.TargetMode==='External')throw new Error('엑셀 통합 문서를 찾지 못했습니다.');
  const bookPath=resolvePath('',office.attrs.Target),base=bookPath.split('/').slice(0,-1).join('/');
  const book=parseXML(await zip.text(bookPath));
  const relPath=base+'/_rels/'+bookPath.split('/').at(-1)+'.rels';
  const rels=descendants(parseXML(await zip.text(relPath)),'Relationship');
  const sharedRel=rels.find(x=>/\/sharedStrings$/.test(x.attrs.Type));
  let strings=[];
  if(sharedRel){if(sharedRel.attrs.TargetMode==='External')throw new Error('외부 문자열 참조는 지원하지 않습니다.');strings=descendants(parseXML(await zip.text(resolvePath(base,sharedRel.attrs.Target))),'si').map(richText);}
  const sheets=[];
  for(const sheet of descendants(book,'sheet')) {
    const relId=Object.entries(sheet.attrs).find(([key])=>localName(key)==='id')?.[1];
    const rel=rels.find(x=>x.attrs.Id===relId);
    if(!rel||! /\/worksheet$/.test(rel.attrs.Type)||rel.attrs.TargetMode==='External')continue;
    sheets.push({name:sheet.attrs.name,hidden:sheet.attrs.state==='hidden'||sheet.attrs.state==='veryHidden',path:resolvePath(base,rel.attrs.Target)});
  }
  if(!sheets.length)throw new Error('읽을 수 있는 워크시트가 없습니다.');
  return {sheets,async loadSheet(index){
    const sheet=sheets[index];if(sheet.cells)return sheet.cells;
    const xml=parseXML(await zip.text(sheet.path)),cells=[],seen=new Set();
    for(const row of descendants(xml,'row')) for(const cell of row.children.filter(x=>x.name==='c')) {
      const raw=child(cell,'v')?.text,formula=child(cell,'f'),type=cell.attrs.t;
      if(raw===undefined&&!child(cell,'is')&&!formula)continue;
      if(!cell.attrs.r)throw new Error('셀 주소가 없는 엑셀 파일입니다. Excel에서 다시 저장하세요.');
      const pos=parseAddress(cell.attrs.r);let value='',issue='',note='';
      if(seen.has(cell.attrs.r))throw new Error('중복 셀 주소가 있습니다.');seen.add(cell.attrs.r);
      if(formula&&raw===undefined)issue='수식의 저장된 결과가 없습니다. Excel에서 계산·저장하거나 값으로 붙여넣으세요.';
      else if(type==='s'){const id=Number(raw);if(!Number.isInteger(id)||id<0||id>=strings.length)issue='문자열 참조를 읽지 못했습니다.';else value=strings[id];}
      else if(type==='inlineStr')value=richText(child(cell,'is')||{name:'is',text:'',children:[]});
      else if(type==='e'){value=raw;issue=`엑셀 셀 오류: ${raw}`;}
      else if(type==='b'){value=raw==='1'?'TRUE':'FALSE';}
      else {
        value=raw??'';
        // Excel can serialize a numeric integer as 9.0 or 9E0.
        if((!type||type==='n') && /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value)) {
          const number=Number(value);if(Number.isSafeInteger(number))value=String(number);
        }
      }
      if(formula&&!issue)note='수식의 저장된 결과 사용';
      cells.push({...pos,value,issue,note});
      if(cells.length>200000)throw new Error('한 시트에서 200,000개 셀까지 읽을 수 있습니다. 필요한 범위만 별도 저장하세요.');
    }
    return cells;
  }};
}
