import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'chai';

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

// warden-core must stay usable outside the sf CLI (boundary rule 1), so the
// CLI framework and terminal-prompt packages may never become dependencies.
const FORBIDDEN = /^@oclif\/|sf-plugins-core|^@inquirer\//;
const FORBIDDEN_SOURCE_MARKERS = [
  '@oclif/',
  'sf-plugins-core',
  '@inquirer/',
  'Messages.load',
  'Messages.import',
] as const;

const forbiddenSourceMarkers = (source: string): string[] =>
  FORBIDDEN_SOURCE_MARKERS.filter((marker) => source.includes(marker));

describe('dependency boundary', () => {
  it('has no CLI framework or prompt dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageJson;
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    expect(names.filter((name) => FORBIDDEN.test(name))).to.deep.equal([]);
  });

  it('has no CLI framework imports or message catalogs in source', () => {
    const sourceRoot = new URL('../src', import.meta.url);
    const files = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : entry.name.endsWith('.ts') ? [path] : [];
      });
    const violations = files(sourceRoot.pathname).flatMap((file) => {
      const markers = forbiddenSourceMarkers(readFileSync(file, 'utf8'));
      return markers.map((marker) => `${file}: ${marker}`);
    });
    expect(violations).to.deep.equal([]);
  });

  it('detects every forbidden source marker independently', () => {
    for (const marker of FORBIDDEN_SOURCE_MARKERS) {
      expect(forbiddenSourceMarkers(`source ${marker} usage`)).to.deep.equal([marker]);
    }
  });
});
