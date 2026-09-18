import { differences, excerpt } from './compare.js';

function compactChange(d) {
  if (!['modified', 'added', 'deleted'].includes(d.type)) return null;
  const match = /\.([A-Za-z_$][\w$]*)$/.exec(d.path) || /\[("(?:\\.|[^"\\])*")\]$/.exec(d.path);
  if (!match) return null;
  const field = match[1].startsWith('"') ? JSON.parse(match[1]) : match[1];
  const values = [d.a, d.b].filter(Boolean);
  if (!values.length || values.some(n => !['string', 'number', 'boolean', 'null'].includes(n.kind))) return null;
  if (values.some(n => n.kind === 'string' && (n.value.length > 160 || /[\r\n]/.test(n.value)))) return null;
  if (d.a?.kind === 'string' && d.b?.kind === 'string') {
    const before = d.a.value, after = d.b.value;
    let left = 0, a = before.length, b = after.length;
    while (left < a && left < b && before[left] === after[left]) left++;
    while (a > left && b > left && before[a - 1] === after[b - 1]) { a--; b--; }
    const removed = before.slice(left, a), added = after.slice(left, b);
    if (Math.max(removed.length, added.length) > 20 || /\s/.test(removed + added)) return null;
  }
  // Exact types and source values distinguish 0, "0", false, null and absence.
  const identity = node => node ? [node.kind, node.kind === 'string' ? node.value : node.raw] : ['missing'];
  const display = node => !node ? '(항목 없음)' : node.kind === 'string' ? JSON.stringify(node.value) : node.raw;
  return { key: JSON.stringify([field, d.type, identity(d.a), identity(d.b)]), type: d.type, field, before: display(d.a), after: display(d.b) };
}
export function buildReview(a, b, textA, textB, options = {}) {
  const entries = [], candidates = new Map(), counts = { added: 0, deleted: 0, modified: 0, reordered: 0 };
  for (const d of differences(a, b, options)) {
    counts[d.type]++;
    const compact = compactChange(d);
    if (compact) {
      let group = candidates.get(compact.key);
      if (!group) { group = { id: `g${candidates.size}`, type: compact.type, field: compact.field, before: compact.before, after: compact.after, count: 0, paths: [] }; candidates.set(compact.key, group); }
      group.count++; if (group.paths.length < 3) group.paths.push(d.path);
      d.compact = group;
    }
    entries.push(d);
  }
  const groups = [...candidates.values()].filter(g => g.count >= 3).sort((a, b) => b.count - a.count);
  const groupedCount = groups.reduce((sum, group) => sum + group.count, 0);
  return { entries, counts, groups, groupedCount, total: entries.length };
}
export function reviewPage(review, textA, textB, { mode = 'main', groupId = null, changeType = 'all', offset = 0, limit = 50 } = {}) {
  const isGrouped = d => d.compact?.count >= 3;
  const type = ['modified', 'added', 'deleted', 'reordered'].includes(changeType) ? changeType : 'all';
  const matchesType = d => type === 'all' || d.type === type;
  const filtered = review.entries.filter(matchesType);
  const groups = review.groups.filter(matchesType);
  const groupedCount = groups.reduce((sum, group) => sum + group.count, 0);
  const selected = filtered.filter(d => mode === 'all' || (mode === 'group' ? isGrouped(d) && d.compact.id === groupId : !isGrouped(d)));
  const size = Math.max(1, Math.min(100, Number(limit) || 50));
  const start = Math.max(0, Math.min(Math.floor((Number(offset) || 0) / size) * size, Math.max(0, Math.ceil(selected.length / size) - 1) * size));
  const rows = selected.slice(start, start + size).map(d => ({ type: d.type, path: d.path, method: d.method, old: excerpt(textA, d.a), latest: excerpt(textB, d.b) }));
  return { total: review.total, counts: review.counts, groups, groupedCount, changeType: type, filteredTotal: filtered.length, listTotal: selected.length, offset: start, mode, groupId, rows };
}
// Merge source-line intervals without creating a per-line array for large files.
export function reviewHighlights(review, side) {
  const key = side === 'old' ? 'a' : 'b', events = [];
  const priority = ['modified', 'deleted', 'added', 'reordered'];
  for (const d of review.entries) {
    const value = d[key]; if (!value) continue;
    events.push({ line: value.line, type: d.type, delta: 1 }, { line: value.endLine + 1, type: d.type, delta: -1 });
  }
  events.sort((a, b) => a.line - b.line);
  const active = { modified: 0, deleted: 0, added: 0, reordered: 0 }, ranges = [];
  let previous = 0, i = 0;
  while (i < events.length) {
    const line = events[i].line, type = priority.find(type => active[type] > 0);
    if (type && previous < line) {
      const last = ranges.at(-1);
      if (last?.type === type && last.end + 1 === previous) last.end = line - 1;
      else ranges.push({ start: previous, end: line - 1, type });
    }
    while (i < events.length && events[i].line === line) { active[events[i].type] += events[i].delta; i++; }
    previous = line;
  }
  return ranges;
}
export function lineHighlight(ranges, line) {
  let low = 0, high = ranges.length;
  while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid].end < line) low = mid + 1; else high = mid; }
  return ranges[low]?.start <= line ? ranges[low].type : null;
}
