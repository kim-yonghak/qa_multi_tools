// Numeric-only substitution: item names and spreadsheet text never become Python source.
export function buildMacroPython(template, rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('다운로드할 정상 항목이 없습니다.');
  const codes = [], enhancements = [];
  for (const row of rows) {
    if (!row.ok || !/^[0-9]{9}$/.test(row.code) || !/^(0|[1-9][0-9]*)$/.test(row.enhancement)) {
      throw new Error('매크로 데이터 형식이 올바르지 않습니다. 다시 변환하세요.');
    }
    codes.push(row.code); enhancements.push(row.enhancement);
  }
  for (const marker of ['__QA_ITEM_CODES__', '__QA_ENHANCEMENTS__']) {
    if (template.split(marker).length !== 2) throw new Error('매크로 템플릿을 확인할 수 없습니다. 서버를 재시작하고 새로고침하세요.');
  }
  return template.replace('__QA_ITEM_CODES__', codes.join('\n')).replace('__QA_ENHANCEMENTS__', enhancements.join('\n'));
}

export async function loadMacroTemplate() {
  const response = await fetch(new URL('./macro-template.py', import.meta.url), {cache:'no-store'});
  if (!response.ok) throw new Error('매크로 파일을 읽지 못했습니다. 새 server.mjs로 서버를 재시작하세요.');
  return response.text();
}
