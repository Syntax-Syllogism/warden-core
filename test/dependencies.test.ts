import { readFileSync } from 'node:fs';
import { expect } from 'chai';

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

// warden-core must stay usable outside the sf CLI (boundary rule 1), so the
// CLI framework and terminal-prompt packages may never become dependencies.
const FORBIDDEN = /^@oclif\/|sf-plugins-core|^@inquirer\//;

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
});
