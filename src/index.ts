// Everything exported from this file is warden-core's public API and is
// semver-covered: adding an export is a minor change, but removing or renaming
// one, or changing a signature or result shape, is breaking.
// `test/index.test.ts` pins the exported-key list so an accidental removal
// fails a test instead of shipping. See docs/design/0001-warden-core-boundaries.md.

export { WardenError, isWardenError } from './errors.js';
