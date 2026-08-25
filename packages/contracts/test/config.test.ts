import { describe, expect, it } from 'vitest';
import {
  BRAND_ICON_MAX_BYTES,
  defaultModelMaxOutputTokens,
  normalizeBrandIconConfig,
  normalizeRuntimeAccessModeConfig,
  runtimeAccessModeForConfig,
  runtimeAccessModeSelection,
} from '../src/config.js';

describe('normalizeBrandIconConfig', () => {
  it('normalizes preset keys', () => {
    expect(normalizeBrandIconConfig({ type: 'preset', key: '  MiniMax  ' })).toEqual({
      type: 'preset',
      key: 'minimax',
    });
  });

  it('accepts supported inline image types', () => {
    const dataUrl = `data:image/png;base64,${Buffer.from('provider icon').toString('base64')}`;
    expect(normalizeBrandIconConfig({ type: 'custom', dataUrl })).toEqual({ type: 'custom', dataUrl });
  });

  it('rejects SVG, malformed and oversized inline images', () => {
    expect(normalizeBrandIconConfig({ type: 'custom', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })).toBeUndefined();
    expect(normalizeBrandIconConfig({ type: 'custom', dataUrl: 'not-an-image' })).toBeUndefined();
    const oversized = Buffer.alloc(BRAND_ICON_MAX_BYTES + 1).toString('base64');
    expect(normalizeBrandIconConfig({ type: 'custom', dataUrl: `data:image/png;base64,${oversized}` })).toBeUndefined();
  });
});

describe('defaultModelMaxOutputTokens', () => {
  it('uses a conservative fallback for Anthropic models without discovered limits', () => {
    expect(defaultModelMaxOutputTokens('anthropic')).toBe(8192);
    expect(defaultModelMaxOutputTokens('openai-compatible')).toBe(68000);
    expect(defaultModelMaxOutputTokens('openai-responses')).toBe(68000);
  });
});

describe('runtime access modes', () => {
  it.each([
    ['request-approval', 'strict', 'user', 'workspace-write'],
    ['agent-approval', 'on-request', 'automatic', 'workspace-write'],
    ['full-access', 'full', 'user', 'danger-full-access'],
  ] as const)('keeps the %s mode atomic', (mode, approvalPolicy, approvalReviewer, permissionProfile) => {
    const selection = { approvalPolicy, approvalReviewer, permissionProfile };
    expect(runtimeAccessModeSelection(mode)).toEqual(selection);
    expect(runtimeAccessModeForConfig(selection)).toBe(mode);
    expect(normalizeRuntimeAccessModeConfig(selection)).toEqual(selection);
  });

  it.each([
    ['strict', 'read-only'],
    ['strict', 'danger-full-access'],
    ['on-request', 'read-only'],
    ['on-request', 'danger-full-access'],
    ['full', 'read-only'],
    ['full', 'workspace-write'],
  ] as const)('normalizes legacy %s + %s to agent approval', (approvalPolicy, permissionProfile) => {
    expect(normalizeRuntimeAccessModeConfig({ approvalPolicy, permissionProfile })).toEqual({
      approvalPolicy: 'on-request',
      approvalReviewer: 'automatic',
      permissionProfile: 'workspace-write',
    });
  });
});
