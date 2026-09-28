# Warden conformance fixtures

This directory contains the canonical, versioned JSON fixtures shipped in the
`@syntax-syllogism/warden-core` package. The full fixture contract, v1 planner
semantics, deterministic ordering, and public API are documented in the
[published conformance guide](https://github.com/Syntax-Syllogism/warden-core/blob/release/docs/conformance.md).

The generated structural contract is
[`schemas/conformance-fixture.schema.json`](../schemas/conformance-fixture.schema.json).

## Adding a fixture

Use a numbered filename such as `08-new-case.json`. Keep all references and
IDs deterministic, add the smallest scenario that demonstrates one behavior,
and calculate `expectedPlan` according to the
[v1 planner behavior](https://github.com/Syntax-Syllogism/warden-core/blob/release/docs/conformance.md#v1-planner-behavior). Run the
conformance test and normal package checks before committing.

Fixtures contain no imports or executable code. They are shipped in the
`@syntax-syllogism/warden-core` package so a potential future Apex consumer can
load them without transformation.
