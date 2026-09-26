# Related-record synchronization

Provisioning can apply an optional related-record catalog after the User save.
The catalog is JSON and is validated by `assertValidRelatedCatalog` before any
related-record planning. Structural failures are `DefinitionError` instances;
structurally valid catalogs that fail runtime related-record checks produce a
batch-level `RelatedRecordsError`. An unresolvable source or match collision is
recorded on the affected user's plan.

The structural catalog contract and parser API are documented in
[File-format schemas](spec-schemas.md); the rules below describe the runtime
Salesforce semantics that follow structural validation.

The current implementation supports only `after` relationships. Each
relationship has this shape:

```json
{
  "relationships": {
    "account": {
      "sobject": "Account",
      "phase": "after",
      "match": { "field": "External_Id__c", "from": "user.FederationIdentifier" },
      "fields": {
        "Name": { "from": "user.Name" },
        "Source__c": { "value": "warden" }
      },
      "mode": "setIfEmpty"
    }
  }
}
```

`match.from` must be a User field (not `user.Id`). Field sources may use a User
field or `user.Id`; literal values use `{ "value": ... }`. `context.*` sources,
`linkUser`, and `before` phases are rejected. `mode` defaults to
`setIfEmpty`; `sync` permits the planned fields to be updated to their
configured values. Empty means `null` or `''`; whitespace is populated.

## Preflight and planning

Preflight describes each selected relationship sObject and checks that it is
queryable, that match and write fields exist and have suitable access, and
that the match field is filterable and external-id or unique. Account
relationships require an active record type, including a person-account
record type when applicable. Ineligible relationships become warnings and are
skipped after the caller's warning policy is applied.

`buildRelatedPlans` resolves per-user match values, queries existing records in
batches, and produces `RelatedRecordPlan` entries. It detects ambiguous matches
and collisions where multiple users would write the same related record. A
matched record with no changes is reported as `matched`; otherwise the live
phase creates or updates it in batches of at most 200 records per sObject.

The result distinguishes dry-run actions (`wouldCreate`, `wouldUpdate`,
`wouldSkip`) from live actions (`created`, `updated`, `matched`, `skipped`).
Related-record DML is partial-success and does not roll back the User save.
