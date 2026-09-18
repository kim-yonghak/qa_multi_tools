// Presentation only: preserve the comparison engine's original paths and values.
export const fileLabels = { modified: '내용 변경', added: '신규 파일', deleted: '삭제 파일', error: '오류', same: '동일 파일' };
export function wholeFileSummary(status) {
  return status === 'added' ? '신규 파일 · 전체 내용 추가' : status === 'deleted' ? '삭제 파일 · 전체 내용 삭제' : '';
}
const decode = value => {
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch {} }
  return value;
};

export function readablePath(path) {
  if (path === '$') return ['파일 전체'];
  if (!path?.startsWith('$')) return [path || '파일 전체'];
  const parts = [];
  let i = 1;
  while (i < path.length) {
    if (path[i] === '.') {
      const start = ++i;
      while (i < path.length && path[i] !== '.' && path[i] !== '[') i++;
      parts.push(`항목: ${path.slice(start, i)}`);
    } else if (path[i] === '[') {
      const start = ++i;
      let quoted = false, escaped = false;
      for (; i < path.length; i++) {
        const char = path[i];
        if (escaped) { escaped = false; continue; }
        if (quoted && char === '\\') { escaped = true; continue; }
        if (char === '"') quoted = !quoted;
        if (!quoted && char === ']') break;
      }
      if (i === path.length) return ['위치 표기 확인 필요'];
      const token = path.slice(start, i++);
      if (token.startsWith('"')) parts.push(`항목: ${decode(token)}`);
      else if (token.includes('=')) {
        const split = token.indexOf('=');
        parts.push(`${token.slice(0, split)}: ${decode(token.slice(split + 1))}`);
      } else if (/^\d+$/.test(token)) parts.push(`배열 위치: ${token}`);
      else if (/^이전 \d+ → 최신 \d+$/.test(token)) {
        const [, oldIndex, newIndex] = token.match(/^이전 (\d+) → 최신 (\d+)$/);
        parts.push(`배열 위치: 이전 ${oldIndex}, 최신 ${newIndex}`);
      } else if (/^(이전|최신) \d+$/.test(token)) {
        const [version, index] = token.split(' ');
        parts.push(`${version} 배열 위치: ${index}`);
      } else parts.push(`항목: ${token}`);
    } else return ['위치 표기 확인 필요'];
  }
  return parts.length ? parts : ['파일 전체'];
}
