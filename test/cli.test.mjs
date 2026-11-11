import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = name => path.join(root, 'examples', name + '.json');
const cli = (...args) => {
  const result = spawnSync(process.execPath, [path.join(root, 'bin/axscope.mjs'), ...args], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  assert.ifError(result.error);
  return result;
};

test('a POSIX contract FIFO fails without waiting for a writer', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'axscope-fifo-'));
  try {
    const fifo = path.join(directory, 'contract.json');
    assert.equal(spawnSync('mkfifo', [fifo], { timeout: 5000 }).status, 0);
    const result = cli('check', fifo, fixture('editor'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /regular file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('check, suggest and recheck work through the installed command interface', () => {
  const captures = [fixture('editor'), fixture('with-preview')];
  const before = cli('check', fixture('global'), ...captures, '--json');
  assert.equal(before.status, 1, before.stderr);
  assert.deepEqual(JSON.parse(before.stdout).targets[0].results.map(x => x.status), ['unique','ambiguous']);
  const discovery = cli('suggest', '--role', 'button', '--name', 'Save', ...captures, '--json');
  assert.equal(discovery.status, 0, discovery.stderr);
  assert.deepEqual(JSON.parse(discovery.stdout).scopes, [{role:'group', name:'Editor'}]);
  const after = cli('check', fixture('scoped'), ...captures);
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /#1 unique.*#2 unique/);
});

test('partial and malformed evidence produce distinct exit codes and no raw values', async t => {
  const directory = await mkdtemp(path.join(tmpdir(),'axscope-cli-'));
  t.after(() => rm(directory,{recursive:true,force:true,maxRetries:3}));
  const capture = JSON.parse(await readFile(fixture('editor'),'utf8'));
  capture.data.complete = false;
  capture.data.tree.value = 'private-test-sentinel';
  const file = path.join(directory, 'private.json');
  await writeFile(file, JSON.stringify(capture));
  const result = cli('check',fixture('global'),file,'--json');
  assert.equal(result.status,1,result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.targets[0].results[0].status,'incomplete');
  assert.ok(report.evidence[0].reasons.length);
  assert.doesNotMatch(result.stdout,/private-test-sentinel/);
  const unknown = cli('suggest','--role','button','--name','Save',file,'--json');
  assert.equal(unknown.status,1,unknown.stderr);
  assert.equal(JSON.parse(unknown.stdout).status,'incomplete');
  await writeFile(file, Buffer.from([0xff,0,0xff]));
  assert.equal(cli('check',fixture('global'),file).status,2);
});

test('demo labels invented data and CLI rejects invalid commands and options', () => {
  const result = cli('demo','--json');
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).synthetic,true);
  for (const args of [['check'],['demo','extra'],['check','--role','bad'],['suggest','--name','Save',fixture('editor')],['other']]) {
    assert.equal(cli(...args).status,2);
  }
});

test('duplicate completeness and selector keys cannot silently overwrite evidence', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'axscope-duplicate-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('axscope-duplicate-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const file = path.join(directory, 'ambiguous.json');
  const capture = await readFile(fixture('editor'), 'utf8');
  for (const duplicate of ['"complete": false, "complete": true', '"complete": false, "com\\u0070lete": true']) {
    await writeFile(file, capture.replace(/"complete"\s*:\s*true/, duplicate));
    const result = cli('check', fixture('global'), file, '--json');
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /duplicate object keys/);
  }
  await writeFile(file, '{"version":1,"targets":[{"id":"save","role":"button","name":"Missing","name":"Save"}]}');
  const contractResult = cli('check', file, fixture('editor'), '--json');
  assert.equal(contractResult.status, 2);
  assert.equal(contractResult.stdout, '');
  assert.doesNotMatch(contractResult.stderr, /Missing/);
});
