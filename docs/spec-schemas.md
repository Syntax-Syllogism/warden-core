# File-format schemas

The file-format contract is defined by the Zod schemas in `src/spec/`. The
checked-in JSON Schema files under `schemas/` are generated from those schemas
for consumers that do not run TypeScript. They target Draft 2020-12 and are
included in the published package under the `./schemas/*` export.

The schemas validate structure only. Provisioning and related-record runtime
checks still validate Salesforce fields, references, access, and supported
operations after a document has passed the file-format parser.

## Formats

Persona, users, and related-catalog documents support an optional integer
`schemaVersion` of at least `1`. When it is omitted, the reader treats the
document as version 1. Those readers reject a version greater than 1 with
`schema-version-unsupported`; malformed values are `schema-invalid`. Snapshots
keep their existing `snapshotVersion` field and currently require the literal
value `1`.

### Persona definitions

The JSON document has a required `personas` object keyed by persona name:

```json
{
  "schemaVersion": 1,
  "personas": {
    "standard": {
      "profile": "Standard User",
      "permissionSets": ["Support_User"],
      "permissionSetMode": "additive",
      "userAttributes": { "Department": "Support" }
    }
  }
}
```

Known persona fields are `profile`, `role`, `permissionSets`,
`permissionSetGroups`, `publicGroups`, `queues`, `userAttributes`, and the
corresponding `additive`/`sync` mode fields. Persona objects and the top-level
document are open records: unknown keys are preserved. This permits metadata
such as `name` and `description`; it does not make those keys part of Warden's
provisioning behavior.

### Users definitions

The JSON document has a required `users` array. Each entry is an open User
field record. `personas`, when present, is a string array; other User fields
and provisioning metadata remain open to Salesforce describe metadata and
runtime validation.

The legacy singular `persona` key is not a structural schema failure, but the
provisioning definition validation rejects it as a semantic error. JSON users
can also use runtime fields such as `match`, `profile`, `role`, `fuzzyUsername`,
and `related`.

CSV users do not have a JSON Schema because their User columns come from
Salesforce describe metadata. The fixed Warden columns are `personas`,
`match`, and `fuzzyUsername`; all other columns are User API names. The
`personas` cell is a semicolon-separated list by default and can use the
`csvListDelimiter` option. Empty cells omit a key, and boolean fields accept
`true`, `false`, `1`, `0`, `yes`, or `no`.

### Related catalog

The JSON document has a required `relationships` object keyed by relationship
name. A relationship structurally contains:

- `sobject`, `phase` (`before` or `after`), and `match` (`field` and `from`);
- `fields`, whose values are either `{ "from": "user.Field" }` or a literal
  `{ "value": ... }` expression; and
- optional `recordType.developerName` and `mode` (`setIfEmpty` or `sync`);
  `recordType` and `mode` may also be explicitly `null`.

The schema preserves unknown metadata on the document, relationships, match,
and record-type objects. Source-expression objects are intentionally strict:
they must contain exactly one of `from` or `value`.

The current runtime supports only `after` relationships. It additionally
checks source scope, object and field access, match-field eligibility, record
type rules, cross-references, collisions, and other Salesforce semantics. See
[Related-record synchronization](related-records.md) for those runtime rules.

### Snapshots

Snapshot documents require `snapshotVersion: 1` and a `users` array. A
`capturedAt` string is written by current snapshot builders, but it is optional
for accepted legacy version-1 JSON snapshots. CSV snapshots always include the
`capturedAt` column; an empty cell represents that legacy omission and remains
round-trippable. Each user entry requires `match`, `matchValue`, and `userId`
strings; boolean `IsActive` and `IsFrozen`; and arrays for `permissionSets`,
`permissionSetGroups`, `publicGroups`, `queues`, and
`permissionSetLicenses`. The captured `name`, `username`, `email`, `profile`,
and `role` strings are optional. Snapshot documents and entries preserve
unknown keys; snapshots use `snapshotVersion` rather than the shared
`schemaVersion` policy.

### Conformance fixtures

Conformance fixtures are versioned JSON documents containing canonical persona
and user definitions, a simulated setup-object/assignment state, and an
expected deterministic v1 reconciliation plan. Their Zod schema is exported
as `conformanceFixtureSchema`; the pure planner is `planFromState`. See the
[conformance guide](conformance.md) and the top-level
[`conformance/README.md`](../conformance/README.md) for the fixture format and
canonical examples.

## Parser API

The public API exports a schema, an inferred type, and three parser forms for
each JSON format:

- `parsePersonaDefinitions`, `parseUsersDefinition`, `parseRelatedCatalog`,
  `parseSnapshot`, and `parseConformanceFixture` return parsed data or throw
  `DefinitionError`.
- The matching `safeParse*` functions return a `SchemaResult` without throwing
  for structural or version failures.
- The matching `validate*Text` functions parse JSON text in memory, so editors
  can validate unsaved buffers without filesystem access.

Failure results use `schema-invalid` for JSON or structural errors and
`schema-version-unsupported` for unsupported persona, users, or related-catalog
versions. `data.issues` contains `{ path, message }` entries; `path` is an
array of string and number segments, with an empty path representing the
document root. The throwing parsers expose the same issues on the
`DefinitionError` data.

## Generating the artifacts

`npm run build` compiles the TypeScript schemas and regenerates all five files:

- `schemas/persona-definitions.schema.json`
- `schemas/users-definition.schema.json`
- `schemas/related-catalog.schema.json`
- `schemas/snapshot.schema.json`
- `schemas/conformance-fixture.schema.json`

Run `npm run schemas:check` when changing a schema or its descriptions. It
regenerates the artifacts and fails if the checked-in `schemas/` files differ.
Keep generated schema changes in the same commit as their source Zod changes.
