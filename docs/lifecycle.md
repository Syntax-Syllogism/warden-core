# Lifecycle operations

The public lifecycle command boundary is documented in
[Callable command use cases](use-cases.md). This guide covers the underlying
targeting, assignment, snapshot, and rendering behavior used by those
commands.

Lifecycle workflows target existing users and return structured results. They
share the target-selection pipeline in `src/lifecycle/targeting.ts`:

1. `field:value` input is parsed by `parseUserFlag`, or a users definition is
   read as JSON/CSV.
2. User fields are canonicalized from describe metadata.
3. The matching layer resolves each request without guessing when there are
   zero or multiple matches.
4. Results retain input order and include identity, actions, skipped work,
   warnings, and errors.

`fuzzyUsername` is supported for users-definition rows. CSV-derived errors keep
the source path and line where available.

## Freeze and unfreeze

The `freeze` and `unfreeze` use cases use `FREEZE` or `UNFREEZE` to update
`UserLogin.IsFrozen`. Their `plan()` methods report planned actions without
DML; `apply()` uses partial-success handling, so each user's result can be
changed or failed independently. Callers supply confirmation; core returns
result data rather than printing.

## Strip

The `strip` use case plans and applies cleanup for each resolved user. The
default categories are:

- non-profile-owned Permission Set assignments;
- Permission Set Group assignments;
- regular Public Group memberships;
- Queue memberships; and
- Permission Set License assignments.

Strip also freezes users before cleanup and deactivates them afterward unless
`no-freeze` or `no-deactivate` is set. `keep-permsets`,
`keep-permset-groups`, `keep-public-groups`, `keep-queues`, and `keep-licenses`
skip individual categories. Profile-owned assignments are always reported as
skipped. Dry runs produce `would...` notices and do not issue DML.

## Diffs, snapshots, and rendering

`executePersonaDiff` compares users from a users/personas definition with org
state, including profile, role, and assignment deltas. `executeUserToUserDiff`
compares one `user` target against one `against` target. Both return structured
diff rows and summary data; `renderUserDiffHuman` and `renderUserDiffCsv`
provide presentation output.

`loadAssignmentState` batches optional reads for UserLogin, Permission Set
assignments, group memberships, and Permission Set Licenses. Snapshot helpers
capture those assignments as `snapshotVersion: 1` JSON, resolve missing names,
and read/write JSON or CSV snapshot files. Snapshot data is descriptive and is
not itself a restore operation. The structural JSON contract and in-memory
snapshot parser are documented in [File-format schemas](spec-schemas.md).

Lifecycle errors are `LifecycleError` instances with stable codes. Rendering
helpers in `src/lifecycle` and `src/shared/output.ts` return strings; callers
choose where to display or save them.
