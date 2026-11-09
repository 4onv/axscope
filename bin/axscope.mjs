#!/usr/bin/env node
import { open, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseCapture, evaluate, suggest, parseJsonInput } from '@4onv/axscope';

const help = [
  'AXScope checks desktop automation targets across saved agent-desktop snapshots.',
  '',
  '  axscope check CONTRACT.json CAPTURE.json [CAPTURE.json ...] [--json]',
  '  axscope suggest --role ROLE --name NAME CAPTURE.json [CAPTURE.json ...] [--json]',
  '  axscope demo [--json]',
  '',
  'Pass 1–12 captures, in the order you want to compare them.',
  'Exit 0 means all targets were unique, or a requested suggestion was available.',
  'Exit 1 means review is needed. Exit 2 means an input or command was invalid.',
].join('\n');

function escapeControls(text) {
  return text.replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

function quoted(value) {
  return escapeControls(JSON.stringify(value));
}

async function readJson(path, limit) {
  let handle;
  try {
    handle = await open(path, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error();
    // A file may grow after stat. Cap the actual read too.
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error();
    return parseJsonInput(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
  } catch {
    throw new Error('Input must be a readable regular file containing unambiguous UTF-8 JSON within the documented limits; duplicate object keys are not allowed.');
  } finally {
    await handle?.close();
  }
}

async function loadCaptures(paths) {
  if (paths.length < 1 || paths.length > 12) throw new Error('Provide between 1 and 12 saved snapshot files.');
  const captures = [];
  for (const [index, path] of paths.entries()) {
    try {
      captures.push(parseCapture(await readJson(path, 4 * 1024 * 1024)));
    } catch (error) {
      throw new Error('Capture ' + (index + 1) + ': ' + error.message);
    }
  }
  return captures;
}

function evidence(captures) {
  return captures.map(({ complete, reasons }, index) => ({ capture: index + 1, complete, reasons }));
}

function printEvidence(items) {
  for (const item of items) {
    if (!item.complete) console.log('  Capture ' + item.capture + ' has limited evidence (' + item.reasons.join(', ') + ').');
  }
}

function printCheck(report) {
  console.log('Target check  ' + report.status.toUpperCase());
  for (const target of report.targets) {
    const cells = target.results.map((result, index) => '#' + (index + 1) + ' ' + result.status);
    console.log('  ' + quoted(target.id) + '   ' + cells.join('  |  '));
  }
  printEvidence(report.evidence);
}

function printSuggestions(report) {
  console.log('Scope search  ' + report.status);
  for (const scope of report.scopes) console.log('  within ' + quoted(scope.role) + ' ' + quoted(scope.name));
  if (report.truncated) console.log('  Additional matching scopes omitted.');
  printEvidence(report.evidence);
}

async function demo(json) {
  const fixture = async name => JSON.parse(await readFile(new URL('../examples/' + name, import.meta.url), 'utf8'));
  const captures = [parseCapture(await fixture('editor.json')), parseCapture(await fixture('with-preview.json'))];
  const context = evidence(captures);
  const globalCheck = { ...evaluate(await fixture('global.json'), captures), evidence: context };
  const suggestions = { ...suggest({ role: 'button', name: 'Save' }, captures), evidence: context };
  const scopedCheck = { ...evaluate(await fixture('scoped.json'), captures), evidence: context };
  if (json) {
    console.log(escapeControls(JSON.stringify({ synthetic: true, globalCheck, suggestions, scopedCheck }, null, 2)));
    return;
  }
  console.log('SYNTHETIC DEMO · Opening Preview adds a second Save button.\n');
  printCheck(globalCheck);
  printSuggestions(suggestions);
  printCheck(scopedCheck);
}

async function main() {
  let args;
  try {
    args = parseArgs({ allowPositionals: true, options: {
      role: { type: 'string' }, name: { type: 'string' }, json: { type: 'boolean' },
      help: { type: 'boolean' }, version: { type: 'boolean' },
    } });
  } catch { throw new Error('Invalid command options. See --help.'); }
  const { values, positionals } = args;
  if (values.version) { console.log('0.1.2'); return; }
  if (values.help || positionals.length === 0) { console.log(help); return; }
  const [command, ...paths] = positionals;
  if (command !== 'suggest' && (values.role !== undefined || values.name !== undefined)) {
    throw new Error('Only suggest accepts --role and --name.');
  }
  if (command === 'demo' && paths.length === 0) return demo(values.json);
  let report;
  if (command === 'check') {
    const [contractPath, ...capturePaths] = paths;
    if (!contractPath) throw new Error('check requires a contract followed by one or more captures.');
    const contract = await readJson(contractPath, 128 * 1024);
    const captures = await loadCaptures(capturePaths);
    report = { ...evaluate(contract, captures), evidence: evidence(captures) };
    if (!values.json) printCheck(report);
    process.exitCode = report.status === 'pass' ? 0 : 1;
  } else if (command === 'suggest') {
    if (!values.role || !values.name) throw new Error('suggest requires --role and --name.');
    const captures = await loadCaptures(paths);
    report = { ...suggest({ role: values.role, name: values.name }, captures), evidence: evidence(captures) };
    if (!values.json) printSuggestions(report);
    process.exitCode = ['already-unique', 'scopes-found'].includes(report.status) ? 0 : 1;
  } else {
    throw new Error('Invalid command or unexpected positional argument. See --help.');
  }
  if (values.json) console.log(escapeControls(JSON.stringify(report, null, 2)));
}

main().catch(error => {
  console.error('AXScope: ' + escapeControls(error.message));
  process.exitCode = 2;
});
