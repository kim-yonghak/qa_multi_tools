import { buildReview, reviewPage, reviewHighlights, lineHighlight } from './json-review.js';
import { indexSource, sourceLines, countSourceMatches, sourceMatch } from './source-lines.js';
import { parseJSON, summarize } from './compare.js';

let sourceSession = null, sourceToken = null;
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
    if (data.type === 'source-close') { if (sourceToken === data.token) { sourceToken = null; sourceSession = null; } return; }
    if (data.type === 'source-open') {
      sourceToken = data.token; sourceSession = null;
      const pair = pairs.get(data.path);
      if (!pair) throw new Error('파일을 찾을 수 없습니다. 다시 비교하세요.');
      const entry = cache?.path === data.path ? cache : { path: data.path, ...await load(pair) };
      if (sourceToken !== data.token) return;
      cache = entry;
      const fileMode = data.mode === 'file';
      const range = version => version.node ? { start: 0, end: version.text.length, line: 1 } : null;
      sourceSession = { old: indexSource(entry.old.text, fileMode ? range(entry.old) : data.old), latest: indexSource(entry.latest.text, fileMode ? range(entry.latest) : data.latest), mode: fileMode ? 'file' : 'selection' };
      if (fileMode) {
        entry.review ||= buildReview(entry.old.node, entry.latest.node, entry.old.text, entry.latest.text, options);
        sourceSession.highlights = { old: reviewHighlights(entry.review, 'old'), latest: reviewHighlights(entry.review, 'latest') };
      }
      const meta = source => source ? { line: source.line, count: source.starts.length } : null;
      self.postMessage({ type: 'source-ready', token: data.token, mode: sourceSession.mode, changes: fileMode ? entry.review.total : null, old: meta(sourceSession.old), latest: meta(sourceSession.latest) });
      return;
    }
    if (data.type === 'source-search') {
      if (sourceToken !== data.token || !sourceSession) return;
      const query = String(data.query || '');
      const scope = ['old', 'latest'].includes(data.scope) ? data.scope : 'both';
      const sides = scope === 'both' ? ['old', 'latest'] : [scope];
      let search = sourceSession.search;
      if (!search || search.query !== query || search.scope !== scope) {
        const counts = sides.map(side => countSourceMatches(sourceSession[side], query));
        search = sourceSession.search = { query, scope, counts, total: counts.reduce((a, b) => a + b, 0) };
      }
      const requested = Number.isInteger(data.index) ? data.index : 0;
      const index = search.total ? ((requested % search.total) + search.total) % search.total : 0;
      let remaining = index, hit = null;
      if (search.total) for (let i = 0; i < sides.length; i++) {
        if (remaining < search.counts[i]) { hit = { side: sides[i], ...sourceMatch(sourceSession[sides[i]], query, remaining) }; break; }
        remaining -= search.counts[i];
      }
      self.postMessage({ type: 'source-search', token: data.token, request: data.request, total: search.total, index, hit });
      return;
    }
    if (data.type === 'source-lines') {
      if (sourceToken !== data.token || !sourceSession || !['old', 'latest'].includes(data.side)) return;
      self.postMessage({ type: 'source-lines', token: data.token, side: data.side, request: data.request, rows: sourceLines(sourceSession[data.side], data.start, data.count).map(row => ({ ...row, change: lineHighlight(sourceSession.highlights?.[data.side] || [], row.line) })) });
      return;
    }
    if (data.type === 'init') { pairs = new Map(data.pairs.map(p => [p.path, p])); options = data.options; cache = null; sourceSession = null; sourceToken = null; }
    if (data.type === 'scan') await scan();
    if (data.type === 'detail') {
      const pair = pairs.get(data.path);
      if (!pair) throw new Error('파일을 찾을 수 없습니다. 다시 비교하세요.');
      let entry = cache;
      if (!entry || entry.path !== data.path) {
        entry = { path: data.path, ...await load(pair) };
        cache = entry;
      }
      entry.review ||= buildReview(entry.old.node, entry.latest.node, entry.old.text, entry.latest.text, options);
      const result = reviewPage(entry.review, entry.old.text, entry.latest.text, data);
      self.postMessage({ type: 'detail', token: data.token, path: data.path, offset: data.offset, ...result });
    }
  } catch (error) { self.postMessage({ type: data.type.startsWith('source-') ? 'source-error' : 'fatal', token: data.token, request: data.request, operation: data.type, error: error.message }); }
};
