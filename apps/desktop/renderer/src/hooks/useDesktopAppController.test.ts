import { describe, expect, it } from 'vitest';
import { resolveShellSidebarState } from './useDesktopAppController.js';

describe('resolveShellSidebarState', () => {
  it('keeps the settings navigation in the shared sidebar track', () => {
    expect(resolveShellSidebarState('settings', true)).toEqual({
      collapsed: false,
      reservesLayout: true,
    });
  });

  it('preserves the collapsible sidebar behavior for regular workbench views', () => {
    expect(resolveShellSidebarState('chat', true)).toEqual({
      collapsed: true,
      reservesLayout: false,
    });
    expect(resolveShellSidebarState('capabilities', false)).toEqual({
      collapsed: false,
      reservesLayout: true,
    });
  });
});
