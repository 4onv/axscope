import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonInput } from '../src/json-input.mjs';
import { parseCapture } from '../src/capture.mjs';

test('JSON reader preserves ordinary values and prototype-like keys as data', () => {
  const input = '{"__proto__":{"x":1},"list":[true,false,null,-1.25e2,"a\\nb\\\"c"]}';
  const result = parseJsonInput(input);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(result.__proto__.x, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), JSON.parse(input));
});

test('duplicate decoded keys, invalid values and excessive nesting are rejected', () => {
  for (const input of ['{"complete":false,"complete":true}', '{"x":{"name":"a","na\\u006de":"b"}}',
    '{"x":1,}', '[1,]', '01', '1e9999', '{"x":undefined}', '"bad\nstring"', 'true false',
    '['.repeat(302) + '0' + ']'.repeat(302)]) {
    assert.throws(() => parseJsonInput(input), /ambiguous JSON/, input);
  }
  assert.throws(() => parseJsonInput(' '.repeat(4 * 1024 * 1024 + 1)), /size/);
});

test('JSON nesting limit accommodates the full supported snapshot depth', () => {
  let tree = { role: 'button', name: 'Save' };
  for (let i = 0; i < 128; i++) tree = { role: 'group', children: [tree] };
  const input = { version: '2.6', ok: true, command: 'snapshot', data: { complete: true, tree } };
  assert.equal(parseCapture(parseJsonInput(JSON.stringify(input))).nodes.length, 129);
});
