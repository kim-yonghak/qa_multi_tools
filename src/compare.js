// Lossless JSON parser: retain source locations and exact decimal values.
export function decimalKey(raw) {
  let [base, exp = '0'] = raw.toLowerCase().split('e');
  const negative = base.startsWith('-');
  base = base.replace(/^-/, '');
  const dot = base.indexOf('.');
  let power = BigInt(exp) - BigInt(dot < 0 ? 0 : base.length - dot - 1);
  let digits = base.replace('.', '').replace(/^0+/, '');
  if (!digits) return '0';
  const trailing = digits.match(/0+$/)?.[0].length || 0;
  if (trailing) { digits = digits.slice(0, -trailing); power += BigInt(trailing); }
  return `${negative ? '-' : ''}${digits}e${power}`;
}

export function parseJSON(text) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  const fail = message => { throw new Error(`${line}행: ${message}`); };
  function space() {
    while (i < text.length && /[ \t\r\n]/.test(text[i])) {
      if (text[i] === '\n' || (text[i] === '\r' && text[i + 1] !== '\n')) line++;
      i++;
    }
  }
  function string() {
    const begin = i++;
    while (i < text.length) {
      const ch = text[i++];
      if (ch === '"') {
        try { return JSON.parse(text.slice(begin, i)); }
        catch { fail('문자열 또는 이스케이프가 올바르지 않습니다.'); }
      }
      if (ch.charCodeAt(0) < 32) fail('문자열 안에 허용되지 않는 제어 문자가 있습니다.');
      if (ch === '\\') i++;
    }
    fail('문자열이 닫히지 않았습니다.');
  }
  function value(depth = 0) {
    if (depth > 512) fail('중첩 깊이가 512를 초과합니다.');
    space();
    const node = { start: i, line, end: i, endLine: line };
    const ch = text[i];
    if (ch === '{') {
      node.kind = 'object'; node.children = new Map(); i++; space();
      if (text[i] !== '}') while (true) {
        if (text[i] !== '"') fail('객체의 키는 큰따옴표 문자열이어야 합니다.');
        const key = string();
        if (node.children.has(key)) fail(`중복 객체 키: ${key}`);
        space(); if (text[i++] !== ':') fail('키 뒤에 콜론(:)이 필요합니다.');
        node.children.set(key, value(depth + 1)); space();
        if (text[i] === '}') break;
        if (text[i++] !== ',') fail('객체 항목 사이에 쉼표가 필요합니다.');
        space();
      }
      i++;
    } else if (ch === '[') {
      node.kind = 'array'; node.children = []; i++; space();
      if (text[i] !== ']') while (true) {
        node.children.push(value(depth + 1)); space();
        if (text[i] === ']') break;
        if (text[i++] !== ',') fail('배열 항목 사이에 쉼표가 필요합니다.');
        space();
      }
      i++;
    } else if (ch === '"') {
      node.kind = 'string'; node.value = string();
    } else {
      const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
      if (!match) fail('올바른 JSON 값이 필요합니다.');
      const raw = match[0]; i += raw.length;
      node.kind = raw === 'null' ? 'null' : /^(true|false)$/.test(raw) ? 'boolean' : 'number';
      node.value = node.kind === 'number' ? decimalKey(raw) : raw;
      node.raw = raw;
    }
    node.end = i; node.endLine = line;
    return node;
  }
  const root = value(); space();
  if (i !== text.length) fail('JSON 값 뒤에 불필요한 문자가 있습니다.');
  return root;
}

export function equal(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'object') {
    if (a.children.size !== b.children.size) return false;
    for (const [key, val] of a.children) if (!b.children.has(key) || !equal(val, b.children.get(key))) return false;
    return true;
  }
  if (a.kind === 'array') return a.children.length === b.children.length && a.children.every((v, i) => equal(v, b.children[i]));
  return a.value === b.value;
}

const fieldPath = (path, key) => /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
const scalarKey = n => n && ['number', 'string'].includes(n.kind) ? `${n.kind}:${n.value}` : null;
function uniqueMap(nodes, key) {
  const out = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind !== 'object') return null;
    const id = scalarKey(node.children.get(key));
    if (id === null || out.has(id)) return null;
    out.set(id, { node, index: i, idNode: node.children.get(key) });
  }
  return out;
}
function findIdentity(a, b, options) {
  if (options.arrayMode === 'sequence' || !a.length || !b.length) return null;
  const candidates = options.idKey ? [options.idKey] : ['ID', 'Id', 'id', 'Index', 'index', 'GUID', 'Guid', 'guid', 'Key', 'key'];
  for (const key of candidates) {
    const left = uniqueMap(a, key), right = uniqueMap(b, key);
    if (left && right) return { key, left, right };
  }
  return null;
}
function canonical(node) {
  if (node.kind === 'object') return '{' + [...node.children.keys()].sort().map(k => JSON.stringify(k) + ':' + canonical(node.children.get(k))).join(',') + '}';
  if (node.kind === 'array') return '[' + node.children.map(canonical).join(',') + ']';
  return node.kind + ':' + JSON.stringify(node.value);
}

// Every difference preserves independent old/new source nodes.
export function* differences(a, b, options = {}, path = '$', method = '') {
  if (!a) { yield { type: 'added', path, a, b, method }; return; }
  if (!b) { yield { type: 'deleted', path, a, b, method }; return; }
  if (a.kind !== b.kind) { yield { type: 'modified', path, a, b, method }; return; }
  if (a.kind === 'object') {
    for (const [key, val] of a.children) yield* differences(val, b.children.get(key), options, fieldPath(path, key), method);
    for (const [key, val] of b.children) if (!a.children.has(key)) yield* differences(undefined, val, options, fieldPath(path, key), method);
  } else if (a.kind === 'array') {
    if (equal(a, b)) return;
    const aa = a.children, bb = b.children;
    const identity = findIdentity(aa, bb, options);
    if (identity) {
      const { key, left, right } = identity;
      const label = entry => entry.idNode.kind === 'string' ? JSON.stringify(entry.idNode.value) : entry.idNode.raw;
      for (const [id, entry] of left) yield* differences(entry.node, right.get(id)?.node, options, `${path}[${key}=${label(entry)}]`, `${key} 기준`);
      for (const [id, entry] of right) if (!left.has(id)) yield* differences(undefined, entry.node, options, `${path}[${key}=${label(entry)}]`, `${key} 기준`);
      const oldOrder = [...left.keys()].filter(id => right.has(id));
      const newOrder = [...right.keys()].filter(id => left.has(id));
      if (oldOrder.some((id, i) => id !== newOrder[i])) yield { type: 'reordered', path, a, b, method: `${key} 기준 · 공통 항목 순서 변경` };
      return;
    }
    const note = '순서·내용 기준 (고유 키 없음 또는 중복)';
    let start = 0, endA = aa.length, endB = bb.length;
    while (start < endA && start < endB && equal(aa[start], bb[start])) start++;
    while (endA > start && endB > start && equal(aa[endA - 1], bb[endB - 1])) { endA--; endB--; }
    const n = endA - start, m = endB - start;
    // Align unchanged items first. Bound the quadratic work for very large arrays.
    let anchors = [];
    if (n * m <= 250000 && n && m) {
      const x = aa.slice(start, endA).map(canonical), y = bb.slice(start, endB).map(canonical);
      const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (x[i] === y[j]) { anchors.push([start + i++, start + j++]); }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
      }
    }
    anchors.push([endA, endB]);
    let ia = start, ib = start;
    for (const [ea, eb] of anchors) {
      const countA = ea - ia, countB = eb - ib;
      if (countA === countB) {
        for (let k = 0; k < countA; k++) {
          const suffix = ia + k === ib + k ? `[${ia + k}]` : `[이전 ${ia + k} → 최신 ${ib + k}]`;
          yield* differences(aa[ia + k], bb[ib + k], options, path + suffix, n * m > 250000 ? note + ' · 대형 배열 위치 비교' : note);
        }
      } else {
        // No reliable 1:1 identity: preserve complete removals/additions, never guess.
        for (let k = ia; k < ea; k++) yield* differences(aa[k], undefined, options, `${path}[이전 ${k}]`, note);
        for (let k = ib; k < eb; k++) yield* differences(undefined, bb[k], options, `${path}[최신 ${k}]`, note);
      }
      ia = ea + 1; ib = eb + 1;
    }
  } else if (a.value !== b.value) yield { type: 'modified', path, a, b, method };
}

export function excerpt(text, node) {
  if (!node) return null;
  const cap = 1800;
  const raw = text.slice(node.start, Math.min(node.end, node.start + cap));
  return { start: node.start, end: node.end, line: node.line, endLine: node.endLine, value: raw, truncated: node.end - node.start > cap };
}
export function summarize(a, b, textA, textB, options = {}, offset = 0, limit = 0) {
  const counts = { added: 0, deleted: 0, modified: 0, reordered: 0 };
  const rows = [];
  let total = 0;
  for (const d of differences(a, b, options)) {
    counts[d.type]++;
    if (total >= offset && rows.length < limit) rows.push({ type: d.type, path: d.path, method: d.method, old: excerpt(textA, d.a), latest: excerpt(textB, d.b) });
    total++;
  }
  return { total, counts, rows };
}
