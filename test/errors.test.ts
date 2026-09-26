import { expect } from 'chai';
import { UserAccessError } from '../src/access/types.js';
import { WardenError, isWardenError } from '../src/errors.js';

describe('WardenError', () => {
  it('carries code, message, and data', () => {
    const error = new WardenError('schema-invalid', 'Invalid file', { path: 'a.json' });
    expect(error).to.be.instanceOf(Error);
    expect(error.name).to.equal('WardenError');
    expect(error.code).to.equal('schema-invalid');
    expect(error.message).to.equal('Invalid file');
    expect(error.data).to.deep.equal({ path: 'a.json' });
  });

  it('allows data to be omitted', () => {
    expect(new WardenError('cancelled', 'Cancelled').data).to.equal(undefined);
  });
});

describe('isWardenError', () => {
  it('recognizes instances', () => {
    expect(isWardenError(new WardenError('cancelled', 'Cancelled'))).to.equal(true);
  });

  it('recognizes a structurally cloned WardenError from another package copy', () => {
    const clone: unknown = structuredClone({ name: 'WardenError', code: 'cancelled', message: 'Cancelled' });
    expect(isWardenError(clone)).to.equal(true);
  });

  it('recognizes structurally cloned area errors from another package copy', () => {
    const clone: unknown = structuredClone({
      name: 'UserAccessError',
      code: 'errorInvalidTarget',
      message: 'Invalid target value: User.',
    });
    expect(isWardenError(clone)).to.equal(true);
    expect(isWardenError(new UserAccessError('errorInvalidTarget', ['User']))).to.equal(true);
  });

  it('rejects other values', () => {
    expect(isWardenError(new Error('plain'))).to.equal(false);
    expect(isWardenError({ name: 'WardenError', message: 'no code' })).to.equal(false);
    expect(isWardenError(null)).to.equal(false);
    expect(isWardenError('WardenError')).to.equal(false);
  });
});
