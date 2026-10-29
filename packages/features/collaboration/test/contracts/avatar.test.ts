import { BRAND_ICON_MAX_BYTES } from '@setsuna-desktop/contracts';
import { expect, it } from 'vitest';
import { collaborationAgentSettingsCodec, defaultCollaborationAgentSettings } from '../../src/contracts/index.js';

it('keeps old settings valid and persists both preset colors and bounded image avatars through the settings codec', () => {
  const settings = defaultCollaborationAgentSettings();
  expect(collaborationAgentSettingsCodec.parse(settings)).toEqual(settings);
  const avatars = [{ type: 'preset', key: 'gem', color: 'text' }, { type: 'custom', dataUrl: 'data:image/webp;base64,UklGRg==' }];
  for (const avatar of avatars) {
    const configured = { ...settings, roles: settings.roles.map((role) => ({ ...role, avatar })) };
    expect(collaborationAgentSettingsCodec.parse(JSON.parse(JSON.stringify(configured)))).toEqual(configured);
  }
});

it('rejects unknown glyphs, CSS injection, remote images, active formats and oversized image data at the settings boundary', () => {
  const settings = defaultCollaborationAgentSettings();
  const invalid = [
    { type: 'preset', key: 'not-an-agent-icon' },
    { type: 'preset', key: 'gem', color: 'url(https://example.com/icon)' },
    { type: 'custom', dataUrl: 'https://example.com/avatar.png' },
    { type: 'custom', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { type: 'custom', dataUrl: `data:image/png;base64,${Buffer.alloc(BRAND_ICON_MAX_BYTES + 1).toString('base64')}` },
  ];
  for (const avatar of invalid) {
    expect(() => collaborationAgentSettingsCodec.parse({ ...settings, roles: [{ ...settings.roles[0], avatar }] })).toThrow();
  }
});
