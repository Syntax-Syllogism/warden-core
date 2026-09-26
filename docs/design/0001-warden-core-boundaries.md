# 0001 — warden-core boundaries

**Status:** Accepted
**Date:** 2026-09-26

## Context

All Warden logic lived inside the `warden` oclif plugin. The only way for
another consumer to use it was to install the plugin and spawn `sf warden …`,
which is what the Warden VS Code extension did: slow (a process start plus a
plugin load per command), text-over-stdout only, and coupled to CLI flag names
through a vendored oclif manifest. The Warden SFDX package needs the same
specification (definition-file schemas, conformance fixtures) and had no way to
share it.

warden-core is the shared engine for three front ends:

| Consumer | How it uses warden-core |
| --- | --- |
| `warden` sf plugin | Imports the library; commands become thin adapters (flags, prompts, rendering). |
| Warden VS Code extension | Imports the library in the extension host, instead of spawning the CLI. |
| Warden SFDX package | Consumes data only (conformance fixtures as a static resource); Apex cannot import TypeScript. |

The design follows the `-core` library pattern used by SimplySF's
`simply-plugins-core`, as a single package rather than a monorepo.

## Decisions

| # | Decision |
| --- | --- |
| D1 | warden-core holds the full domain library (every command workflow as a callable use case) plus the specification assets, not just the specification. |
| D2 | One repository, one npm package: `@syntax-syllogism/warden-core`. Split into several packages only when a real consumer needs a subset. |
| D3 | The SFDX package consumes warden-core as an exact-pinned devDependency and commits a generated static resource, with a CI check that it is in sync. |
| D4 | Semantic versioning, and consumers pin exact versions. A change that rejects previously valid input or changes an expected plan is major. Versioned file formats carry a `schemaVersion`. |
| D5 | Errors are typed: `WardenError` with a stable `code`, structured `data`, and default English text owned by warden-core. |
| D6 | Each use case exports a zod options schema with UI hints. Front ends build their inputs from it; the CLI keeps its own flags and tests that they map onto the same options. |
| D7 | The VS Code extension runs in process only; it does not keep a spawn-the-CLI fallback. |
| D8 | zod is the source of truth for file-format schemas; JSON Schema is generated from it for non-TypeScript consumers. |

## Rules

Every module in warden-core follows these rules. Extractions from the plugin
move the code that complies and leave the rest behind.

1. **No CLI framework.** No `@oclif/core`, `@salesforce/sf-plugins-core`, or
   `@inquirer/*`; no `Flags`, `ux`, spinners, tables, or interactive prompts.
   `test/dependencies.test.ts` enforces the dependency part.
2. **The caller supplies the connection.** Functions take an
   `@salesforce/core` `Connection` (or `Org`); they never resolve an org from
   flags or configuration themselves.
3. **No prompting; writes are split into plan and apply.** A use case that
   changes org state returns a plan; the caller shows it, confirms, and calls
   apply. Core never accepts a confirm callback.
4. **Progress and cancellation are injected** through an optional
   `onProgress(event)` callback and an optional `AbortSignal`, checked between
   batches.
5. **Errors are typed** (D5). Subclasses narrow `code` to a string-literal
   union. `code` and the `data` shape are semver-covered; message wording is
   not.
6. **Filesystem access is allowed**, because every front end runs on Node, but
   every function that reads a file also has an in-memory variant (for example
   parsing text instead of a path), so an editor can validate unsaved buffers.
7. **Rendering stays pure.** Text and CSV renderers return strings; printing
   is the caller's job.
8. **The public API is `src/index.ts` only.** Adding an export is a minor
   change; removing or renaming one, or changing a signature or result shape,
   is major. `test/index.test.ts` pins the exported keys.

## Open questions

- **`@salesforce/core`: dependency or peerDependency?** It is a regular
  dependency for now, as in simply-*-core. If bundling warden-core into the VS
  Code extension shows that two copies of `@salesforce/core` cause `instanceof`
  or auth-state problems, make it a peerDependency and record that here.

## Consequences

- The plugin's `messages/*.md` keep command help text only; runtime error text
  moves into warden-core.
- Front ends own everything user-interactive: org selection, prompts,
  confirmations, output files, and presentation.
- Every warden-core release that a consumer adopts is a deliberate pin bump in
  that consumer.
