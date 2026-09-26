# Provisioning

`ProvisionUserUseCase.execute` is the main provisioning workflow. It accepts a
Salesforce `Connection`, user/persona definitions from paths or in-memory
documents, matching options, `dryRun`, and optional related-record input. It
returns a `ProvisionResult` with per-user actions, match identity, failures,
and summary counts.

The workflow is:

1. Read JSON or CSV users and JSON personas, then validate the definitions.
2. Describe User fields and canonicalize field names and persona merges.
3. Resolve Profile, Role, Permission Set, Permission Set Group, Public Group,
   and Queue references by Salesforce Id or supported name.
4. Match existing users using the selected match field or default external id.
5. Build user and assignment plans, including additive or sync modes.
6. In dry-run mode, calculate planned results and license usage without DML.
7. In live mode, save Users in bulk, apply related records after a successful
   User save, then apply assignments and post-save state.

Validation and planning happen before the corresponding user DML. A failed
User save prevents that user's related-record work. Related-record failures do
not roll back an already-saved User; they are attached to that user's result.
Results are restored to input order even though work is batched concurrently.

## User and persona documents

The structural JSON contracts, in-memory parser API, schema-version behavior,
and generated JSON Schema artifacts are documented in
[File-format schemas](spec-schemas.md). This guide focuses on the provisioning
semantics applied after structural parsing.

The users document contains a `users` array. Each entry may contain regular
User fields plus these reserved keys:

- `personas`: persona names to merge;
- `match`: a filterable User field for this row;
- `profile` and `role`: per-user overrides;
- `fuzzyUsername`: enables fuzzy Username matching for the row; and
- `related`: selected relationship names from the related catalog.

Persona definitions are keyed by name under `personas`. A persona may define
`profile`, `role`, `userAttributes`, assignment lists (`permissionSets`,
`permissionSetGroups`, `publicGroups`, `queues`), and each category's
`additive` or `sync` mode. Assignment lists are unioned across personas.
Conflicting singular values, modes, or attributes fail the affected user
unless a user-level override resolves the conflict. The default assignment
mode is `additive`; `sync` removes existing assignments absent from the
effective persona.

Users can be read from JSON or CSV. CSV format is selected from `.csv`/`.tsv`
or an explicit input-format override, and list fields use the configured
delimiter. In-memory documents avoid filesystem access for editor and test
callers.

## Warnings and errors

Missing Salesforce references and license shortfalls are warnings. The current
use case exposes `acknowledgeWarnings(warnings)` so a front end can decide how
to handle them before live work; dry-run and non-interactive callers may omit
it. Expected failures are `ProvisioningError` or `DefinitionError`, and
consumers should use their stable codes rather than match message text.

`renderProvisionCsv` emits one row per action, related-record result, or error.
Use `renderLifecycleCsv` and the other shared renderers for the corresponding
workflow results.
