# Conformance fixtures

The top-level `conformance/` directory is the versioned, engine-neutral
executable specification for Warden's v1 persona reconciliation planner. The
JSON fixtures are published with `@syntax-syllogism/warden-core` so the
TypeScript planner and any future engine (such as a possible Apex consumer)
can evaluate the same inputs and expected plans.

## Fixture contract

Every fixture has `schemaVersion: 1` and three sections:

- `definitions.personas` and `definitions.users` reuse the canonical Warden
  persona and users-definition documents. Fixture users additionally require a
  stable `userKey` and simulated Salesforce `userId`.
- `orgState` contains the simulated Permission Set, Permission Set Group,
  Public Group, Queue, PermissionSetAssignment, and GroupMember state used for
  reference resolution and current-state comparison.
- `expectedPlan` contains the exact ordered result rows. Each row has
  `userKey`, `userId`, `category`, `action`, `status`, `detail`, and `error`.

The structural contract is the generated
[`conformance-fixture.schema.json`](../schemas/conformance-fixture.schema.json)
artifact, with `src/spec/conformanceFixture.ts` as its Zod source of truth.
Use `parseConformanceFixture`, `safeParseConformanceFixture`, or
`validateConformanceFixtureText` when consuming fixture data through the public
API.

## v1 planner behavior

`planFromState(definitions, orgState)` is a pure operation: it does not connect
to Salesforce or apply DML. It merges the selected personas for each fixture
user, unions list-valued assignment targets, removes duplicate targets, and
calculates only additive work for these categories:

1. `PermissionSet`
2. `PermissionSetGroup`
3. `PublicGroup`
4. `Queue`

Existing permission assignments and group memberships for the current user do
not produce rows. A target missing from the corresponding simulated catalog
produces an `unmanaged` row with `action: "unresolved"`; a planned target uses
`status: "planned"` and `action: "wouldAssign"`. The planner does not remove
existing access or perform live-org validation.

Rows are sorted by `userKey`, the category order above, `detail`, and `action`.
The fixture harness compares the planner result to `expectedPlan` exactly and
also validates every fixture with the generated JSON Schema.

## Adding or changing fixtures

Add a numbered file under `conformance/fixtures/` such as
`08-new-case.json`. Keep IDs and references deterministic, make the scenario
small and focused, and update `expectedPlan` to match the ordering rules above.
Run the conformance tests and package checks before committing. A fixture or
expected-plan change changes the shared contract consumed by other engines and
must be reviewed as a conformance-specification change.

The fixture files contain no imports or executable code. They are included in
the npm package through the `/conformance` package file entry; the local
directory README gives the package-layout and fixture-authoring entry point.
