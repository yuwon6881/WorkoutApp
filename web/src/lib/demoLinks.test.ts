import { describe, expect, it } from 'vitest';
import { demoNameKey, demoUrlForName } from './demoLinks';

describe('imported exercise demos', () => {
  it('finds a printed substitution after selecting its catalog spelling', () => {
    const url = 'https://youtu.be/example';
    const links = { 'seated super bayesian high cable curl': url };

    expect(demoNameKey('Seated Super-Bayesian High Cable Curl')).toBe('seated super bayesian high cable curl');
    expect(demoUrlForName(links, 'Seated Super-Bayesian High Cable Curl')).toBe(url);
    expect(demoUrlForName(links, 'Different curl')).toBeNull();
  });
});
