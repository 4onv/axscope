import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const npm = process.env.npm_execpath;
if (!npm || !path.isAbsolute(npm)) throw new Error('Run this check with npm run test:package.');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'axscope-package-'));
const options = { encoding: 'utf8', timeout: 120000, windowsHide: true };
try {
  const data = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', directory], { ...options, cwd: root }));
  const packed = Array.isArray(data) ? data[0] : data['@4onv/axscope'];
  assert.equal(packed.name, '@4onv/axscope');
  assert.equal(packed.filename, path.basename(packed.filename));
  const prefix = path.join(directory, 'install');
  await mkdir(prefix);
  execFileSync(process.execPath, [npm, 'install', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', path.join(directory, packed.filename)], { ...options, cwd: directory });
  const raw = process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/c', 'node_modules\\.bin\\axscope.cmd demo --json'], { ...options, cwd: prefix })
    : execFileSync(path.join(prefix, 'node_modules/.bin/axscope'), ['demo', '--json'], { ...options, cwd: prefix });
  const demo = JSON.parse(raw);
  assert.equal(demo.synthetic, true);
  assert.equal(demo.globalCheck.status, 'review');
  assert.equal(demo.suggestions.status, 'scopes-found');
  assert.equal(demo.scopedCheck.status, 'pass');
  console.log('Packed CLI installed offline and completed the scope discovery demo.');
} finally {
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('axscope-package-'));
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
}
