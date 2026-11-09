import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseJsonInput, parseCapture, evaluate } from '@4onv/axscope';
test('public reader preserves capture evidence through the complete library pipeline',async()=>{
  const capture=parseCapture(parseJsonInput(await readFile(new URL('../examples/editor.json',import.meta.url),'utf8')));
  const contract=parseJsonInput(await readFile(new URL('../examples/scoped.json',import.meta.url),'utf8'));
  assert.equal(evaluate(contract,[capture]).status,'pass');
  for(const text of ['{"complete":false,"complete":true}','{"a":1,"\\u0061":2}','{"n":1e999}'])assert.throws(()=>parseJsonInput(text),/Invalid or ambiguous/);
  assert.throws(()=>parseJsonInput(' '.repeat(4*1024*1024+1)),/size/);
  assert.equal(Object.getPrototypeOf(parseJsonInput('{"__proto__":{}}')),null);
});
