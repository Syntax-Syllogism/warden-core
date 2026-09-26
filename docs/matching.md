# User matching

User matching is the shared lookup layer used by provisioning and lifecycle
targeting. It resolves a batch of `{ field, value, fuzzy?, key? }` requests
against Salesforce `User` records and returns:

- `existingByField`: a field/value index for planning;
- `matchesByRequest`: every matching user for each request key; and
- `duplicates`: keys that are unsafe to use because more than one user matched.

The implementation is in `src/matching/index.ts`; the public workflows expose
its behavior rather than exporting the resolver directly from `src/index.ts`.

## Exact and fuzzy matching

Exact requests are grouped by field and queried in batches. Comparison of the
returned values is case-insensitive, and a request with multiple matches is
marked duplicate rather than choosing a user. `Id` is accepted without a
describe entry; every other field must be filterable according to User describe
metadata.

When `fuzzy` is true for `Username`, the request matches either the exact
username or usernames beginning with `<value>.` (the org/domain suffix form).
Multiple fuzzy matches, including a user shared by multiple fuzzy bases, are
duplicates. Empty or non-string values do not issue a lookup.

Queries are split by both Salesforce `IN`-list size and query-text limits.
SOQL values are escaped before querying. Matching does not mutate users or
perform DML.

## How callers use the result

Lifecycle target resolution turns duplicate and zero-match entries into ordered
per-target errors while preserving CSV path/line context. Provisioning uses a
single match field per user, with an optional default external-id field, and
fails duplicate matches rather than creating or updating an uncertain user.

Use `matchKey(field, value)` for the same key format used by the resolver. Use
`validateMatchField` with the described User field map before accepting a field
from user input.

