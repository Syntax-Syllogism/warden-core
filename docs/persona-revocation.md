# Persona-scoped strip

The `strip` use case has two modes. Without `personas` or `allPersonas` it is
full offboarding: freeze, remove every selected assignment and membership, and
deactivate (see [Lifecycle operations](lifecycle.md#strip)). With them it is
persona-scoped removal: only the access that the named personas grant is
removed, and access that another persona the user keeps also grants is kept.

Persona mode is selected when `allPersonas` is `true`, or when `personas` is a
non-empty array. `personas` and `allPersonas` are mutually exclusive; the
options schema rejects both. An empty `personas` array is not persona mode.

## Options

| Option                                                                | Behavior in persona mode                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `personas`                                                            | Persona API names to remove. Each name must be held by the user; a name the user does not hold produces a `personaNotHeld` warning. |
| `allPersonas`                                                         | Remove every persona the user holds. Default `false`.                                                                               |
| `personasPath`                                                        | Persona definitions file. Used with `usersPath` or `usersDoc`.                                                                      |
| `personasDoc`                                                         | In-memory persona definitions document, for callers without a filesystem.                                                           |
| `personaSource`                                                       | `file` (default) or `org`. See [Held personas](#held-personas).                                                                     |
| `freeze`                                                              | Freeze the user before removal. Default `false` in persona mode.                                                                    |
| `deactivate`                                                          | Deactivate the user after removal. Default `false` in persona mode.                                                                 |
| `noFreeze`, `noDeactivate`                                            | Still force freeze or deactivate off when set, as in full strip.                                                                    |
| `keepPermsets`, `keepPermsetGroups`, `keepPublicGroups`, `keepQueues` | Skip that category. The plan still reports the row, as a skipped notice.                                                            |

`keepLicenses` is accepted by the schema, but persona mode never removes
permission set licenses, so it has no effect there.

Freeze and deactivate are off unless requested, which differs from full strip.
A single call can remove personas and freeze the user by setting `freeze: true`.

## Held personas

The planner needs the personas each user holds, plus the persona definitions.

- The held personas for a user come from the `personas` array of that user's
  row in the users definition (`usersDoc` or `usersPath`). The row is found by
  comparing the target value with the row's `match` field, falling back to the
  target's field when the row has none.
- `personaSource: 'file'` requires a users definition. Without one, `plan()`
  fails with `Persona source "file" requires --users-def so held personas are
known.` A user-match target (`user`) with no users definition therefore
  cannot run in persona mode.
- Persona definitions come from `personasDoc` or `personasPath`. If neither is
  given, the users definition's personas are treated as empty, so every held
  persona name becomes an unresolved row.
- `personaSource: 'org'` is reserved for callers that own the org-side persona
  assignment reader. warden-core rejects it with the stable
  `errorPersonaSourceUnsupported` lifecycle error rather than silently reading
  file data. Callers that hold org-side persona assignments must read them and
  invoke the pure planner with the held personas (or use `personaSource: 'file'`
  with a users definition).

## Keep rule

For each user, persona mode computes:

- `removeSet`: the components (permission sets, permission set groups, public
  groups, and queues) granted by the personas being removed;
- `keepSet`: the components granted by the held personas that are not being
  removed.

It removes `removeSet` minus `keepSet`, and only targets the user actually
holds. A target in both sets produces a `keptByOtherPersona` row whose detail
lists the covering persona API names, for example `Support (kept by Reporting)`.
The keep check runs before the holdings check, so a shared target produces this
row even when the user does not hold it.

If a retained held persona has no definition, the planner reports it as
unresolved and plans no access removal until its coverage is known.

Manual grants of the same target are removed, because they cannot be told
apart from persona-derived access without ledger data. If a caller passes
`ledgerTargets` to the planner, each removed target without a ledger row for
that user and removed persona produces a `removedUnmanagedGrant` warning. The
`strip` use case accepts provenance rows with `userId`, `persona`, and
`targetId`, scopes them to each selected user, groups them by removed persona,
and passes the resulting provenance map through to both its live and preview
persona plans.

## Matching holdings to components

Persona components are references (API names or developer names) that are
resolved with the same reference resolver as provisioning. Only the user's
direct assignments and memberships count. Nested group access is not removed.

| Component (persona key) | Matches holdings                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `permissionSets`        | `PermissionSetAssignment` rows with that `PermissionSetId` and no `PermissionSetGroupId`. Profile-owned permission sets are never matched. |
| `permissionSetGroups`   | `PermissionSetAssignment` rows with that `PermissionSetGroupId`.                                                                           |
| `publicGroups`          | `GroupMember` rows for a `Regular` group.                                                                                                  |
| `queues`                | `GroupMember` rows for a `Queue` group.                                                                                                    |

Permission set licenses are never part of persona revocation.

## Plan rows and actions

Each row has the conformance `RevocationPlanRow` shape: `userKey`, `userId`,
`category`, `action`, `status`, `detail`, and `error`.

| Action               | Meaning                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `wouldRemove`        | The user holds the target and no retained persona covers it. Status `planned`.            |
| `keptByOtherPersona` | A retained persona also grants the target. Status `kept`.                                 |
| `alreadyAbsent`      | The target is in `removeSet` but the user holds nothing for it. Status `unchanged`.       |
| `unresolved`         | A persona reference or persona name does not resolve. Status `unmanaged`; `error` is set. |

Rows are ordered by user, category (`PermissionSet`, `PermissionSetGroup`,
`PublicGroup`, `Queue`), `detail`, and `action`.

In `strip`, `keptByOtherPersona` and `alreadyAbsent` become skipped notices,
`unresolved` rows become user errors, and the other rows become planned
removals. In a dry run, removals appear as `wouldRemove...` actions. An
unresolved reference is reported as an error, and the other targets in the
plan are still processed unless the unresolved persona is retained, in which
case removal is blocked until its coverage is known.

## Apply order

`strip.apply()` runs the steps in this order for each user:

1. freeze, only when `freeze` is set and `noFreeze` is not;
2. delete steps for the removed assignments and memberships, one step per
   category, through the shared strip apply path;
3. deactivate, only when `deactivate` is set and `noDeactivate` is not.

Each user's result reports the removals and skipped work independently.

## Pure planner

`planPersonaRevocation` (exported from `src/index.ts`) takes plain data and
returns `{ rows, steps, warnings, removedTargets }`. It performs no Salesforce
I/O, so the same semantics can be tested against the shared conformance
fixtures. `planRevocationFromState(fixture)` returns the sorted rows for every
user in a revocation fixture. The fixture contract and fixture-authoring rules are in
[Conformance fixtures](conformance.md#persona-revocation-fixtures).

## Not in core

Core plans and applies only the access and membership removals, plus the
optional freeze and deactivate. Callers own the following:

- reading org-side persona assignments (see [Held personas](#held-personas));
- marking assignments or ledger rows as revoked, or recording a revocation run;
- any package-specific bookkeeping that follows a successful removal.

Use `plan()` for the preview and `apply()` only after the caller's confirmation
step. See [Callable command use cases](use-cases.md) for the plan and apply
contract.
