import { describe, expect, it } from 'vitest';
import {
  safeConversationDebugJson,
  sanitizeConversationDebugText,
  sanitizeConversationDebugValue,
} from '../../../../src/features/conversation-debug/conversationDebugSerialization.js';

describe('conversation debug serialization', () => {
  it('redacts sensitive fields and omits inline data URLs', () => {
    const result = sanitizeConversationDebugValue({
      apiKey: 'sk-secret',
      accessToken: 'access-secret',
      authorization: 'Bearer secret',
      attachment: 'data:image/png;base64,AAAA',
      argumentsPreview: '{"token":"secret-token","value":"safe"}',
      awsSecretAccessKey: 'cloud-secret',
      embeddedPayload:
        '{"x-api-key":"header-secret","attachment":"data:image/png;base64,AAAA"}',
      freeform: 'x-api-key=header-secret awsSecretAccessKey: cloud-secret',
      nested: { password: 'hidden', visible: 'safe' },
      'x-api-key': 'header-secret',
    });

    expect(result).toEqual({
      apiKey: '[redacted]',
      accessToken: '[redacted]',
      authorization: '[redacted]',
      attachment: '[data URL omitted: image/png, 26 chars]',
      argumentsPreview: '{"token":"[redacted]","value":"safe"}',
      awsSecretAccessKey: '[redacted]',
      embeddedPayload:
        '{"x-api-key":"[redacted]","attachment":"[data URL omitted: image/png, 26 chars]"}',
      freeform: 'x-api-key="[redacted]" awsSecretAccessKey: "[redacted]"',
      nested: { password: '[redacted]', visible: 'safe' },
      'x-api-key': '[redacted]',
    });
  });

  it('bounds oversized and cyclic payloads', () => {
    const value: { content: string; self?: unknown } = { content: 'x'.repeat(8_100) };
    value.self = value;

    const json = safeConversationDebugJson(value);

    expect(json).toContain('[100 chars omitted]');
    expect(json).toContain('[circular]');
    expect(json.length).toBeLessThan(8_500);
  });

  it('redacts malformed quoted assignments without unbounded backtracking', () => {
    const malformedArguments = `x-api-key="${'\\'.repeat(100_000)}`;

    const result = sanitizeConversationDebugText(malformedArguments);

    expect(result).toContain('x-api-key="[redacted]"');
    expect(result).toContain('chars omitted');
    expect(result.length).toBeLessThan(100);
  });
});
