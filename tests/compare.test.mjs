import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJSON, summarize } from '../src/compare.js';

const compare = (a, b, options = {}, offset = 0, limit = 100) => summarize(parseJSON(a), parseJSON(b), a, b, options, offset, limit);

test('ignore whitespace, object key order, numeric notation', () => {
  assert.equal(compare('{"x":1,"y":{"a":2,"b":3}}', '{\n"y":{"b":3.0,"a":2e0},"x":1.00}').total, 0);
});
test('unique ID prevents false changes after middle insertion', () => {
  const r = compare('[{"ID":1,"v":10},{"ID":3,"v":30}]', '[{"ID":1,"v":10},{"ID":2,"v":20},{"ID":3,"v":30}]');
  assert.equal(r.total, 1); assert.equal(r.rows[0].type, 'added'); assert.equal(r.rows[0].path, '$[ID=2]');
});
test('ID order changes are visible independently of changed values', () => {
  const r = compare('[{"ID":1,"v":10},{"ID":2,"v":20}]', '[{"ID":2,"v":25},{"ID":1,"v":10}]');
  assert.equal(r.counts.modified, 1); assert.equal(r.counts.reordered, 1);
});
test('duplicate IDs retain every occurrence', () => {
  const r = compare('[{"ID":1,"v":10},{"ID":1,"v":20}]', '[{"ID":1,"v":10},{"ID":1,"v":25}]');
  assert.equal(r.total, 1); assert.equal(r.rows[0].path, '$[1].v'); assert.match(r.rows[0].method, /중복/);
});
test('unkeyed middle insertion aligns equal neighboring objects', () => {
  const r = compare('[{"v":1},{"v":3}]', '[{"v":1},{"v":2},{"v":3}]');
  assert.equal(r.total, 1); assert.equal(r.rows[0].type, 'added');
});
test('raw line locations are tracked independently after inserted lines', () => {
  const r = compare('[\n {"ID":1,"v":10}\n]', '[\n\n\n {"ID":1,"v":20}\n]');
  assert.equal(r.rows[0].old.line, 2); assert.equal(r.rows[0].latest.line, 4);
});
test('unsafe integers remain distinct and type changes remain visible', () => {
  const r = compare('{"n":9007199254740992,"a":1}', '{"n":9007199254740993,"a":"1"}');
  assert.equal(r.total, 2);
});
test('large decimal exponents and signed zero compare exactly', () => {
  assert.equal(compare('[1e99999,-0,1000,0.001]', '[10e99998,0,1e3,1e-3]').total, 0);
});
test('duplicate JSON keys and malformed content are rejected', () => {
  for (const raw of ['{"a":1,"a":2}', '{"a":1,}', '[1,]', '01', 'NaN', '[', '{', '"bad\\x"', '"line\nbreak"']) assert.throws(() => parseJSON(raw));
});
test('UTF8 BOM and CRLF/CR are accepted with exact lines', () => {
  assert.equal(compare('\ufeff{\r\n"a":1\r\n}', '{\r"a":2\r}').rows[0].latest.line, 2);
});
test('prototype-like keys are ordinary data', () => {
  assert.equal(compare('{"__proto__":{"x":1}}', '{"__proto__":{"x":2}}').total, 1);
});
test('field deletion and field addition are separate', () => {
  const r = compare('{"before":null}', '{"after":false}');
  assert.equal(r.counts.added, 1); assert.equal(r.counts.deleted, 1);
});
test('pagination preserves exact total without storing all diff rows', () => {
  const a = JSON.stringify(Object.fromEntries(Array.from({length:200}, (_, i) => ['k'+i, 1])));
  const b = a.replaceAll(':1', ':2'); const r = compare(a, b, {}, 50, 50);
  assert.equal(r.total, 200); assert.equal(r.rows.length, 50); assert.equal(r.rows[0].path, '$.k50');
});
test('custom identity key matches records', () => {
  const r = compare('[{"Entry":1,"v":10}]', '[{"Entry":2,"v":5},{"Entry":1,"v":20}]', {idKey:'Entry'});
  assert.equal(r.counts.added, 1); assert.equal(r.counts.modified, 1);
});
test('ID label preserves non-scientific original number', () => {
  assert.equal(compare('[{"ID":1373510,"v":1}]', '[{"ID":1373510,"v":2}]').rows[0].path, '$[ID=1373510].v');
});
test('bounded alignment processes large unkeyed arrays', () => {
  const a = JSON.stringify(Array.from({length:600}, (_, i) => i));
  const b = JSON.stringify(Array.from({length:600}, (_, i) => i + 1000));
  assert.equal(compare(a, b).total, 600);
});
test('empty containers and null remain distinguishable', () => {
  assert.equal(compare('[{},[],null]', '[[],null,{}]').total > 0, true);
});
