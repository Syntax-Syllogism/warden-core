#!/usr/bin/env node
// Verifies the npm tarball contents: the entry point must be present and
// nothing outside package.json `files` (plus npm's always-included files)
// may leak in. Run after `npm run build`.
import { execFileSync } from 'node:child_process';

const [pack] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' })
);
const paths = pack.files.map((file) => file.path);
const allowed = [
  /^lib\//,
  /^schemas\//,
  /^conformance\//,
  /^CHANGELOG\.md$/,
  /^LICENSE$/,
  /^README\.md$/,
  /^package\.json$/,
];
const unexpected = paths.filter((path) => !allowed.some((pattern) => pattern.test(path)));
const missing = ['lib/index.js', 'lib/index.d.ts', 'LICENSE', 'CHANGELOG.md'].filter((path) => !paths.includes(path));

if (unexpected.length > 0 || missing.length > 0) {
  if (unexpected.length > 0) console.error(`Unexpected files in package: ${unexpected.join(', ')}`);
  if (missing.length > 0) console.error(`Missing files in package: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Package contents OK (${paths.length} files).`);
