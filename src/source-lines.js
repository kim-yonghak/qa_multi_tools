// Index source lines in the worker; preserve original text and line numbering.
export function indexSource(text, range) {
  if (!range) return null;
  const { start, end, line } = range;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length || !Number.isInteger(line) || line < 1) throw new Error('원본 위치를 확인할 수 없습니다. 파일을 다시 선택하세요.');
  const starts = [start];
  for (let i = start; i < end; i++) {
    if (text[i] === '\r') { if (i + 1 < end && text[i + 1] === '\n') i++; starts.push(i + 1); }
    else if (text[i] === '\n') starts.push(i + 1);
  }
  return { text, starts, end, line };
}
export function sourceLines(source, start, count = 80) {
  if (!source) return [];
  const first = Math.max(0, Math.min(source.starts.length - 1, Math.floor(start) || 0));
  const last = Math.min(source.starts.length, first + Math.max(1, Math.min(120, Math.floor(count) || 80)));
  const rows = [];
  for (let i = first; i < last; i++) {
    let end = i + 1 < source.starts.length ? source.starts[i + 1] : source.end;
    if (i + 1 < source.starts.length) {
      if (source.text[end - 1] === '\n') end--;
      if (source.text[end - 1] === '\r') end--;
    }
    rows.push({ line: source.line + i, text: source.text.slice(source.starts[i], end) });
  }
  return rows;
}

// Literal, case-sensitive search over the entire selected value, not rendered rows.
export function countSourceMatches(source, query) {
  if (!source || !query) return 0;
  let count = 0, at = source.starts[0];
  while ((at = source.text.indexOf(query, at)) !== -1 && at + query.length <= source.end) { count++; at += query.length; }
  return count;
}
export function sourceMatch(source, query, ordinal) {
  if (!source || !query || !Number.isInteger(ordinal) || ordinal < 0) return null;
  let at = source.starts[0];
  for (let i = 0; i <= ordinal; i++) {
    at = source.text.indexOf(query, at);
    if (at < 0 || at + query.length > source.end) return null;
    if (i < ordinal) at += query.length;
  }
  let low = 0, high = source.starts.length;
  while (low + 1 < high) { const mid = (low + high) >>> 1; if (source.starts[mid] <= at) low = mid; else high = mid; }
  return { index: low, line: source.line + low, column: at - source.starts[low], length: query.length };
}
