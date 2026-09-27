# Callable command use cases

The public command layer is implemented in `src/useCase.ts`,
`src/commandOptions.ts`, and `src/useCases.ts`, and is re-exported from
`src/index.ts`. It gives non-CLI consumers one typed entry point for each
Warden command. The caller supplies the Salesforce `Connection`; core does not
select an org, prompt, confirm, print, or write output files.

## Contract

Read commands expose `run(connection, options, context?)`. Write commands
expose `plan(connection, options, context?)` and
`apply(connection, plan, context?)`:

| Kind | Commands | State boundary |
| --- | --- | --- |
| Read | `access`, `diff`, `snapshot` | Reads Salesforce state and returns structured data. `snapshot` returns a `UserSnapshotFile`; the caller serializes it or writes it. |
| Write | `provision`, `freeze`, `unfreeze`, `strip`, `restore` | `plan()` reads and validates current state without DML. The caller presents the preview and warnings, then calls `apply()` to perform writes. |

Write plans are JSON-safe and represent the org state observed during
planning. `apply()` does not re-plan, so callers should treat a plan as a
short-lived preview and apply it only after their confirmation step. A plan
may be retained across an asynchronous confirmation UI or passed through
`JSON.parse(JSON.stringify(plan))` before applying it.

The optional `UseCaseContext` provides `onProgress({ phase, done?, total?,
message? })` and an `AbortSignal`. The use cases emit start/complete progress
events around reads and planning, and apply operations use the same context;
an aborted signal raises `WardenError` with code `cancelled`.

## Descriptors and option schemas

`commandDescriptors` contains exactly one descriptor for each command. Each
descriptor has an `id`, title, `group: 'User Lifecycle'`, `destructive` flag,
and the command's Zod `optionsSchema`. Only `strip` is marked destructive in
the current descriptors; the write/read distinction is represented by the
use-case's `kind`.

The schemas use core option names rather than CLI flag names. Paths identify
files; `usersDoc`, `personasDoc`, `relatedDoc`, and `snapshotDoc` accept
in-memory documents for unsaved-buffer and non-filesystem callers.

| Command | Options and selection rules |
| --- | --- |
| `provision` | User and persona paths or documents, optional related-record path/document, `externalId`, input format, CSV list delimiter, and `fuzzyUsername`. The plan exposes `licenses[].shortfall` for each user license; enforcing a fail-on-insufficient-license policy from that data is a caller/CLI concern, not a core option. |
| `freeze`, `unfreeze` | A `user` match (`field:value`) or a users definition path/document, plus external-id and CSV options. |
| `strip` | The same user selection options, plus `noFreeze`, `noDeactivate`, and keep flags for permission sets, permission set groups, public groups, queues, and licenses. |
| `diff` | Required `mode` (`persona` or `user`) and optional `verify`. User mode requires `user` and `against`; persona mode uses users/personas paths or documents and the matching input options. With `verify`, persona mode returns `UserConformanceVerdict[]`; user mode rejects verification. |
| `access` | Required access `type`; resolve a supplied `target`, or resolve a `user` and use `sobject` as the scope for field/object access. `target` and `sobject` are mutually exclusive. |
| `snapshot` | The same user selection options as lifecycle commands, plus optional `org` provenance. The result is an in-memory snapshot object. |
| `restore` | A `snapshotPath` or in-memory `snapshotDoc`. Planning resolves snapshot users, current assignments, and reference IDs; applying restores activation, freeze state, assignments, groups, queues, and licenses where needed. |

`uiHints(schema)` returns the UI metadata attached to each top-level schema
field without requiring a front end to inspect Zod metadata. Hints identify the
field kind (`file`, `string`, `boolean`, or `enum`), label, file filter, and
relationships such as mutually exclusive or dependent inputs.

## Command behavior

The use cases compose the topic-specific workflows rather than replacing
their domain contracts:

- `provision.plan()` resolves definitions and Salesforce references, performs
  matching and related-record preflight, calculates license usage, and returns
  a preview. `provision.apply()` saves users and then applies related records
  and assignments for successful saves.
- `freeze` and `unfreeze` plan `UserLogin.IsFrozen` changes and apply them with
  partial-success results. Already-correct users remain unchanged.
- `strip.plan()` builds per-user cleanup state and a preview. `strip.apply()`
  freezes users, removes selected assignments/memberships, and deactivates
  users according to the options and skip flags.
- `diff.run()` selects persona-vs-org or user-vs-user comparison and can return
  core conformance verdicts for persona mode. `access.run()` validates an access
  target and optionally resolves a user before reverse access analysis.
- `snapshot.run()` captures assignment state for selected users. `restore`
  plans the inverse assignment/activation work from a snapshot but does not
  promise a full historical rollback.

For the detailed domain rules and result shapes, see [lifecycle operations](lifecycle.md),
[provisioning](provisioning.md), [access auditing](access.md), and
[file-format schemas](spec-schemas.md).
