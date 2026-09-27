import { expect } from 'chai';
import { FREEZE, UNFREEZE } from '../../src/lifecycle/freezeState.js';

describe('lifecycle freeze directions', () => {
  it('describes both reversible state transitions', () => {
    const frozen = { Id: '0LL1', UserId: '0051', IsFrozen: true };
    const unfrozen = { Id: '0LL2', UserId: '0052', IsFrozen: false };
    expect(FREEZE.isAlreadyInState(frozen)).to.equal(true);
    expect(FREEZE.isAlreadyInState(unfrozen)).to.equal(false);
    expect(UNFREEZE.isAlreadyInState(unfrozen)).to.equal(true);
    expect(UNFREEZE.isAlreadyInState(frozen)).to.equal(false);
  });
});
