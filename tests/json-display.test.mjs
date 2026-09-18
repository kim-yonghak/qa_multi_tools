import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readablePath, wholeFileSummary, fileLabels } from '../src/json-display.js';
import { parseJSON, summarize } from '../src/compare.js';

test('root and file lifecycle wording distinguish files from internal items', () => {
  assert.deepEqual(readablePath('$'), ['파일 전체']);
  assert.equal(wholeFileSummary('added'), '신규 파일 · 전체 내용 추가');
  assert.equal(wholeFileSummary('deleted'), '삭제 파일 · 전체 내용 삭제');
  assert.equal(wholeFileSummary('modified'), '');
  assert.equal(fileLabels.modified, '내용 변경');
});
test('ID and nested field locations remain readable without path punctuation', () => {
  assert.deepEqual(readablePath('$[ID=3069]'), ['ID: 3069']);
  assert.deepEqual(readablePath('$.Items[ID=3069].Name'), ['항목: Items', 'ID: 3069', '항목: Name']);
  assert.deepEqual(readablePath('$[ID=90071992547409931234]'), ['ID: 90071992547409931234']);
});
test('literal punctuation in actual keys and string IDs is preserved', () => {
  assert.deepEqual(readablePath('$["이름.속성"][ID="a]b=c.$"]["가격$"]'), ['항목: 이름.속성', 'ID: a]b=c.$', '항목: 가격$']);
  const id='quote"slash\\end]';
  assert.deepEqual(readablePath(`$[Key=${JSON.stringify(id)}].Amount`), [`Key: ${id}`, '항목: Amount']);
});
test('array indexes preserve zero-based positions and old/latest distinction', () => {
  assert.deepEqual(readablePath('$[0]'), ['배열 위치: 0']);
  assert.deepEqual(readablePath('$[이전 2]'), ['이전 배열 위치: 2']);
  assert.deepEqual(readablePath('$[최신 3]'), ['최신 배열 위치: 3']);
  assert.deepEqual(readablePath('$[이전 2 → 최신 3]'), ['배열 위치: 이전 2, 최신 3']);
});
test('actual comparison output yields readable added ID without changing raw result', () => {
  const a='[{"ID":1,"Name":"old"}]',b='[{"ID":1,"Name":"old"},{"ID":3069,"Name":"new"}]';
  const result=summarize(parseJSON(a),parseJSON(b),a,b,{},0,10);
  assert.equal(result.rows[0].type,'added');
  assert.deepEqual(readablePath(result.rows[0].path),['ID: 3069']);
  assert.equal(result.rows[0].path,'$[ID=3069]');
});
