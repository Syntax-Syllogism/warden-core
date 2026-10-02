# Related-record synchronization

Provisioning can apply an optional related-record catalog before or after the User save.
The catalog is JSON and is validated by `assertValidRelatedCatalog` before any
related-record planning. Structural failures are `DefinitionError` instances;
structurally valid catalogs that fail runtime related-record checks produce a
batch-level `RelatedRecordsError`. An unresolvable source or match collision is
recorded on the affected user's plan.

The structural catalog contract and parser API are documented in
[File-format schemas](spec-schemas.md); the rules below describe the runtime
Salesforce semantics that follow structural validation.

Both `before` and `after` relationships are supported. Each
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
field or (only in `after`) `user.Id`; literal values use `{ "value": ... }`.
Fields may also read `context.<name>` by exact, case-sensitive key.
`mode` defaults to
`setIfEmpty`; `sync` permits the planned fields to be updated to their
configured values. Empty means `null` or `''`; whitespace is populated.

## Preflight and planning

Preflight describes each selected relationship sObject and checks that it is
queryable, that match and write fields exist and have suitable access, and
that the match field is filterable and external-id or unique. Account
relationships require an explicitly configured, active Person Account record
type available to the caller. Ineligible relationships become warnings and are
skipped after the caller's warning policy is applied.

`buildRelatedPlans` resolves per-user match values, queries existing records in
batches, and produces `RelatedRecordPlan` entries. It detects ambiguous matches
and collisions where multiple users select the same relationship and match
value, respecting the match field's case-sensitivity metadata. Related
planning errors in either phase prevent that user's entire write workflow.
On create, the match field is always written. A configured record type is
written only on create; a matched record with a different record type fails
the user rather than being retagged. A matched record with no planned fields
is reported as `matched`; otherwise the live phase creates or updates it in
batches of at most 200 records per sObject.
`sync` sends the configured fields even when their values already match.

The result distinguishes dry-run actions (`wouldCreate`, `wouldUpdate`,
`wouldSkip`, or `matched` when no write is needed) from live actions
(`created`, `updated`, `matched`, `skipped`, `deleted`, `deleteFailed`).
Related-record DML is partial-success and does not roll back the User save.

## Before relationships and per-user context

A `before` relationship runs before the User save and may copy a readable
related field onto a createable and updateable User field through `linkUser`.
For example, a Contact can supply `User.ContactId` for an external user:

```json
{
  "relationships": {
    "contact": {
      "sobject": "Contact",
      "phase": "before",
      "match": { "field": "External_Id__c", "from": "user.Username" },
      "fields": {
        "LastName": { "from": "user.LastName" },
        "AccountId": { "from": "context.account" }
      },
      "linkUser": { "userField": "ContactId", "fromRelatedField": "Id" }
    }
  }
}
```

The corresponding JSON user selects `related: ["contact"]` and supplies:

```json
{
  "relatedContext": {
    "account": {
      "lookup": {
        "sobject": "Account",
        "field": "External_Id__c",
        "value": { "value": "company" }
      }
    }
  }
}
```

Context values can be string, number, boolean, or null literals, or strict
lookup objects. A lookup's value is `{ "from": "user.Field" }` or
`{ "value": ... }`; it cannot reference context or `user.Id`. Only referenced
context entries are resolved. Metadata is never inferred from personas or
sent in User DML. Null, undefined, and empty User or context source values
and lookup values fail the user; `0` and `false` remain valid. A direct
`fields` literal such as `{ "value": null }` is passed through. Lookups
require a readable, filterable External ID or Unique field and exactly one
matching record. They are grouped by
object and field across users and resolve to the matching record's `Id`.
Queries contain at most 200 values and are split at a target of 18,000
characters; a single value whose escaped form exceeds this budget fails only
the users requesting that value and is never queried.

For a Person Account, declare a person-account record type and use
`linkUser.fromRelatedField: "PersonContactId"`. This generated field is never
writable in `fields`. Newly created records supply it through a batched read
between related DML and User DML. Matched records supply it from the initial
match query. The same linking rule applies to other readable fields: existing
records use the final planned value if the update writes that field, otherwise
the value observed during planning; newly created records use the
returned Id or a batched read for another field. An absent link value fails
the before stage and prevents the User save. `linkUser` is only permitted on
`before`; two selected relationships claiming the same User field fail that
user before any DML.

Before and after writes run separately per object, in partial-success batches
of at most 200 rows. A before failure prevents that user's save while other
users proceed. Live results retain before entries ahead of after entries,
including successful before writes when the User save subsequently fails. Created
before records remain by default when the User save fails. A dry-run plan performs
validation, lookups, matching and license reads with zero DML. Both provisioning APIs implement these stages.

For ContactId links, planning reports each selected Profile's UserLicense
name and affected user count as a warning. It does not classify licenses or
block a save; Salesforce determines eligibility.

## Optional cleanup on failure

Set `cleanupOnFailure: true` in provision options (or the legacy
`ProvisionUserRequest`) to attempt cleanup after all live provisioning stages.
The setting is stored in the JSON-safe plan; an absent setting means false.
Planning and preview rendering perform no deletes.

Only related records created in this apply pass for users whose final status is
`failed` qualify. Matched and updated records are never deleted. A before
record linked to a successfully saved User is kept and reported as `skipped`
with an explanatory `detail`, including Person Accounts whose generated
Contact supplies `User.ContactId`. The User is never deleted or reverted.

Eligible after records are deleted before before records, in requests of at
most 200 ids per sObject with `allOrNone: false`. Cleanup appends `deleted`
(`applied`) or `deleteFailed` (`failed`, with an error) to the existing
`users[].relatedRecords` history. Original failures and summary counters remain
unchanged; ownership tracking stays internal and CSV columns do not change.

Cleanup does not run for provisioning that crashes or is interrupted before
the cleanup stage. The callable `provision.apply()` checks cancellation before
entering cleanup; once cleanup starts, it finishes best-effort.
Delete failures are recorded without retry, including transport failures.
