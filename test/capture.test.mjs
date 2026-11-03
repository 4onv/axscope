import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCapture } from '../src/capture.mjs';

function envelope(tree, data = {}) {
  return { version: '2.6', ok: true, command: 'snapshot', data: { tree, complete: true, ...data } };
}

test('normalization preserves ordered ancestry and only the matching fields', () => {
  const capture = envelope({
    role: 'window', name: 'Notes', ref_id: '@old:e3',
    children: [
      { role: 'group', description: 'private-description', children: [
        { role: 'button', name: ' Save ', ref_id: '@old:e20', value: 'private-value' },
        { role: 'button', name: '', bounds: { x: 120 } },
      ] },
      { role: 'textfield', name: null, value: 'private-field' },
    ],
  }, { app: 'private-app', snapshot_id: 'private-id' });
  const tree = parseCapture(capture);
  assert.deepEqual(tree, {
    complete: true, reasons: [], nodes: [
      { role: 'window', name: 'Notes', parent: -1 },
      { role: 'group', name: null, parent: 0 },
      { role: 'button', name: ' Save ', parent: 1 },
      { role: 'button', name: '', parent: 1 },
      { role: 'textfield', name: null, parent: 0 },
    ],
  });
  assert.doesNotMatch(JSON.stringify(tree), /private-|@old|bounds/);
});

test('partial and unproven captures keep observable nodes and report each reason once', () => {
  const input = envelope({ role: 'group', subtree_truncated: true, children: [
    { role: 'button', name: 'Save', subtree_truncated: true },
  ] }, { complete: false, truncated: true, identity_unproven: true });
  const tree = parseCapture(input);
  assert.equal(tree.complete, false);
  assert.equal(tree.nodes.length, 2);
  assert.deepEqual(tree.reasons, ['incomplete-capture','truncated-capture','identity-unproven','truncated-subtree']);
  delete input.data.complete;
  assert.ok(parseCapture(input).reasons.includes('missing-completeness'));
});

test('shallow skeleton and explicitly scoped captures cannot certify uniqueness', () => {
  const skeleton = envelope({ role: 'group', children_count: 26 });
  assert.deepEqual(parseCapture(skeleton).reasons, ['child-count-mismatch']);
  assert.equal(parseCapture(envelope({ role: 'group', children_count: 0 })).complete, true);
  for (const info of [{ root_ref: '@recording:e8' }, { compact: true }, { interactive_only: true },
    { skeleton: true }, { filtered: true }, { scoped: true }]) {
    assert.deepEqual(parseCapture(envelope({ role: 'group' }, info)).reasons, ['limited-projection']);
  }
  assert.deepEqual(parseCapture(envelope({ role: 'group' }, { compact: false, root_ref: null })).reasons, []);
});

test('rejects unsupported envelopes, malformed nodes and flags without echoing inputs', () => {
  const root = { role: 'group' };
  const cases = [null, [], { tree: root }, { ...envelope(root), version: '1.7' }, { ...envelope(root), version: 2.6 },
    { ...envelope(root), ok: false }, { ...envelope(root), command:'click' }, envelope([]),
    envelope({ role: ' ' }), envelope({ role: 'g\u001b' }), envelope({ role: 'g', name: {} }),
    envelope({ role: 'g', children: null }), envelope({ role: 'g', children: [null] }),
    envelope({ role: 'g', children_count: -1 }), envelope({ role: 'g', children_count: 3.5 }),
    envelope({ role: 'g', subtree_truncated: 0 }), envelope(root, { complete: 'false' }),
    envelope(root, { identity_unproven: 1 }), envelope(root, { truncated: 'secret-value' }),
    envelope(root, { filtered: null }), envelope(root, { root_ref: [] }),
    envelope({ role: 'g', name: String.fromCharCode(0xd800) }),
  ];
  for (const item of cases) {
    assert.throws(() => parseCapture(item), error => error instanceof Error && !error.message.includes('secret-value'));
  }
});

test('rejects shared children and circular tree references', () => {
  const shared = { role: 'button' };
  assert.throws(() => parseCapture(envelope({ role:'group', children: [shared,shared] })), /shared/);
  const cyclic = { role:'group', children: [] };
  cyclic.children.push(cyclic);
  assert.throws(() => parseCapture(envelope(cyclic)), /cycle/);
});

test('enforces exact depth, width and label budgets', () => {
  let tree = { role: 'button' };
  for (let i = 0; i < 128; i++) tree = { role: 'group', children: [tree] };
  assert.equal(parseCapture(envelope(tree)).nodes.length, 129);
  assert.throws(() => parseCapture(envelope({ role: 'group', children: [tree] })), /depth/);
  const children = Array.from({ length: 9_999 }, () => ({ role: 'button' }));
  assert.equal(parseCapture(envelope({ role: 'group', children })).nodes.length, 10_000);
  children.push({ role: 'button' });
  assert.throws(() => parseCapture(envelope({ role: 'group', children })), /10000/);
  assert.throws(() => parseCapture(envelope({ role:'g'.repeat(257) })), /role/);
  assert.throws(() => parseCapture(envelope({ role:'g', name:'n'.repeat(16_385) })), /name/);
  const name = '界'.repeat(16_384);
  const wide = Array.from({ length: 86 }, () => ({ role: 'button', name }));
  assert.throws(() => parseCapture(envelope({ role: 'group', children: wide })), /4 MiB/);
});
