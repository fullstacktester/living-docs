import { describe, expect, it } from 'vitest';
import { humanise, placement } from '../src/index.js';

describe('placement', () => {
  it('humanises folder and file names', () => {
    expect(humanise('sign-in')).toBe('Sign in');
    expect(humanise('form_config')).toBe('Form config');
  });

  it('reads the level and feature from the folders under testDir', () => {
    expect(placement('api/forms/lookup.spec.ts')).toEqual({
      level: 'API',
      feature: 'Forms',
      spec: 'Lookup',
    });
    expect(placement('ui/sign-in/sign-in.spec.ts')).toEqual({
      level: 'UI',
      feature: 'Sign in',
      spec: 'Sign in',
    });
  });

  it('capitalises a short level name and humanises a longer one', () => {
    expect(placement('e2e/orders/checkout.spec.ts').level).toBe('E2E');
    expect(placement('contract/orders/create.spec.ts').level).toBe('Contract');
  });

  it('keeps a spec in a deeper folder in its feature', () => {
    expect(placement('api/forms/lookup/by-id.spec.ts')).toEqual({
      level: 'API',
      feature: 'Forms',
      spec: 'By id',
    });
  });

  it('names a spec straight in a level folder as its own feature', () => {
    expect(placement('api/health.spec.ts')).toEqual({
      level: 'API',
      feature: 'Health',
      spec: 'Health',
    });
  });

  it('puts a spec straight in testDir in level Other', () => {
    expect(placement('login.test.ts')).toEqual({
      level: 'Other',
      feature: 'Login',
      spec: 'Login',
    });
  });
});
