import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, suggest } from '../src/engine.mjs';

const deleteButton = { role: 'button', name: 'Delete' };
const files = { role: 'group', name: 'Files' };
const messages = { role: 'group', name: 'Messages' };
const window = { role: 'window', name: 'Editor' };
const root = { ...window, parent: -1 };

function capture(nodes, complete = true) {
  return { complete, nodes };
}
function contract(...targets) {
  return { version: 1, targets };
}
function target(id, selector = deleteButton, within) {
  return within ? { id, ...selector, within } : { id, ...selector };
}
function firstRow(entry, ...captures) {
  return evaluate(contract(entry), captures).targets[0].results;
}

const base = capture([root, { ...files, parent: 0 }, { ...deleteButton, parent: 1 }]);
const expanded = capture([
  root,
  { ...messages, parent: 0 },
  { ...files, parent: 0 },
  { ...deleteButton, parent: 1 },
  { ...deleteButton, parent: 2 },
]);

test('matrix distinguishes uniqueness, ambiguity, and missing controls in capture order', () => {
  const removed = capture([root, { ...files, parent: 0 }]);
  const result = evaluate(contract(target('global'), target('file-delete', deleteButton, files)), [base, expanded, removed]);
  assert.equal(result.status, 'review');
  assert.equal(result.version, 1);
  assert.deepEqual(result.targets, [
    { id: 'global', results: [
      { status: 'unique', matches: 1, scopes: null },
      { status: 'ambiguous', matches: 2, scopes: null },
      { status: 'missing', matches: 0, scopes: null },
    ] },
    { id: 'file-delete', results: [
      { status: 'unique', matches: 1, scopes: 1 },
      { status: 'unique', matches: 1, scopes: 1 },
      { status: 'missing', matches: 0, scopes: 1 },
    ] },
  ]);
});

test('scoped searches fail on missing or duplicate scope even when only one observed child matches', () => {
  const duplicate = capture([...base.nodes, { ...files, parent: 0 }]);
  const absent = capture([root, { ...deleteButton, parent: 0 }]);
  assert.deepEqual(firstRow(target('save', deleteButton, files), duplicate, absent), [
    { status: 'scope-ambiguous', matches: null, scopes: 2 },
    { status: 'scope-missing', matches: null, scopes: 0 },
  ]);
});

test('subtree ranges exclude the scope itself and include only strict descendants', () => {
  const reordered = capture([
    root, { ...files, parent: 0 }, { role: 'group', name: 'Trash', parent: 0 },
    { role: 'group', name: 'Inner', parent: 1 }, { role: 'button', name: 'Other', parent: 2 },
    { ...deleteButton, parent: 3 },
  ]);
  const result = evaluate(contract(
    target('nested', deleteButton, files),
    target('outside', { role: 'button', name: 'Other' }, files),
    target('self', files, files),
  ), [reordered]);
  assert.deepEqual(result.targets.map(row => row.results[0].matches), [1, 0, 0]);
});

test('partial observation always requires review and reports only observed counts', () => {
  const partial = { ...base, complete: false };
  const result = evaluate(contract(
    target('present'),
    target('absent', { role: 'button', name: 'Open' }),
    target('unseen-scope', deleteButton, messages),
  ), [partial]);
  assert.equal(result.status, 'review');
  assert.deepEqual(result.targets.map(row => row.results[0]), [
    { status: 'incomplete', matches: 1, scopes: null },
    { status: 'incomplete', matches: 0, scopes: null },
    { status: 'incomplete', matches: null, scopes: 0 },
  ]);
  assert.deepEqual(suggest(deleteButton, [expanded, partial]), { status: 'incomplete', scopes: [], truncated: false });
});

test('scope suggestions survive changed node ids, sibling ordering and an extra duplicate in another region', () => {
  const rotated = capture([
    { ...root, ref_id: 'new-9' },
    { ...messages, parent: 0, ref_id: 'new-2' },
    { ...deleteButton, parent: 1, ref_id: 'new-8' },
    { ...files, parent: 0, ref_id: 'new-4' },
    { ...deleteButton, parent: 3, ref_id: 'new-1' },
  ]);
  assert.deepEqual(suggest(deleteButton, [base, rotated]), {
    status: 'scopes-found', scopes: [files], truncated: false,
  });
  const chosen = evaluate(contract(target('delete-file', deleteButton, files)), [base, rotated]);
  assert.equal(chosen.status, 'pass');
  assert.doesNotMatch(JSON.stringify(chosen), /Files|Messages|new-9|Delete/);
});

test('offers each viable semantic scope instead of picking one of two different controls', () => {
  assert.deepEqual(suggest(deleteButton, [expanded, expanded]), {
    status: 'scopes-found', scopes: [files, messages], truncated: false,
  });
  const bothInFiles = capture([...base.nodes, { ...deleteButton, parent: 1 }]);
  assert.equal(suggest(deleteButton, [base, bothInFiles]).status, 'no-common-scope');
  assert.equal(suggest(deleteButton, [base, capture([root])]).status, 'no-common-scope');
  assert.equal(suggest(deleteButton, [base, base]).status, 'already-unique');
});

test('scope suggestions have deterministic ordinal order and an explicit cap', () => {
  const nodes = [root];
  for (let i = 0; i < 25; i++) {
    const parent = nodes.length;
    nodes.push({ role: 'group', name: String(24 - i).padStart(2, '0'), parent: 0 });
    nodes.push({ ...deleteButton, parent });
  }
  const result = suggest(deleteButton, [capture(nodes)]);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.scopes.map(scope => scope.name), Array.from({ length: 20 }, (_, i) => String(i).padStart(2, '0')));
});

test('literals preserve Unicode, whitespace and case and do not use arbitrary node fields', () => {
  const doc = capture([root,
    { role: 'button', name: ' Déplacer ', parent: 0 },
    { role: 'button', name: null, value: 'Delete', description: 'Delete', parent: 0 },
    { role: 'button', name: '__proto__', parent: 0 },
  ]);
  const selectors = [
    { role: 'button', name: ' Déplacer ' }, { role: 'button', name: 'Déplacer' },
    { role: 'button', name: ' déplacer ' }, deleteButton, { role: 'button', name: '__proto__' },
  ];
  assert.deepEqual(evaluate(contract(...selectors.map((item, i) => target(String(i), item))), [doc])
    .targets.map(row => row.results[0].matches), [1, 0, 0, 0, 1]);
});

test('invalid contract or selector input fails explicitly without disclosing values', () => {
  for (const bad of [
    { version: 2, targets: [target('a')] },
    { version: 1, targets: [] },
    contract(target('same'), target('same')),
    contract({ id: 'x', ...deleteButton, scope: files }),
    contract({ id: 'bad\nid', ...deleteButton }),
    contract({ id: 'x', ...deleteButton, within: null }),
    contract({ id: 'x', role: 'button', name: ' ' }),
    contract({ id: 'x', role: 'button', name: 'secret\u0000value' }),
    contract({ id: 'x', ...deleteButton, within: { ...files, nth: 0 } }),
    { version: 1, targets: [target('a')], ignoreFailures: true },
  ]) {
    assert.throws(() => evaluate(bad, [base]), error => !/secret/.test(error.message));
  }
  assert.throws(() => suggest({ ...deleteButton, nth: 0 }, [base]));
});

test('invalid normalized captures fail even after an incomplete capture', () => {
  const badCaptures = [
    capture([]),
    capture([{ ...root, parent: 0 }]),
    capture([root, { ...files, parent: -1 }]),
    capture([root, { ...files, parent: 2 }, { ...deleteButton, parent: 1 }]),
    capture([root, { role: 'button', name: 42, parent: 0 }]),
    { nodes: [root] },
    capture(Array.from({ length: 131 }, (_, i) => ({ ...files, parent: i - 1 }))),
  ];
  for (const invalid of badCaptures) {
    assert.throws(() => evaluate(contract(target('a')), [invalid]));
    assert.throws(() => suggest(deleteButton, [{ ...base, complete: false }, invalid]));
  }
  for (const count of [0, 13]) assert.throws(() => evaluate(contract(target('a')), Array(count).fill(base)));
});
