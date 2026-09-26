# warden-core

Shared Warden engine: the user-lifecycle library behind the
[`warden`](https://github.com/Syntax-Syllogism/warden) Salesforce CLI plugin,
the Warden VS Code extension, and the Warden SFDX package.

warden-core is a plain Node/TypeScript library with no CLI framework
dependency. Call its functions directly from a script, an editor extension, a
CI job, or any other Node codebase.

The [domain guides](docs/) describe the implemented workflows and data
contracts for [access auditing](docs/access.md),
[lifecycle operations](docs/lifecycle.md), [provisioning](docs/provisioning.md),
[related records](docs/related-records.md), and [user matching](docs/matching.md).

## Install

```bash
npm install @syntax-syllogism/warden-core
```

Requires Node.js 22 or later.

## API

| Export | Purpose |
| --- | --- |
| `WardenError` | Base class for every error warden-core throws on purpose. Carries a stable `code`, optional structured `data`, and a default English `message`. |
| `isWardenError(error)` | Structural type guard for `WardenError`; safe across duplicate copies of this package. |
| `AccessError`, `UserAccessError` | Typed access-audit errors. |
| `LifecycleError` | Typed lifecycle-operation errors. |
| `ProvisioningError`, `DefinitionError` | Typed provisioning and definition-reading errors. |
| `RelatedRecordsError` | Typed related-record catalog errors. |
| File-format schemas and parsers | Zod schemas, JSON-text validators, and inferred types for persona, users, related-catalog, and snapshot files. |
| Lifecycle, access, provisioning, CSV, snapshot, and rendering functions | Framework-free domain operations used by Warden consumers. |

```ts
import { isWardenError } from '@syntax-syllogism/warden-core';

try {
  // call a warden-core function
} catch (error) {
  if (isWardenError(error)) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    throw error;
  }
}
```

## Errors

Errors are reported as `WardenError` instances (or area-specific subclasses).
The `code` and the shape of `data` are part of the public API; the `message`
text is not and may be reworded in any release.

| Code | Thrown by |
| --- | --- |
| `errorUnsupportedAccessType`, `errorInvalidTarget`, `errorFieldTargetMustBeQualified`, `errorObjectNotFound`, `errorFieldNotFound`, `errorApexClassNotFound`, `errorVisualforcePageNotFound`, `errorCustomPermissionNotFound`, `errorTabNotFound`, `errorRecordTypeTargetMustBeQualified`, `errorMasterRecordTypeUnsupported`, `errorRecordTypeNotFound`, `errorRecordTypeAmbiguous`, `errorRecordTypeInactive`, `errorRecordTypeMetadataReadFailed`, `errorAccessQueryFailed` | Access audit and target resolution. |
| `errorInvalidCsv`, `errorInvalidJson`, `errorInvalidPersonaDefinition`, `errorMissingUserFieldMap`, `errorPersonasWithoutDefinition` | Definition readers. |
| `errorInvalidJson`, `errorInvalidUserMatchField`, `errorInvalidUserValue`, `errorInvalidAgainstValue`, `errorInvalidAgainstMatchField`, `errorInvalidSnapshot`, `errorPromptDeclined` | Lifecycle targeting, snapshot validation, and operations. |
| `errorInvalidRelatedCatalog`, `errorRelationshipInvalidDefinition`, `errorRelationshipInvalidSobject`, `errorRelationshipMissingPhase`, `errorRelationshipInvalidPhase`, `errorPhaseBeforeUnsupported`, `errorLinkUserUnsupported`, `errorRelatedContextUnsupported`, `errorRelationshipInvalidMatch`, `errorRelationshipMatchFromUserId`, `errorRelationshipInvalidFields`, `errorRelationshipInvalidSource`, `errorRelationshipInvalidFrom`, `errorRelationshipUnknownUserField`, `errorRelationshipUnwritableField`, `errorRelationshipInvalidMode`, `errorRelationshipInvalidRecordType` | Related-record catalog validation. |
| `errorDuplicateExternalIdMatch`, `errorMissingRequiredFields`, `errorMissingSaveId`, `errorPromptDeclined`, `errorInvalidJson`, `errorInvalidPersonaDefinition`, `errorPersonasWithoutDefinition` | Provisioning execution and planning. |
| `schema-invalid`, `schema-version-unsupported` | Structural file-format validation. `data.issues` contains `{ path, message }` entries. |

## File formats and schemas

The four JSON file formats are defined by the exported Zod schemas and the
generated Draft 2020-12 schemas. See the detailed
[file-format schema guide](docs/spec-schemas.md)
for the full structural contract, parser results, versioning behavior, and
artifact-generation workflow.

- [persona definitions](schemas/persona-definitions.schema.json):
  `{ personas: Record<string, Persona> }`.
- [users definitions](schemas/users-definition.schema.json):
  `{ users: UserInput[] }`, where User fields are an open record and
  `personas` is an optional string array.
- [related catalog](schemas/related-catalog.schema.json):
  `{ relationships: Record<string, RelationshipDef> }`.
- [snapshot](schemas/snapshot.schema.json): the lifecycle snapshot with
  `snapshotVersion: 1`.

## Versioning

warden-core follows [Semantic Versioning](https://semver.org/). Removing or
renaming an export, changing a signature or result shape, changing an error
`code`, or rejecting input that was previously valid is a major change.
Consumers should pin an exact version and upgrade deliberately.

## Development

```bash
npm install
npm run build
npm test          # typecheck, lint, prettier, mocha + coverage
npm run pack:check
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

[MIT](LICENSE) © Jake Richter
