const $ = selector => document.querySelector(selector);
const fmt = n => n.toLocaleString('ko-KR');
const bytes = n => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const labels = { modified: '변경', added: '추가', deleted: '삭제', reordered: '순서 변경', error: '오류', same: '동일' };
const state = { old: null, latest: null, pairs: [], results: [], counts: {}, worker: null, busy: false, selected: null, offset: 0, token: 0, visible: 120 };

$('#app').innerHTML = `
  <header class="topbar"><a class="brand" href="/" aria-label="JSON Compare 홈"><span class="brand-icon">{ }</span> JSON Compare <span class="brand-tag">QA WORKSPACE</span></a><span class="local"><i></i> 파일은 이 브라우저에서만 처리됩니다</span></header>
  <main>
    <section class="intro"><div><div class="eyebrow">FOLDER COMPARISON</div><h1>달라진 데이터만, 한눈에.</h1><p>이전·최신 폴더의 JSON을 비교하고 변경된 값과 원본 위치를 확인하세요.</p></div><button class="quiet" id="demo">예제로 체험 ↗</button></section>
    <section class="setup" aria-label="비교 폴더 선택">
      <div class="folder" id="old-card"><div class="folder-label"><span class="step">01</span><span>이전 버전</span><span class="folder-state" id="old-state">선택 대기</span></div><h2 id="old-name">이전 폴더를 선택하세요</h2><p id="old-info">카테고리 하위 폴더까지 자동으로 찾습니다.</p><label class="choose" for="old-input">폴더 선택 <span>＋</span></label><input id="old-input" type="file" webkitdirectory multiple class="file-input" /></div>
      <div class="between" aria-hidden="true">→</div>
      <div class="folder latest" id="latest-card"><div class="folder-label"><span class="step">02</span><span>최신 버전</span><span class="folder-state" id="latest-state">선택 대기</span></div><h2 id="latest-name">최신 폴더를 선택하세요</h2><p id="latest-info">JSON만 비교하며 meta·bytes 등은 제외합니다.</p><label class="choose" for="latest-input">폴더 선택 <span>＋</span></label><input id="latest-input" type="file" webkitdirectory multiple class="file-input" /></div>
    </section>
    <div class="actions"><details id="settings"><summary>비교 설정</summary><div class="settings-grid"><label>배열 비교<select id="array-mode"><option value="auto">고유 ID 자동 인식 + 순서 변경 감지</option><option value="sequence">순서·내용 기준</option></select></label><label>우선 식별 키 (선택)<input id="id-key" placeholder="예: Item_Info_Id_" /></label><label>단일 파일 제한 (MB)<input id="max-file" type="number" value="128" min="1" max="1024" /></label><p>ID 자동 인식: ID, Id, id, Index, index, GUID, Guid, guid, Key, key. 양쪽 배열에 누락·중복이 없을 때만 적용합니다. 식별 키를 직접 입력하면 해당 키만 사용합니다. 배열 순서 변경도 결과에 포함됩니다.</p></div></details><div class="run-actions"><button id="cancel" class="quiet" hidden>비교 중지</button><button id="compare" class="primary" disabled>폴더 비교 시작 <span>→</span></button></div></div>
    <div id="status" class="status" role="status" aria-live="polite">두 폴더를 선택하면 비교를 시작할 수 있습니다.</div><progress id="progress" max="1" value="0" hidden></progress>
    <section id="results-area" hidden>
      <div class="metrics" id="metrics"></div>
      <div class="workspace"><aside class="file-panel"><div class="panel-heading"><h2>변경 파일</h2><span id="file-count">0</span></div><div class="file-tools"><input type="search" id="search" placeholder="파일명 또는 경로 검색" aria-label="파일명 또는 경로 검색"/><select id="filter" aria-label="파일 상태 필터"><option value="all">변경·추가·삭제·오류</option><option value="modified">변경</option><option value="added">추가</option><option value="deleted">삭제</option><option value="error">오류</option></select></div><div id="file-list" class="file-list"></div><button id="more" class="quiet" hidden>파일 더 보기</button><p class="panel-footnote">내용이 동일한 파일은 숨깁니다.<br/>들여쓰기·객체 키 순서는 무시합니다.</p></aside>
      <section class="detail-panel" id="detail" aria-label="파일 변경 상세"><div class="empty"><div class="empty-icon">{ ± }</div><h2>변경 내용을 살펴보세요</h2><p>비교가 끝나면 왼쪽에서 파일을 선택하세요.</p></div></section></div>
    </section>
    <footer><span>JSON Compare <b>1.0</b></span><span>값 기준 비교 · UTF-8 · 원본 행 번호</span></footer>
  </main>`;

function setStatus(message) { $('#status').textContent = message; }
function resetResults() {
  state.results = []; state.counts = { same: 0, modified: 0, added: 0, deleted: 0, error: 0 };
  state.selected = null; state.token++; state.visible = 120; state.pairs = [];
  state.worker?.terminate(); state.worker = null;
  $('#results-area').hidden = true; $('#progress').hidden = true;
}
function indexFiles(files) {
  const map = new Map(); let ignored = 0, size = 0;
  const name = files[0]?.webkitRelativePath?.split('/')[0] || '선택한 폴더';
  for (const file of files) {
    if (!/\.json$/i.test(file.name)) { ignored++; continue; }
    const full = file.webkitRelativePath || file.name;
    const path = full.includes('/') ? full.slice(full.indexOf('/') + 1) : full;
    if (map.has(path)) throw new Error(`같은 상대 경로가 중복됩니다: ${path}`);
    map.set(path, file); size += file.size;
  }
  return { map, ignored, size, name, count: files.length };
}
function assignFiles(side, files) {
  if (!files.length) return;
  try {
    const folder = indexFiles(files);
    resetResults(); state[side] = folder;
    $(`#${side}-name`).textContent = folder.name;
    $(`#${side}-info`).textContent = `JSON ${fmt(folder.map.size)}개 · ${bytes(folder.size)} · 기타 ${fmt(folder.ignored)}개 제외`;
    $(`#${side}-state`).textContent = '선택 완료';
    $(`#${side}-card`).classList.add('selected');
    $('#compare').disabled = !state.old || !state.latest;
    setStatus(state.old && state.latest ? '준비됐습니다. 폴더 비교 시작을 눌러주세요.' : '나머지 버전의 최상위 폴더를 선택하세요.');
  } catch (e) { setStatus(e.message); }
}
for (const side of ['old', 'latest']) $(`#${side}-input`).addEventListener('change', e => assignFiles(side, [...e.target.files]));
function busy(value) {
  state.busy = value;
  $('#compare').disabled = value || !state.old || !state.latest;
  $('#compare').textContent = value ? '비교 중…' : '폴더 비교 시작 →';
  $('#cancel').hidden = !value;
  for (const s of ['#old-input', '#latest-input', '#demo', '#array-mode', '#id-key', '#max-file']) $(s).disabled = value;
  document.body.classList.toggle('busy', value);
}
function createWorker(options) {
  state.worker?.terminate();
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      $('#progress').value = data.done; setStatus(`${fmt(data.done)} / ${fmt(data.total)} 파일 처리 중 · ${data.path}`);
    } else if (data.type === 'result') {
      state.counts[data.status]++;
      if (data.status !== 'same') state.results.push(data);
      $('#progress').value = Object.values(state.counts).reduce((a, b) => a + b, 0);
      if (state.results.length < 8 || performance.now() - lastRender > 180) renderResults();
    } else if (data.type === 'done') {
      busy(false); $('#progress').value = data.total || 1;
      const changed = state.counts.modified + state.counts.added + state.counts.deleted;
      setStatus(`비교 완료 · ${fmt(data.total)}개 경로 확인 · 변경·추가·삭제 ${fmt(changed)}개 · 동일 ${fmt(state.counts.same)}개 · 오류 ${fmt(state.counts.error)}개 · ${((performance.now() - started) / 1000).toFixed(1)}초`);
      renderResults();
      if (state.results.length) selectFile(state.results[0].path);
      else if (!data.total) emptyDetail('JSON 파일을 찾지 못했습니다', '선택한 폴더와 .json 확장자를 확인하세요.');
      else emptyDetail('변경된 JSON 파일이 없습니다', '두 폴더의 JSON 데이터가 동일합니다.');
    } else if (data.type === 'detail' && data.token === state.token) renderDetail(data);
    else if (data.type === 'fatal') {
      if (data.token && data.token !== state.token) return;
      if (state.busy) busy(false);
      setStatus(`처리 오류 · ${data.error}`); emptyDetail('파일을 표시할 수 없습니다', data.error);
    }
  };
  worker.onerror = e => { busy(false); setStatus(`작업을 완료하지 못했습니다. ${e.message || '단일 파일이 매우 크면 메모리 사용량을 확인하세요.'}`); };
  worker.postMessage({ type: 'init', pairs: state.pairs, options });
  state.worker = worker;
}
let started = 0, lastRender = 0, currentOptions = {};
$('#compare').onclick = () => {
  if (!state.old || !state.latest) return;
  const maxFileMB = Number($('#max-file').value);
  if (!Number.isFinite(maxFileMB) || maxFileMB < 1 || maxFileMB > 1024) { setStatus('단일 파일 제한은 1~1024MB로 입력하세요.'); return; }
  resetResults();
  currentOptions = { arrayMode: $('#array-mode').value, idKey: $('#id-key').value.trim(), maxFileMB };
  const paths = new Set([...state.old.map.keys(), ...state.latest.map.keys()]);
  state.pairs = [...paths].sort((a, b) => a.localeCompare(b, 'ko')).map(path => ({ path, old: state.old.map.get(path), latest: state.latest.map.get(path) }));
  $('#results-area').hidden = false; $('#progress').hidden = false;
  $('#progress').max = paths.size || 1; $('#progress').value = 0;
  $('#settings').open = false; $('#search').value = ''; $('#filter').value = 'all';
  emptyDetail('JSON 데이터를 비교하고 있습니다', '완료 후 변경 파일을 선택할 수 있습니다.');
  busy(true); started = performance.now(); renderResults();
  createWorker(currentOptions); state.worker.postMessage({ type: 'scan' });
};
$('#cancel').onclick = () => {
  state.worker?.terminate(); busy(false); createWorker(currentOptions);
  const done = Object.values(state.counts).reduce((a, b) => a + b, 0);
  setStatus(`비교 중지 · ${fmt(done)} / ${fmt(state.pairs.length)}개 확인. 목록은 처리된 파일에 대한 부분 결과입니다.`);
  renderResults(); emptyDetail('비교를 중지했습니다', '왼쪽에서 처리된 파일을 확인하거나 비교를 다시 시작하세요.');
};
function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function renderResults() {
  lastRender = performance.now();
  const metrics = $('#metrics'); metrics.replaceChildren();
  for (const [key, label] of [['modified', '변경 파일'], ['added', '추가 파일'], ['deleted', '삭제 파일'], ['error', '확인 필요'], ['same', '동일 파일']]) {
    const card = element('div', `metric ${key}`); card.append(element('span', '', label), element('strong', '', fmt(state.counts[key] || 0))); metrics.append(card);
  }
  const query = $('#search').value.toLowerCase(), filter = $('#filter').value;
  const filtered = state.results.filter(r => r.path.toLowerCase().includes(query) && (filter === 'all' || filter === r.status));
  $('#file-count').textContent = fmt(filtered.length);
  const list = $('#file-list'); list.replaceChildren();
  for (const result of filtered.slice(0, state.visible)) {
    const button = element('button', `file-item${state.selected === result.path ? ' active' : ''}`);
    button.disabled = state.busy;
    button.title = result.path;
    button.setAttribute('aria-pressed', String(state.selected === result.path));
    const parts = result.path.split('/'); const filename = parts.pop();
    const row = element('div', 'file-title'); row.append(element('span', 'file-icon', '{ }'), element('strong', '', filename));
    button.append(row, element('span', 'file-path', parts.join('/') || '최상위 폴더'));
    const meta = element('div', 'file-meta'); meta.append(element('span', `badge ${result.status}`, labels[result.status]), element('span', '', result.status === 'error' ? '내용 확인 필요' : `${fmt(result.total)}개 차이`));
    button.append(meta); button.onclick = () => selectFile(result.path); list.append(button);
  }
  if (!filtered.length) list.append(element('p', 'list-empty', state.busy ? '변경 파일을 찾고 있습니다…' : '표시할 파일이 없습니다.'));
  $('#more').hidden = filtered.length <= state.visible;
}
for (const selector of ['#search', '#filter']) $(selector).addEventListener('input', () => { state.visible = 120; renderResults(); });
$('#more').onclick = () => { state.visible += 120; renderResults(); };
function emptyDetail(title, description) {
  const wrap = element('div', 'empty'); wrap.append(element('div', 'empty-icon', '{ ± }'), element('h2', '', title), element('p', '', description)); $('#detail').replaceChildren(wrap);
}
function selectFile(path, offset = 0) {
  if (state.busy) return;
  state.selected = path; state.offset = offset; state.token++;
  const result = state.results.find(r => r.path === path);
  renderResults();
  if (result?.status === 'error') { emptyDetail(path, result.error); return; }
  emptyDetail('변경 내용을 불러오고 있습니다', path);
  state.worker.postMessage({ type: 'detail', path, offset, limit: 50, token: state.token });
}
function lineText(value) { return value ? value.line === value.endLine ? `${fmt(value.line)}행` : `${fmt(value.line)}–${fmt(value.endLine)}행` : '—'; }
function valueCell(value, version) {
  const td = element('td', `value-cell ${version}`);
  const content = value?.value ?? '(항목 없음)';
  td.append(element('span', 'line-number', lineText(value)), element('pre', '', content.slice(0, 220) + (content.length > 220 || value?.truncated ? '\n…' : '')));
  return td;
}
function renderDetail(data) {
  const detail = $('#detail'); detail.replaceChildren();
  const header = element('div', 'detail-header');
  header.append(element('div', 'eyebrow', 'FILE DETAILS'), element('h2', '', data.path));
  const summary = Object.entries(data.counts).filter(([, n]) => n).map(([k, n]) => `${labels[k]} ${fmt(n)}`).join(' · ');
  header.append(element('p', '', `${fmt(data.total)}개 차이 · ${summary}`)); detail.append(header);
  const note = element('p', 'detail-note', '행 번호는 각 원본 기준입니다. 배열의 [숫자]는 0부터 시작합니다. 변경 행을 선택하면 값 전체의 앞부분을 확인할 수 있습니다.'); detail.append(note);
  const wrapper = element('div', 'table-scroll'); const table = element('table', 'diff-table');
  table.innerHTML = '<thead><tr><th>변경 항목</th><th>이전 버전</th><th>최신 버전</th></tr></thead>';
  const tbody = element('tbody');
  for (const row of data.rows) {
    const tr = element('tr'); tr.tabIndex = 0;
    const path = element('td', 'path-cell'); path.append(element('span', `badge ${row.type}`, labels[row.type]), element('code', '', row.path), element('small', '', row.method || '키·값 기준'));
    tr.append(path, valueCell(row.old, 'old-value'), valueCell(row.latest, 'latest-value'));
    const activate = () => { for (const r of tbody.children) r.classList.remove('selected-row'); tr.classList.add('selected-row'); showSource(row); };
    tr.onclick = activate; tr.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }; tbody.append(tr);
  }
  table.append(tbody); wrapper.append(table); detail.append(wrapper);
  const pager = element('div', 'pager'); const prev = element('button', 'quiet', '← 이전'); const next = element('button', 'quiet', '다음 →');
  prev.disabled = data.offset === 0; next.disabled = data.offset + data.rows.length >= data.total;
  prev.onclick = () => selectFile(data.path, Math.max(0, data.offset - 50)); next.onclick = () => selectFile(data.path, data.offset + 50);
  pager.append(prev, element('span', '', `${fmt(data.offset + (data.total ? 1 : 0))}–${fmt(data.offset + data.rows.length)} / ${fmt(data.total)}`), next); detail.append(pager);
  const source = element('div', 'source'); source.id = 'source'; detail.append(source);
  if (tbody.firstChild) tbody.firstChild.click();
}
function showSource(row) {
  const source = $('#source'); source.replaceChildren();
  source.append(element('h3', '', '선택한 변경 값'), element('code', 'source-path', row.path));
  const grid = element('div', 'source-grid');
  for (const [value, label, cls] of [[row.old, '이전 버전', 'old-value'], [row.latest, '최신 버전', 'latest-value']]) {
    const box = element('div', `source-box ${cls}`); box.append(element('h4', '', `${label} · ${lineText(value)}`));
    const pre = element('pre');
    if (value) {
      const lines = value.value.split(/\r\n|\r|\n/);
      lines.forEach((line, index) => { const part = element('div', 'source-line'); part.append(element('span', '', String(value.line + index)), element('code', '', line)); pre.append(part); });
      if (value.truncated) pre.append(element('div', 'truncate-note', '… 큰 값은 앞 1,800자만 미리 표시합니다. 원본에서 나머지를 확인하세요.'));
    } else pre.textContent = '(항목 없음)';
    box.append(pre); grid.append(box);
  }
  source.append(grid);
}
$('#demo').onclick = () => {
  const file = (root, path, data) => { const f = new File([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], path.split('/').pop(), { type: 'application/json' }); Object.defineProperty(f, 'webkitRelativePath', { value: `${root}/${path}` }); return f; };
  assignFiles('old', [file('이전_예제', '전투/Monster.json', [{ ID: 1001, Name: '숲의 수호자', HP: 1200, Attack: 80 }, { ID: 1002, Name: '동굴 거미', HP: 350 }]), file('이전_예제', '아이템/Item.json', { ID: 5001, Name: '회복 물약', Amount: 50 }), file('이전_예제', '설정/Legacy.json', { Enabled: true }), file('이전_예제', '설정/Common.json', { A: 1, B: 2 })]);
  assignFiles('latest', [file('최신_예제', '전투/Monster.json', [{ ID: 1001, Name: '숲의 수호자', HP: 1500, Attack: 95 }, { ID: 1002, Name: '동굴 거미', HP: 350 }, { ID: 1003, Name: '모래 전갈', HP: 600 }]), file('최신_예제', '아이템/Item.json', { ID: 5001, Name: '회복 물약', Amount: 75 }), file('최신_예제', '설정/Event.json', { Enabled: true, Reward: 100 }), file('최신_예제', '설정/Common.json', '{"B":2,"A":1}')]);
  $('#compare').click();
};
