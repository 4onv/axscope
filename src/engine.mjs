import { Buffer } from 'node:buffer';

const ROLE_LIMIT = 256;
const NAME_LIMIT = 16_384;
const SUGGESTION_LIMIT = 20;
const forbiddenRole = /[\u0000-\u001f\u007f-\u009f]/u;
const forbiddenName = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, required, optional = []) {
  return record(value)
    && required.every(key => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every(key => required.includes(key) || optional.includes(key));
}

function validRole(role) {
  return typeof role === 'string' && role.length <= ROLE_LIMIT && !!role.trim()
    && role.isWellFormed() && !forbiddenRole.test(role);
}

function validName(name) {
  return typeof name === 'string' && name.length <= NAME_LIMIT
    && name.isWellFormed() && !forbiddenName.test(name);
}

// NUL is rejected in both fields, so pairs cannot collide across the boundary.
function keyOf(role, name) {
  return role + '\0' + name;
}

function selectorKey(value) {
  if (!exactKeys(value, ['role', 'name']) || !validRole(value.role)
      || !validName(value.name) || !value.name.trim()) {
    throw new Error('A selector requires a nonblank literal role and name.');
  }
  return keyOf(value.role, value.name);
}

function compileContract(contract) {
  if (!exactKeys(contract, ['version', 'targets']) || contract.version !== 1
      || !Array.isArray(contract.targets) || contract.targets.length === 0
      || contract.targets.length > 100) {
    throw new Error('Expected a version 1 contract with 1 to 100 targets.');
  }
  const seen = new Set();
  const targets = [];
  for (const target of contract.targets) {
    if (!exactKeys(target, ['id', 'role', 'name'], ['within'])
        || typeof target.id !== 'string' || !/^[\x20-\x7e]{1,64}$/.test(target.id)
        || !target.id.trim() || seen.has(target.id)) {
      throw new Error('Each target needs a unique printable ASCII id of 1 to 64 characters and supported fields.');
    }
    seen.add(target.id);
    targets.push({
      id: target.id,
      key: selectorKey({ role: target.role, name: target.name }),
      within: Object.hasOwn(target, 'within') ? selectorKey(target.within) : null,
    });
  }
  return targets;
}

function checkCaptureCount(captures) {
  if (!Array.isArray(captures) || captures.length === 0 || captures.length > 12) {
    throw new Error('Provide 1 to 12 parsed captures.');
  }
}

// Index each subtree as a half-open preorder interval. The normalized parent
// index precedes its children; sibling subtrees need not be contiguous on input.
function indexCapture(capture) {
  if (!record(capture) || typeof capture.complete !== 'boolean' || !Array.isArray(capture.nodes)
      || !capture.nodes.length || capture.nodes.length > 10_000) {
    throw new Error('Expected a parsed capture with a completeness flag and 1 to 10000 nodes.');
  }
  const nodes = capture.nodes;
  const depth = new Uint16Array(nodes.length);
  const sizes = new Uint32Array(nodes.length).fill(1);
  let bytes = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!record(node) || !validRole(node.role) || !(node.name === null || validName(node.name))
        || !Number.isInteger(node.parent) || (i === 0 ? node.parent !== -1 : node.parent < 0 || node.parent >= i)) {
      throw new Error('Invalid normalized node or parent index.');
    }
    if (i > 0) depth[i] = depth[node.parent] + 1;
    bytes += Buffer.byteLength(node.role) + (node.name === null ? 0 : Buffer.byteLength(node.name));
    if (depth[i] > 128 || bytes > 4 * 1024 * 1024) throw new Error('Capture exceeds the analysis limits.');
  }
  for (let i = nodes.length - 1; i > 0; i--) sizes[nodes[i].parent] += sizes[i];

  const nextChild = new Uint32Array(nodes.length);
  const preorder = new Uint32Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const parent = nodes[i].parent;
    const start = parent === -1 ? 0 : nextChild[parent];
    preorder[start] = i;
    nextChild[i] = start + 1;
    if (parent !== -1) nextChild[parent] += sizes[i];
  }

  const named = new Map();
  for (let start = 0; start < preorder.length; start++) {
    const i = preorder[start];
    const { role, name } = nodes[i];
    if (name === null || !name.trim()) continue;
    const key = keyOf(role, name);
    let group = named.get(key);
    if (!group) {
      group = { role, name, starts: [], firstEnd: start + sizes[i] };
      named.set(key, group);
    }
    group.starts.push(start);
  }
  return named;
}

function lowerBound(sorted, value) {
  let from = 0;
  let to = sorted.length;
  while (from < to) {
    const middle = Math.floor((from + to) / 2);
    if (sorted[middle] < value) from = middle + 1;
    else to = middle;
  }
  return from;
}

function descendantCount(target, scope) {
  if (!target) return 0;
  return lowerBound(target.starts, scope.firstEnd) - lowerBound(target.starts, scope.starts[0] + 1);
}

function resolve(target, named, complete) {
  const matchesGroup = named.get(target.key);
  let matches = matchesGroup?.starts.length ?? 0;
  let scopes = null;
  if (target.within !== null) {
    const scope = named.get(target.within);
    scopes = scope?.starts.length ?? 0;
    if (scopes !== 1) {
      const status = scopes === 0 ? 'scope-missing' : 'scope-ambiguous';
      return { status: complete ? status : 'incomplete', matches: null, scopes };
    }
    matches = descendantCount(matchesGroup, scope);
  }
  let status = 'unique';
  if (matches === 0) status = 'missing';
  else if (matches > 1) status = 'ambiguous';
  return { status: complete ? status : 'incomplete', matches, scopes };
}

/** Evaluate exact role/name contracts in capture order. Results contain contract ids and counts. */
export function evaluate(contract, captures) {
  const targets = compileContract(contract);
  checkCaptureCount(captures);
  const rows = targets.map(({ id }) => ({ id, results: [] }));
  let status = 'pass';
  for (const capture of captures) {
    const named = indexCapture(capture);
    for (const [index, target] of targets.entries()) {
      const result = resolve(target, named, capture.complete);
      rows[index].results.push(result);
      if (result.status !== 'unique') status = 'review';
    }
  }
  return { version: 1, status, targets: rows };
}

function compareText(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Suggest named strict-ancestor scopes that work in every supplied capture. */
export function suggest(selector, captures) {
  const targetKey = selectorKey(selector);
  checkCaptureCount(captures);
  let common = null;
  let allUnique = true;
  let complete = true;
  for (const capture of captures) {
    const named = indexCapture(capture);
    if (!capture.complete) complete = false;
    const target = named.get(targetKey);
    if (target?.starts.length !== 1) allUnique = false;
    if (!complete) continue;
    const next = new Map();
    for (const [key, scope] of named) {
      if (common && !common.has(key)) continue;
      if (scope.starts.length === 1 && descendantCount(target, scope) === 1) {
        next.set(key, { role: scope.role, name: scope.name });
      }
    }
    common = next;
  }
  if (!complete) return { status: 'incomplete', scopes: [], truncated: false };
  if (allUnique) return { status: 'already-unique', scopes: [], truncated: false };
  const options = [...common.values()].sort((a, b) => compareText(a.role, b.role) || compareText(a.name, b.name));
  return {
    status: options.length ? 'scopes-found' : 'no-common-scope',
    scopes: options.slice(0, SUGGESTION_LIMIT),
    truncated: options.length > SUGGESTION_LIMIT,
  };
}
