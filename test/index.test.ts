import { expect } from 'chai';
import * as api from '../src/index.js';

describe('public API', () => {
  it('exports exactly the pinned keys', () => {
    // Update this list deliberately when the public API changes; see the
    // versioning rules in docs/design/0001-warden-core-boundaries.md.
    expect(Object.keys(api).sort()).to.deep.equal(['WardenError', 'isWardenError']);
  });
});
