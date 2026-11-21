import { describe, it, expect } from 'vitest';
import { isOutdated } from '../../src/version.js';

describe('version check', () => {
  it('detects a newer published build', () => { expect(isOutdated('abc-1', 'abc-2')).toBe(true); });
  it('is quiet when the running build is the published one', () => { expect(isOutdated('abc-1', 'abc-1')).toBe(false); });
  it('never nags in dev/test or when nothing is published', () => {
    expect(isOutdated('dev', 'abc-2')).toBe(false);
    expect(isOutdated('test', 'abc-2')).toBe(false);
    expect(isOutdated('abc-1', null)).toBe(false);
    expect(isOutdated('abc-1', 'dev')).toBe(false);
  });
});
