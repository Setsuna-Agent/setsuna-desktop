import { describe, expect, it } from 'vitest';
import {
  createChatSkillSelectionRequest,
  resolveShellSidebarState,
} from '../../../../src/app/controller/useDesktopAppController.js';

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

describe('createChatSkillSelectionRequest', () => {
  it('targets the next active main composer without an ephemeral composer identity', () => {
    expect(createChatSkillSelectionRequest('skill-creator', 3)).toEqual({
      skillId: 'skill-creator',
      requestId: 3,
    });
  });
});
