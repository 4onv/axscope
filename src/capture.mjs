import { Buffer } from 'node:buffer';

const MAX_NODES = 10_000;
const MAX_DEPTH = 128;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const ROLE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const NAME_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flag(object, key) {
  if (!Object.hasOwn(object, key)) return undefined;
  if (typeof object[key] !== 'boolean') throw new Error('Capture contains a malformed boolean flag.');
  return object[key];
}

function captureReasons(data) {
  const reasons = new Set();
  const complete = flag(data, 'complete');
  if (complete === undefined) reasons.add('missing-completeness');
  if (complete === false) reasons.add('incomplete-capture');
  if (flag(data, 'truncated')) reasons.add('truncated-capture');
  if (flag(data, 'identity_unproven')) reasons.add('identity-unproven');

  // The native formatter does not consistently emit capture options. Respect
  // explicit projection markers when a recording pipeline retains them.
  for (const key of ['skeleton', 'compact', 'interactive_only', 'filtered', 'scoped']) {
    if (flag(data, key)) reasons.add('limited-projection');
  }
  if (Object.hasOwn(data, 'root_ref') && data.root_ref !== null) {
    if (typeof data.root_ref !== 'string' || !data.root_ref.trim()) {
      throw new Error('Capture contains a malformed root scope.');
    }
    reasons.add('limited-projection');
  }
  return reasons;
}

function checkLabels(role, name) {
  if (typeof role !== 'string' || role.length > 256 || !role.trim() || !role.isWellFormed() || ROLE_CONTROL.test(role)) {
    throw new Error('Capture node has an invalid role.');
  }
  if (name !== null && (typeof name !== 'string' || name.length > 16_384 || !name.isWellFormed() || NAME_CONTROL.test(name))) {
    throw new Error('Capture node has an invalid accessible name.');
  }
}

/**
 * Project an agent-desktop 2.x JSON snapshot to an ordered, flat tree.
 * Completeness describes only evidence available in the presented tree.
 * Ref IDs, geometry, descriptions, values and action lists are discarded.
 */
export function parseCapture(input) {
  if (!record(input) || typeof input.version !== 'string' || !/^2\.\d+$/.test(input.version)
    || input.ok !== true || input.command !== 'snapshot' || !record(input.data) || !record(input.data.tree)) {
    throw new Error('Expected a successful agent-desktop 2.x snapshot envelope with a tree.');
  }
  const data = input.data;
  const reasons = captureReasons(data);
  const pending = [{ node: data.tree, parent: -1, depth: 0 }];
  const seen = new WeakSet();
  const nodes = [];
  let textBytes = 0;

  while (pending.length) {
    const { node, parent, depth } = pending.pop();
    if (!record(node)) throw new Error('Capture contains an invalid child node.');
    if (seen.has(node)) throw new Error('Capture contains a cycle or a shared tree node.');
    seen.add(node);

    const role = node.role;
    const name = Object.hasOwn(node, 'name') ? node.name : null;
    checkLabels(role, name);
    textBytes += Buffer.byteLength(role) + (name === null ? 0 : Buffer.byteLength(name));
    if (textBytes > MAX_TEXT_BYTES) throw new Error('Capture exceeds the 4 MiB projected label limit.');
    const index = nodes.length;
    nodes.push({ role, name, parent });

    const children = Object.hasOwn(node, 'children') ? node.children : [];
    if (!Array.isArray(children)) throw new Error('Capture node children must be an array.');
    if (nodes.length + pending.length + children.length > MAX_NODES) throw new Error('Capture exceeds the 10000 node limit.');
    if (children.length && depth >= MAX_DEPTH) throw new Error('Capture exceeds the maximum depth of 128.');
    if (flag(node, 'subtree_truncated')) reasons.add('truncated-subtree');
    if (Object.hasOwn(node, 'children_count')) {
      if (!Number.isSafeInteger(node.children_count) || node.children_count < 0) {
        throw new Error('Capture contains an invalid children count.');
      }
      // Skeleton snapshots can report a descendants boundary even if the
      // envelope says the requested (shallow) observation was complete.
      if (node.children_count !== children.length) reasons.add('child-count-mismatch');
    }
    for (let i = children.length - 1; i >= 0; i--) {
      pending.push({ node: children[i], parent: index, depth: depth + 1 });
    }
  }
  return { complete: reasons.size === 0, nodes, reasons: [...reasons] };
}
