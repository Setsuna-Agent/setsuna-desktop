import { describe, expect, it } from 'vitest';
import { defaultMarkdownLinkOpenMode, markdownLinkOpenModeFromConfig } from './markdownLinkPreference.js';

describe('markdownLinkOpenModeFromConfig', () => {
  it('defaults Markdown Web links to the in-app browser', () => {
    expect(defaultMarkdownLinkOpenMode).toBe('in-app');
    expect(markdownLinkOpenModeFromConfig(null)).toBe('in-app');
    expect(markdownLinkOpenModeFromConfig({ desktopSettings: {} })).toBe('in-app');
  });

  it('keeps an explicit system-browser preference', () => {
    expect(markdownLinkOpenModeFromConfig({
      desktopSettings: { markdownLinkOpenMode: 'external' },
    })).toBe('external');
  });
});
