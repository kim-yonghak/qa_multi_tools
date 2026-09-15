import { parseJSON, summarize } from './compare.js';

let pairs = new Map(), options = {}, cache = null;
async function read(file, label) {
  if (!file) return { text: '', node: undefined };
  if (file.size > (options.maxFileMB || 128) * 1024 * 1024) throw new Error(`${label}: 단일 파일 제한(${options.maxFileMB || 128}MB)을 초과했습니다. 비교 설정에서 제한을 조정할 수 있습니다.`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error(`${label}: UTF-8 파일을 읽을 수 없습니다. 인코딩 또는 파일 접근 상태를 확인하세요.`); }
  try { return { text, node: parseJSON(text) }; }
  catch (e) { throw new Error(`${label}: ${e.message}`); }
}
async function load(pair) {
  const old = await read(pair.old, '이전 파일');
  const latest = await read(pair.latest, '최신 파일');
  return { old, latest };
}
async function scan() {
  let done = 0;
  cache = null;
  for (const pair of pairs.values()) {
    self.postMessage({ type: 'progress', done, total: pairs.size, path: pair.path });
    try {
      const { old, latest } = await load(pair);
      const result = summarize(old.node, latest.node, old.text, latest.text, options);
      const status = !pair.old ? 'added' : !pair.latest ? 'deleted' : result.total ? 'modified' : 'same';
      self.postMessage({ type: 'result', path: pair.path, status, ...result });
    } catch (error) {
      self.postMessage({ type: 'result', path: pair.path, status: 'error', error: error.message, total: 0 });
    }
    done++;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  self.postMessage({ type: 'done', done, total: pairs.size });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { pairs = new Map(data.pairs.map(p => [p.path, p])); options = data.options; cache = null; }
    if (data.type === 'scan') await scan();
    if (data.type === 'detail') {
      const pair = pairs.get(data.path);
      if (!pair) throw new Error('파일을 찾을 수 없습니다. 다시 비교하세요.');
      let entry = cache;
      if (!entry || entry.path !== data.path) {
        entry = { path: data.path, ...await load(pair) };
        cache = entry;
      }
      const result = summarize(entry.old.node, entry.latest.node, entry.old.text, entry.latest.text, options, data.offset, data.limit);
      self.postMessage({ type: 'detail', token: data.token, path: data.path, offset: data.offset, ...result });
    }
  } catch (error) { self.postMessage({ type: 'fatal', token: data.token, error: error.message }); }
};
