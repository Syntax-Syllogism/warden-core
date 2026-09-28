# Access auditing

The public `access.run()` orchestration is documented in
[Callable command use cases](use-cases.md). The lower-level resolver described
below remains useful when a caller already has a validated target and user.

The access domain answers the reverse question: which active-user grants give a
specified user access to one Salesforce target? The workflow validates a target
against the org, then resolves the user's Profile, Permission Set, and
Permission Set Group grants into a `UserAccessResult`.

The lower-level entry point is `resolveReverseAccess(connection, user, target)`;
the public command use case is `access.run(connection, options)`.
`user` is `{ Id, name, username }`; callers normally obtain `target` by using
the matching validator in `src/access/targetValidation.ts`. The resolver
returns rows with the user identity, assignment/source provenance, typed access
flags, aggregate counts, and warnings. A Permission Set Group row also records
the component Permission Set through `viaPermissionSetId` and
`viaPermissionSetName`.

## Target forms

The validators accept these target types:

| Type | Target syntax | Access represented |
| --- | --- | --- |
| `field` | `ObjectApiName.FieldApiName` | Read and edit |
| `object` | `ObjectApiName` | Read, create, edit, delete, view-all, modify-all |
| `apex-class` | Apex class name | Enabled |
| `vf-page` | Visualforce page name | Enabled |
| `custom-permission` | Custom permission DeveloperName | Enabled |
| `tab` | `TabDefinition.DurableId` | Visibility |
| `record-type` | `ObjectApiName.RecordTypeDeveloperName` | Visible and default |

Field and record-type targets must be qualified. The master record type is not
supported. Target validation canonicalizes object and field names from the
org's describe data and rejects inactive or ambiguous record types.

`reverseCsvColumns(type)` returns the CSV columns for a result. The access
resolver itself does not print or write files; table and CSV rendering remains
the caller's responsibility. `src/access/output.ts` contains the renderer
helpers used by front ends. `renderAccessResult(result, userLabel?)` composes
the human summary and grant table, including the user-scoped empty state.
See [Human and CSV rendering](rendering.md) for output details.

## Salesforce and failure behavior

Permission Set Group grants are traced through their component Permission Sets.
Muting Permission Sets are applied to field, object, and record-type metadata
before rows are emitted. Missing metadata is reported in `warnings` where a
partial result can still be returned. Profile-level tab visibility is also
reported as a warning because it is not exposed as a clean
`PermissionSetTabSetting` data-API grant.

Expected failures are `AccessError`/`UserAccessError` instances. Consumers
should branch on the stable `code`, not on English message text; unexpected
query failures are wrapped as `errorAccessQueryFailed`.
