import { expect } from 'chai';
import { confirmWithTimeout } from '../../src/shared/prompt.js';

describe('shared prompt helpers', () => {
  it('returns confirmed prompt responses without marking a timeout', async () => {
    const result = await confirmWithTimeout(async () => true, 'Continue?', 50);

    expect(result).to.deep.equal({ confirmed: true, timedOut: false });
  });

  it('marks a timed-out prompt as not confirmed', async () => {
    const result = await confirmWithTimeout(() => new Promise<boolean>(() => undefined), 'Continue?', 1);

    expect(result).to.deep.equal({ confirmed: false, timedOut: true });
  });
});
