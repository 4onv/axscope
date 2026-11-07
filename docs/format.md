# Field reference

The CLI reads UTF-8 JSON files. A contract contains `version: 1` and a nonempty `targets` array. Each target supplies a unique printable ASCII `id` (1–64 characters), exact `role`, exact `name`, and optional `within` object containing a role and name. Unknown contract keys are errors. Role strings are bounded to 256 UTF-16 units and name strings to 16,384. Both must have non-whitespace content in a selector. Matching uses the original strings.

## Snapshot projection

Supply one JSON envelope with a string version such as `2.6`, `ok: true`, `command: "snapshot"`, and an object at `data.tree`. A node needs a role. The accessible name and children array are optional. The parser emits ordered records with role, nullable name, and a parent index. The root parent is -1. Mutating the raw capture or invoking a desktop command is outside the parser's work.

The CLI enforces its file-size limit before JSON parsing and caps the actual file read. It rejects duplicate object keys at every level, including escaped spellings that decode to the same key. A second `complete` or `name` value therefore cannot silently overwrite earlier evidence. JSON nesting is bounded to 300 levels, which accommodates the supported 128 tree levels with their children arrays. Non-finite numeric values are rejected. Errors omit input contents.

The library also limits node count, label bytes and depth. Invalid JSON, unsupported envelopes, invalid types, excessive size and malformed boolean evidence flags are input errors. The public library accepts already parsed objects; callers reading JSON themselves must reject duplicates before calling `parseCapture` or `evaluate`, since overwritten values cannot be recovered from an object.

## Completeness

| Reason | Input evidence |
| --- | --- |
| `missing-completeness` | The envelope omitted `data.complete` |
| `incomplete-capture` / `truncated-capture` | Explicit incomplete or truncated envelope |
| `identity-unproven` | Upstream reports insufficient evidence for live ref identity |
| `truncated-subtree` | A node explicitly records a truncation boundary |
| `child-count-mismatch` | Recorded child count differs from observed children |
| `limited-projection` | A recording pipeline marked the input skeleton, compact, interactive-only, filtered, scoped, or supplied a root ref |

Agent-desktop may omit the options used to capture a tree. A complete result always refers to the saved projection. A tree can come from a narrower surface than the user intended.

## Reports and bounds

`evaluate` returns a version 1 object containing `status` and one row per target. Every row has the contract ID and an ordered result per capture. A result carries its status, target match count and scope match count. The scope count is null for global targets. If the requested scope has zero or multiple matches, the target count is null. Incomplete evidence takes precedence over every match result.

The CLI also emits an `evidence` array containing each capture's one-based position, completeness, and reason codes. It leaves paths and raw tree contents out of check reports. Contract IDs are visible. Suggested ancestor names can reveal information from the tree.

`suggest` returns `status`, a list of literal `scopes`, and `truncated`. A qualifying role/name scope occurs once and contains exactly one target as a strict descendant, separately in every capture. It can enclose a different real control in another state. Use workflow knowledge to choose among suggestions. A target unique globally everywhere yields `already-unique`; any incomplete capture yields `incomplete`. Otherwise the outcome is `scopes-found` or `no-common-scope`.

The implementation indexes named nodes and subtree ranges in memory. It reads no screenshots and requires no cloud or GUI services. [Versioned upstream format](https://github.com/vercel-labs/agent-desktop/blob/d3dc190afbf34cd2377252398ddd5c30efbd093a/docs/json-output.md)
