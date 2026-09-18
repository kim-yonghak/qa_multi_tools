import { readablePath } from './json-display.js';
const node = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export function createSourceViewer(send) {
  const dialog = node('dialog', 'json-source-dialog');
  dialog.setAttribute('aria-labelledby', 'json-source-title');
  const head = node('div', 'json-source-head'), heading = node('h2', '', '전체 내용 보기'); heading.id = 'json-source-title';
  const close = node('button', 'quiet', '닫기'); close.type = 'button';
  head.append(heading, close);
  const description = node('p', 'json-source-description');
  const status = node('p', 'json-source-status'); status.setAttribute('role', 'status');
  const searchBar = node('div', 'json-source-search');
  const input = node('input'); input.type = 'search'; input.placeholder = '전체 내용 검색 · 아이템 ID, 이름, 항목명'; input.setAttribute('aria-label', '선택 항목 전체 내용 검색');
  const scope = node('select'); scope.setAttribute('aria-label', '검색 대상');
  for (const [value, label] of [['both', '이전·최신 모두'], ['old', '이전 버전'], ['latest', '최신 버전']]) { const option = node('option', '', label); option.value = value; scope.append(option); }
  scope.value = 'both';
  const find = node('button', 'quiet', '검색'), prev = node('button', 'quiet', '이전 결과'), next = node('button', 'quiet', '다음 결과');
  for (const button of [find, prev, next]) button.type = 'button';
  const searchStatus = node('p', 'json-source-search-status', '대소문자를 구분해 검색합니다. Enter: 다음 결과 · Shift+Enter: 이전 결과'); searchStatus.setAttribute('role', 'status');
  searchBar.append(input, scope, find, prev, next);
  const legend = node('div', 'json-source-legend'); legend.hidden = true;
  for (const [kind, label] of [['modified', '내용 변경'], ['added', '추가'], ['deleted', '삭제'], ['reordered', '순서 변경']]) legend.append(node('span', `json-legend-${kind}`, label));
  const grid = node('div', 'json-source-grid');
  dialog.append(head, description, status, searchBar, searchStatus, legend, grid); document.body.append(dialog);
  let token = 0, active = false, trigger = null;
  const panes = new Map();
  let ready = false, searchRequest = 0, searchIndex = 0, searchTotal = 0, hit = null, searchTimer = null, searchBusy = false;
  const controls = () => { input.disabled = scope.disabled = find.disabled = !ready; prev.disabled = next.disabled = !ready || searchBusy || !searchTotal; };
  function resetSearch() {
    clearTimeout(searchTimer); searchTimer = null; searchRequest++; searchIndex = searchTotal = 0; hit = null; searchBusy = false;
    input.value = ''; scope.value = 'both'; searchStatus.textContent = '대소문자를 구분해 검색합니다. Enter: 다음 결과 · Shift+Enter: 이전 결과'; controls();
  }
  function runSearch(index = 0) {
    clearTimeout(searchTimer); searchTimer = null;
    if (!active || !ready) return;
    searchRequest++; hit = null;
    if (!input.value) {
      searchTotal = 0; searchBusy = false; searchStatus.textContent = '검색어를 입력하세요. 대소문자를 구분합니다.'; controls();
      for (const pane of panes.values()) request(pane); return;
    }
    searchBusy = true; controls(); searchStatus.textContent = '화면 밖의 내용을 포함해 전체 원문 검색 중…';
    send({ type: 'source-search', token, request: searchRequest, query: input.value, scope: scope.value, index });
  }
  function queueSearch() {
    clearTimeout(searchTimer); searchRequest++; searchTotal = 0; hit = null; searchBusy = true; controls();
    searchStatus.textContent = input.value ? '검색 준비 중…' : '검색어를 입력하세요.';
    searchTimer = setTimeout(() => runSearch(0), 250);
  }
  input.addEventListener('input', queueSearch); scope.addEventListener('change', () => runSearch(0));
  find.onclick = () => runSearch(0); prev.onclick = () => runSearch(searchIndex - 1); next.onclick = () => runSearch(searchIndex + 1);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); if (!searchBusy || searchTimer) runSearch(searchTotal ? searchIndex + (event.shiftKey ? -1 : 1) : 0); }
  });
  dialog.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); input.focus(); input.select(); }
  });
  function jumpToHit() {
    const pane = panes.get(hit?.side); if (!pane) return;
    const height = pane.viewport.clientHeight || 360, maxTop = Math.max(0, pane.trackHeight - height);
    const first = Math.max(0, hit.index - 3);
    pane.viewport.scrollTop = pane.trackHeight < pane.meta.count * 24
      ? Math.min(maxTop, first / Math.max(1, pane.meta.count - Math.ceil(height / 24)) * maxTop)
      : Math.min(maxTop, first * 24);
    pane.revealHit = true;
    for (const item of panes.values()) request(item);
  }
  function cleanup() {
    if (!active) return;
    active = false; ready = false; resetSearch(); send({ type: 'source-close', token }); token++;
    grid.replaceChildren(); panes.clear(); trigger?.focus(); trigger = null;
  }
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', cleanup);
  function request(pane) {
    if (!active || !pane.meta) return;
    const height = pane.viewport.clientHeight || 360;
    const visible = Math.min(100, Math.ceil(height / 24) + 4);
    const maxTop = Math.max(0, pane.trackHeight - height);
    const top = Math.min(pane.viewport.scrollTop, maxTop);
    const first = pane.trackHeight < pane.meta.count * 24
      ? Math.floor((maxTop ? top / maxTop : 0) * Math.max(0, pane.meta.count - Math.ceil(height / 24)))
      : Math.floor(top / 24);
    pane.first = first; pane.top = top; pane.request++;
    pane.rows.replaceChildren();
    send({ type: 'source-lines', token, side: pane.side, start: first, count: visible, request: pane.request });
  }
  function makePane(side, label, meta) {
    const box = node('section', 'json-source-pane'), title = node('h3', '', label);
    box.append(title); grid.append(box);
    if (!meta) { box.append(node('p', 'json-source-missing', '항목 없음')); return; }
    box.append(node('p', 'json-source-range', `원본 ${meta.line.toLocaleString()}–${(meta.line + meta.count - 1).toLocaleString()}행 · ${meta.count.toLocaleString()}행 전체`));
    const viewport = node('div', 'json-source-viewport'); viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', `${label} 전체 내용`);
    const track = node('div', 'json-source-track'), rows = node('div', 'json-source-rows');
    const trackHeight = Math.min(8000000, meta.count * 24); track.style.height = `${trackHeight}px`;
    track.append(rows); viewport.append(track); box.append(viewport);
    const pane = { side, meta, viewport, rows, trackHeight, first: 0, top: 0, request: 0, width: 0 };
    panes.set(side, pane);
    viewport.addEventListener('scroll', () => request(pane)); request(pane);
  }
  window.addEventListener('resize', () => { if (active) for (const pane of panes.values()) request(pane); });
  return {
    open(path, row, button) {
      trigger = button; active = true; ready = false; resetSearch(); token++; panes.clear(); grid.replaceChildren();
      heading.textContent = row ? '전체 내용 보기' : '파일 원본 비교'; legend.hidden = true;
      description.textContent = row ? `${path} · ${readablePath(row.path).join(' / ')} · 선택한 변경 항목의 전체 내용` : `${path} · 변경되지 않은 내용을 포함한 이전·최신 원본 전체`;
      status.textContent = '전체 내용을 준비하고 있습니다…'; dialog.showModal(); close.focus();
      send({ type: 'source-open', token, path, mode: row ? 'selection' : 'file', old: row?.old, latest: row?.latest });
    },
    close() { if (dialog.open) dialog.close(); cleanup(); },
    handle(data) {
      if (!active || data.token !== token) return;
      if (data.type === 'source-ready') {
        status.textContent = '선택한 항목의 전문입니다. 화면 밖 내용도 위 검색창으로 찾을 수 있습니다. Ctrl+F로 검색창을 선택하세요.';
        if (data.mode === 'file') {
          legend.hidden = false;
          status.textContent = `${data.changes ? `전체 ${data.changes.toLocaleString()}건의 변경을 원본 행에 음영으로 표시합니다.` : '데이터가 동일합니다. 변경 음영 없이 양쪽 원본을 표시합니다.'} 행 번호와 줄 배치는 각 원본 기준이며, 동일 행의 일부만 달라져도 해당 행 전체에 음영이 표시됩니다. 전체 원문 검색: Ctrl+F`;
        }
        ready = true; controls();
        grid.replaceChildren(); makePane('old', '이전 버전', data.old); makePane('latest', '최신 버전', data.latest);
      } else if (data.type === 'source-search') {
        if (data.request !== searchRequest) return;
        searchBusy = false; searchIndex = data.index; searchTotal = data.total; hit = data.hit; controls();
        searchStatus.textContent = hit ? `${(data.index + 1).toLocaleString()} / ${data.total.toLocaleString()}건 · ${hit.side === 'old' ? '이전 버전' : '최신 버전'} 원본 ${hit.line.toLocaleString()}행 · 대소문자 구분` : '일치하는 내용이 없습니다. 대소문자를 확인하세요.';
        if (hit) jumpToHit(); else for (const pane of panes.values()) request(pane);
      } else if (data.type === 'source-lines') {
        const pane = panes.get(data.side); if (!pane || pane.request !== data.request) return;
        const fragment = document.createDocumentFragment();
        for (const row of data.rows) {
          const line = node('div', `json-source-line${row.change ? ' json-line-' + row.change : ''}`);
          if (row.change) line.title = ({modified:'내용 변경',added:'추가',deleted:'삭제',reordered:'순서 변경'})[row.change];
          const text = node('span', 'json-source-text');
          if (hit && hit.side === data.side && hit.line === row.line) {
            const mark = node('mark', 'json-source-hit', row.text.slice(hit.column, hit.column + hit.length));
            text.append(node('span', '', row.text.slice(0, hit.column)), mark, node('span', '', row.text.slice(hit.column + hit.length)));
          } else text.textContent = row.text;
          line.append(node('span', 'json-source-number', row.line.toLocaleString()), text); fragment.append(line);
        }
        pane.rows.replaceChildren(fragment); pane.rows.style.top = `${pane.top}px`;
        // Retain the longest encountered width so horizontal scrolling stays stable.
        pane.width = Math.max(pane.width, pane.rows.scrollWidth); pane.rows.style.minWidth = `${pane.width}px`;
        if (pane.revealHit) { const mark = pane.rows.querySelector('mark'); if (mark) { pane.revealHit = false; pane.viewport.scrollLeft = Math.max(0, mark.offsetLeft - pane.viewport.clientWidth / 2); } }
      } else if (data.type === 'source-error') {
        if (data.operation === 'source-search') { if (data.request !== searchRequest) return; searchBusy = false; searchTotal = 0; controls(); searchStatus.textContent = `검색 실패: ${data.error}`; }
        else status.textContent = `전체 내용을 불러오지 못했습니다: ${data.error}`;
      }
    }
  };
}
