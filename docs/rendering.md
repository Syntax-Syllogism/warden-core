# Human and CSV rendering

Core returns structured command results. Its public renderers in `src/index.ts`
turn those results into strings; the caller chooses where to display or save
them. The command contracts and result types are described in
[Callable command use cases](use-cases.md).

## Message lookups

`MessageLookup` is `(key: string, args?: string[]) => string`.
`renderMessages` supplies default English text for lifecycle notices,
verification text, access empty states, and shared summaries. It substitutes
`%s` placeholders in order; an unknown key is returned unchanged.
`renderMessagesFor('diff')` and `renderMessagesFor('provision')` override only
`info.summary` with those commands' wording. Other command IDs use the shared
lookup. Callers may supply their own lookup to renderers that accept one.

Pass `renderMessages` to `renderLifecycleResult`, and
`renderMessagesFor('diff')` to `renderUserDiffHuman`. Conformance helpers
(`verifyUserDiff` and `renderUserConformanceHuman`) also take a lookup;
`renderMessages` supplies their `verify.*` keys. `renderProvisionHuman` uses
the provision lookup by default and accepts a replacement as its third
argument. `renderAccessResult` uses core's English empty-state messages
internally and has no lookup argument.

## Command output

| Input                                                      | Human rendering                                                                                    | CSV rendering                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `LifecycleResult` from freeze, unfreeze, strip, or restore | `renderLifecycleResult(result, lookup)`                                                            | `renderLifecycleCsv`, `renderStripCsv`, or `renderRestoreCsv`, according to the command |
| `UserDiffResult`                                           | `renderUserDiffHuman(result, lookup, options?)`                                                    | `renderUserDiffCsv(result)`                                                             |
| `UserConformanceVerdict[]`                                 | `renderUserConformanceHuman(verdicts, lookup)`                                                     | `renderUserConformanceCsv(verdicts)`                                                    |
| `ProvisionResult` (including a plan preview)               | `renderProvisionHuman(result, personaSourceLabel?, lookup?)`                                       | `renderProvisionCsv(result)`                                                            |
| `UserAccessResult`                                         | `renderAccessResult(result, userLabel?)`                                                           | Use `reverseCsvColumns(type)` and `flattenAccessRow(row, columns)` with a CSV writer    |
| `UserSnapshotFile`                                         | First call `snapshotToLifecycleResult(file)`, then `renderLifecycleResult(result, renderMessages)` | Pass the adapted result to `renderSnapshotCsv`                                          |

`snapshotToLifecycleResult` represents successfully captured users as
`unchanged` with a `snapshotWritten` action. The snapshot file has no failed
target-resolution rows, so the adapter cannot reconstruct them. See
[Lifecycle operations](lifecycle.md) for the snapshot contract.

`renderAccessResult` sorts a copy of the grant rows before building the
summary and target-specific table. With `userLabel`, it renders the
user-scoped heading and grant count; without it, it renders the target heading
and active-user count. It shows the built-in empty-state text only when there
are neither grants nor warnings. See [Access auditing](access.md) for grant
and warning semantics.

`renderProvisionHuman` includes each user's match provenance, personas,
actions, related-record results, and errors. When license usage is present,
it also lists user-license shortfalls and states that permission-set license
headroom was not evaluated. See [Provisioning](provisioning.md) for plan and
apply behavior.
