# AXScope

Find out when opening a second panel makes an automation target ambiguous. AXScope checks exact role and accessible name against saved `agent-desktop` snapshots. When a control has twins, it finds named ancestors that isolate one match in every supplied state.

```text
                          Editor open     Editor + Preview
button “Save”             unique          ambiguous
  within group “Editor”   unique          unique
```

Both states in this example are synthetic. Try the full cycle with Node.js 22 or newer. The demo uses local files and runs without a desktop session.

```sh
git clone https://github.com/4onv/axscope.git
cd axscope
node bin/axscope.mjs demo
```

For an installed CLI, download `4onv-axscope-0.1.1.tgz` from the [GitHub release](https://github.com/4onv/axscope/releases/tag/v0.1.1) and run the commands below from the download directory. The archive contains both the CLI and the JavaScript library.

```sh
npm install -g ./4onv-axscope-0.1.1.tgz --offline --ignore-scripts --no-audit --no-fund
axscope demo
```

## Check a target

Capture the same app in two states, such as before and after opening a Preview panel. Use a full window snapshot for each state. For example, `agent-desktop snapshot --app Finder > finder.json` saves one capture on macOS. Capture files may contain private window names, addresses, or field values. Keep them local or use synthetic fixtures for public CI. [Upstream snapshot guide](https://github.com/vercel-labs/agent-desktop#quick-start)

Describe the control in a contract. The example below requires exactly one **Editor** group and exactly one **Save** button inside it. Omit `within` to check across the supplied tree.

```json
{"version":1,"targets":[{"id":"save-edit","role":"button","name":"Save","within":{"role":"group","name":"Editor"}}]}
```

```sh
axscope check examples/global.json examples/editor.json examples/with-preview.json
axscope suggest --role button --name Save examples/editor.json examples/with-preview.json
axscope check examples/scoped.json examples/editor.json examples/with-preview.json --json
```

The first check returns exit `1` because the second capture has two Save buttons. The suggestion offers the Editor group. The scoped check returns exit `0`. Choose the scope that describes the intended control when several choices work. `suggest` lists the intersection of qualifying scopes across captures, sorted by role and name, with at most 20 results.

## Read the result

| Status | What AXScope observed |
| --- | --- |
| `unique` | Exactly one matching target in the requested scope |
| `missing` / `ambiguous` | Zero / multiple matching targets |
| `scope-missing` / `scope-ambiguous` | Zero / multiple matching ancestors with the requested role and name |
| `incomplete` | The capture or its metadata leaves the evidence incomplete. Counts describe observed nodes only. |

`check` exits `0` when every target is unique in every capture, `1` when review is needed, and `2` for invalid inputs. `suggest` exits `0` if the target is already unique or qualifying scopes exist, `1` for incomplete evidence or no common scope, and `2` for invalid inputs. `--json` preserves capture argument order. Text output labels captures `#1`, `#2`, and so on.

## Use the library

After installing the release archive as a local dependency, pass parsed JSON into the public API.

```js
import { parseCapture, evaluate, suggest } from '@4onv/axscope';

const captures = [beforeJson, afterJson].map(parseCapture);
const matrix = evaluate(contractJson, captures);
const choices = suggest({ role: 'button', name: 'Save' }, captures);
```

Exact role and name comparisons preserve whitespace, case, and Unicode spelling. Targets need a nonblank accessible name. An ancestor must be unique across the entire presented tree, and the target must be a strict descendant. The check report emits contract IDs and counts. Suggestions disclose the matching ancestor names.

## Evidence boundary

AXScope accepts successful `agent-desktop` 2.x snapshot envelopes. Missing completeness, evidence of pruning, a truncated subtree, or `identity_unproven` produces `incomplete`. Capture options can narrow a tree without leaving a marker in the envelope. Use full captures and keep the capture command with private fixtures when that distinction matters.

A pass establishes uniqueness of the supplied role and name in the saved states. Another element with the same name can replace the original between states. Live identity, visibility, clickability, action delivery, and accessibility compliance each require separate checks. Native refs, element values, geometry, and screen positions play no part in matching.

The CLI accepts up to 100 targets, 12 captures, 128 KiB per contract and 4 MiB per capture. Each tree supports up to 10,000 nodes and depth 128. [Input and output reference](docs/format.md)

## Development

```sh
node --test
npm run test:package
```

CI runs the unit and CLI tests on Windows and Ubuntu with Node.js 22 and 24, then packs the CLI, installs it offline, and invokes its installed command. [Why this project was chosen](docs/research-2026-11-02.md) · [MIT license](LICENSE)
