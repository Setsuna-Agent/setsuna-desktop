import { describe, expect, it } from 'vitest';
import { canFitDesktopSidebar, shouldCollapseSidebar } from './useDesktopSidebarAutoCollapse.js';

describe('desktop sidebar auto collapse', () => {
  it('keeps the sidebar expanded when the main content and workspace can both fit', () => {
    expect(canFitDesktopSidebar({
      sidebarWidth: 240,
      viewportWidth: 1320,
      workspaceVisible: true,
      workspaceWidth: 560,
    })).toBe(true);
  });

  it('auto-collapses the sidebar when an open workspace panel would squeeze the main content', () => {
    expect(canFitDesktopSidebar({
      sidebarWidth: 240,
      viewportWidth: 1180,
      workspaceVisible: true,
      workspaceWidth: 560,
    })).toBe(false);
  });

  it('auto-collapses before the collapsed-sidebar minimum window width is reached', () => {
    expect(canFitDesktopSidebar({
      sidebarWidth: 240,
      viewportWidth: 1119,
      workspaceVisible: true,
      workspaceWidth: 460,
    })).toBe(false);
    expect(canFitDesktopSidebar({
      sidebarWidth: 240,
      viewportWidth: 1120,
      workspaceVisible: true,
      workspaceWidth: 460,
    })).toBe(true);
  });

  it('uses the mobile breakpoint even when the workspace panel is closed', () => {
    expect(canFitDesktopSidebar({
      sidebarWidth: 240,
      viewportWidth: 760,
      workspaceVisible: false,
      workspaceWidth: 560,
    })).toBe(false);
    expect(canFitDesktopSidebar({
      sidebarWidth: 240,
      viewportWidth: 900,
      workspaceVisible: false,
      workspaceWidth: 560,
    })).toBe(true);
  });

  it('separates manual collapse from temporary manual expansion', () => {
    expect(shouldCollapseSidebar({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: false })).toBe(true);
    expect(shouldCollapseSidebar({ canExpand: false, manuallyCollapsed: false, manuallyExpanded: true })).toBe(false);
    expect(shouldCollapseSidebar({ canExpand: true, manuallyCollapsed: true, manuallyExpanded: true })).toBe(true);
  });
});
