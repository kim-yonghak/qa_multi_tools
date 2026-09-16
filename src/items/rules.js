// Authoritative mapping: user-supplied final rules, 2026-09-16.
// Do not derive codes from names or from older mappings.
export const PREFIX_CODES = Object.freeze({
  '초심자의':'20101','숙련자의':'20102','그을린':'20103','성터의':'20104','단단한':'20105','견고한':'20106','규율의':'20107',
  '개척자':'30101','여행자':'30102','달인의':'30103','경비대':'30104','정찰대':'30105','선봉대':'30106','수호의':'30107',
  '구속된 자의':'40101','검은 기운의':'40102','깊은 공허의':'40103','푸른 월광의':'40104','타락한 신념의':'40105','사나운 폭풍의':'40106','붉은 태양의':'40107','검은 오르의':'40108','황금피의':'40109','계승자의':'40110','연성 오르의':'40170',
  '섬광의':'45101','용맹의':'45301','시련의':'50100','아잠 히산':'50101','세라드':'50102','세르비스':'50103','잿빛 여명':'50104','검은 가시':'50105','엘 세라':'50106','크란시아':'50107','아이사':'50108','계승의':'50170',
  '계시의':'55101','결속의':'55201','동행의':'55202','진시르이':'55302','도약의':'50199',
  '세루스':'60101','에오스':'60102','페르녹스':'60103','오페르타':'60104','이니스':'60105','일리아나':'60106','창조의':'60170','은총의':'65101','테레노스의':'70101','정점의':'70170'
});
export const WEAPON_CODES = Object.freeze({
  '권갑':'1101','검/방패':'1110','워드럼':'1111','전투봉':'1112','전투 방패':'1120','대검':'1121','사이드':'1122','지팡이':'1123','단검':'1131','활':'1140','석궁':'1142'
});
// Explicit corrections supplied in the rule sheet or demonstrated by the input.
export const PREFIX_ALIASES = Object.freeze({'그을린의':'그을린','경속의':'결속의','초심자':'초심자의','숙련자':'숙련자의'});
const compact = s => String(s).normalize('NFC').replace(/\s+/gu, '');
const prefixByCompact = new Map(Object.keys(PREFIX_CODES).map(s => [compact(s), s]));
const aliasByCompact = new Map(Object.entries(PREFIX_ALIASES).map(([a,b]) => [compact(a),b]));
const weapons = Object.keys(WEAPON_CODES).sort((a,b) => compact(b).length - compact(a).length);
export const blank = value => value === undefined || value === null || String(value).trim() === '';

function enhancement(value) {
  const s = String(value).trim().replace(/^\+/, '');
  if (!/^\d+$/.test(s)) return { error: '강화수치는 0 이상의 정수로 입력하세요.' };
  return { value: BigInt(s).toString() };
}

export function convertItem(rawName, separateEnhancement) {
  const original = String(rawName ?? '');
  let name = original.normalize('NFC').trim();
  const notes = [];
  let inline;
  const ending = /(?:\s*\+\s*(\d+)|\s+(\d+))\s*$/.exec(name);
  if (ending) { inline = ending[1] ?? ending[2]; name = name.slice(0, ending.index).trim(); }
  let enh;
  if (!blank(separateEnhancement)) {
    enh = enhancement(separateEnhancement);
    if (!enh.error && inline !== undefined && enhancement(inline).value !== enh.value) notes.push(`이름의 +${inline} 대신 별도 셀 ${enh.value} 사용`);
  } else enh = enhancement(inline ?? '0');
  if (enh.error) return { ok:false, original, error:enh.error };
  const token = compact(name);
  const weapon = weapons.find(w => token.endsWith(compact(w)));
  if (!weapon) return { ok:false, original, error:'규칙표에 없는 무기 또는 아이템 명칭입니다.' };
  const prefixToken = token.slice(0, -compact(weapon).length);
  const prefix = prefixByCompact.get(prefixToken) ?? aliasByCompact.get(prefixToken);
  if (!prefix) return { ok:false, original, error:'규칙표에서 접두/이름을 확인할 수 없습니다. 코드를 생성하지 않았습니다.' };
  const canonical = `${prefix} ${weapon}`;
  if (name !== canonical) notes.push(`${name} → ${canonical}`);
  const code = WEAPON_CODES[weapon] + PREFIX_CODES[prefix];
  return { ok:true, original, canonical, code, enhancement:enh.value, notes, corrected:notes.length > 0 };
}

export function columnName(column) {
  let n = column + 1, value = '';
  while (n > 0) { n--; value = String.fromCharCode(65 + n % 26) + value; n = Math.floor(n / 26); }
  return value;
}
export function address(r, c) { return `${columnName(c)}${r + 1}`; }
export function parseAddress(value) {
  const m = /^\$?([A-Za-z]+)\$?([1-9]\d*)$/.exec(value.trim());
  if (!m) throw new Error('범위는 A1:L56처럼 입력하세요.');
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  const row = Number(m[2]);
  if (col > 16384 || row > 1048576) throw new Error('엑셀의 최대 행·열 범위를 벗어났습니다.');
  return { r:row - 1, c:col - 1 };
}
export function parseRange(value) {
  if (!value.trim()) return { r0:0, c0:0, r1:1048575, c1:16383 };
  const parts = value.split(':');
  if (parts.length > 2) throw new Error('범위는 A1:L56처럼 입력하세요.');
  const a = parseAddress(parts[0]), b = parseAddress(parts[1] || parts[0]);
  if (a.r > b.r || a.c > b.c) throw new Error('범위의 시작 셀은 끝 셀보다 앞에 있어야 합니다.');
  return { r0:a.r, c0:a.c, r1:b.r, c1:b.c };
}
export function gridToCells(grid) {
  const cells = [];
  grid.forEach((row,r) => row.forEach((value,c) => { if (!blank(value)) cells.push({r,c,value}); }));
  return cells;
}

export function convertCells(cells, { mode = 'pairs', range = '', sheetName = '' } = {}) {
  const bounds = parseRange(range);
  const selected = cells.filter(x => x.r >= bounds.r0 && x.r <= bounds.r1 && x.c >= bounds.c0 && x.c <= bounds.c1 && (!blank(x.value) || x.issue));
  const map = new Map(selected.map(cell => [`${cell.r},${cell.c}`, cell]));
  const positions = new Map();
  for (const cell of selected) {
    const c = mode === 'pairs' ? cell.c - (cell.c - bounds.c0) % 2 : cell.c;
    positions.set(`${cell.r},${c}`, {r:cell.r,c});
  }
  const rows = [];
  for (const {r,c} of [...positions.values()].sort((a,b) => a.r - b.r || a.c - b.c)) {
    const name = map.get(`${r},${c}`), enh = mode === 'pairs' ? map.get(`${r},${c + 1}`) : undefined;
    if (blank(name?.value) && !name?.issue && blank(enh?.value) && !enh?.issue) continue;
    let result;
    if (name?.issue || enh?.issue) result = {ok:false,original:String(name?.value ?? ''),error:name?.issue || enh?.issue};
    else if (blank(name?.value)) result = {ok:false,original:'',error:'아이템명 없이 강화수치만 있습니다.'};
    else result = convertItem(name.value, enh?.value);
    result.notes ??= [];
    if (name?.note) result.notes.push(name.note);
    if (enh?.note) result.notes.push(enh.note);
    rows.push({...result, number:rows.length+1, sheet:sheetName, cell:address(r,c), enhancementCell:mode === 'pairs' ? address(r,c+1) : '', inputEnhancement:String(enh?.value ?? '')});
  }
  const valid = rows.filter(x=>x.ok), errors = rows.filter(x=>!x.ok);
  return { rows, valid, errors, corrected:valid.filter(x=>x.corrected).length, tsv:valid.map(x=>`${x.code}\t${x.enhancement}`).join('\n') };
}

// Quoted TSV/CSV from Excel: preserve blank cells, newlines, and order.
export function parseDelimited(text, delimiter = '\t') {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\r' || ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
      if (ch === '\r' && text[i+1] === '\n') i++;
    } else cell += ch;
  }
  if (quoted) throw new Error('닫히지 않은 큰따옴표가 있습니다. 엑셀 셀을 다시 복사하세요.');
  row.push(cell); if (row.some(x=>!blank(x))) rows.push(row);
  return rows;
}
export function parsePasted(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).filter(x=>x.trim());
  if (lines.length && lines.every(x => /^\s*\|/.test(x) && /\|\s*$/.test(x))) {
    return lines.map(line => line.trim().slice(1,-1).split('|').map(x=>x.trim())).filter(row => !row.every(cell=>/^:?-{2,}:?$/.test(cell)));
  }
  return parseDelimited(text, '\t');
}
