import { describe, expect, it } from 'vitest';
import {
  normalizeProviderBaseUrl,
  providerEndpointFingerprint,
} from '../../../src/adapters/model/provider-replay-context.js';

describe('provider replay context', () => {
  it('normalizes equivalent provider base URLs before fingerprinting', () => {
    expect(normalizeProviderBaseUrl(' HTTPS://API.Example.COM/v1/?b=2&a=1#fragment ')).toBe(
      'https://api.example.com/v1?a=1&b=2',
    );
    expect(providerEndpointFingerprint('https://api.example.com/v1/')).toBe(
      providerEndpointFingerprint('HTTPS://API.EXAMPLE.COM/v1'),
    );
  });

  it('keeps materially different endpoints in separate replay boundaries', () => {
    expect(providerEndpointFingerprint('https://api.example.com/v1')).not.toBe(
      providerEndpointFingerprint('https://api.example.com/v2'),
    );
  });
});
