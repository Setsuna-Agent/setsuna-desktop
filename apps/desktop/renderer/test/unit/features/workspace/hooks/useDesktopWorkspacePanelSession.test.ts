import { describe, expect, it } from 'vitest';
import {
  claimDesktopWorkspacePanelLayout,
  desktopWorkspaceBrowserPanelInstances,
  desktopWorkspacePanelLayout,
  resetDesktopWorkspacePanelLayout,
  updateDesktopWorkspacePanelLayout,
  type DesktopWorkspacePanelLayouts,
} from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanelSession.js';
import {
  addPanelToSlotState,
  createBrowserPanel,
  createReviewPanel,
} from '../../../../../src/features/workspace/model.js';

describe('desktop workspace panel sessions', () => {
  it('keeps panel layouts isolated by conversation', () => {
    const threadA = 'thread:A' as const;
    const threadB = 'thread:B' as const;
    const layouts = updateDesktopWorkspacePanelLayout({}, threadA, (current) => ({
      ...current,
      sidePanelExpanded: true,
      sidePanelSlot: addPanelToSlotState(current.sidePanelSlot, createReviewPanel()),
    }));

    expect(desktopWorkspacePanelLayout(layouts, threadA)).toMatchObject({
      sidePanelExpanded: true,
      sidePanelSlot: { active: 'review' },
    });
    expect(desktopWorkspacePanelLayout(layouts, threadB)).toMatchObject({
      sidePanelExpanded: false,
      sidePanelSlot: { active: null, panels: [] },
    });
  });

  it('restores the original layout after another conversation changes independently', () => {
    const threadA = 'thread:A' as const;
    const threadB = 'thread:B' as const;
    let layouts: DesktopWorkspacePanelLayouts = updateDesktopWorkspacePanelLayout({}, threadA, (current) => ({
      ...current,
      sidePanelExpanded: true,
      sidePanelSlot: addPanelToSlotState(current.sidePanelSlot, createReviewPanel()),
    }));
    layouts = updateDesktopWorkspacePanelLayout(layouts, threadB, (current) => ({
      ...current,
      sidePanelExpanded: false,
    }));

    expect(desktopWorkspacePanelLayout(layouts, threadA).sidePanelSlot.active).toBe('review');
    expect(desktopWorkspacePanelLayout(layouts, threadA).sidePanelExpanded).toBe(true);
  });

  it('keeps inactive conversation browsers in the mounted instance list', () => {
    const threadA = 'thread:A' as const;
    const threadB = 'thread:B' as const;
    const browser = createBrowserPanel('browser-A', 'https://example.com');
    const layouts = updateDesktopWorkspacePanelLayout({}, threadA, (current) => ({
      ...current,
      sidePanelExpanded: true,
      sidePanelSlot: addPanelToSlotState(current.sidePanelSlot, browser),
    }));

    const whileViewingB = desktopWorkspaceBrowserPanelInstances(layouts, threadB, false);
    const afterReturningToA = desktopWorkspaceBrowserPanelInstances(layouts, threadA, true);

    expect(whileViewingB).toEqual([{ active: false, panel: browser, targetIdentity: threadA }]);
    expect(afterReturningToA).toEqual([{ active: true, panel: browser, targetIdentity: threadA }]);
  });

  it('moves a new-thread layout to the created thread', () => {
    const draftIdentity = 'new-thread-slot:project-1' as const;
    let layouts = updateDesktopWorkspacePanelLayout({}, draftIdentity, (current) => ({
      ...current,
      sidePanelExpanded: true,
      sidePanelSlot: addPanelToSlotState(current.sidePanelSlot, createReviewPanel()),
    }));

    layouts = claimDesktopWorkspacePanelLayout(layouts, draftIdentity, 'created-1');

    expect(desktopWorkspacePanelLayout(layouts, 'thread:created-1').sidePanelSlot.active).toBe('review');
    expect(desktopWorkspacePanelLayout(layouts, draftIdentity).sidePanelSlot.active).toBeNull();
  });

  it('clears only the requested conversation layout', () => {
    const threadA = 'thread:A' as const;
    const threadB = 'thread:B' as const;
    let layouts = updateDesktopWorkspacePanelLayout({}, threadA, (current) => ({
      ...current,
      sidePanelExpanded: true,
      sidePanelSlot: addPanelToSlotState(current.sidePanelSlot, createReviewPanel()),
    }));
    layouts = updateDesktopWorkspacePanelLayout(layouts, threadB, (current) => ({
      ...current,
      sidePanelExpanded: true,
      sidePanelSlot: addPanelToSlotState(current.sidePanelSlot, createReviewPanel()),
    }));

    const resetLayouts = resetDesktopWorkspacePanelLayout(layouts, threadA);

    expect(desktopWorkspacePanelLayout(resetLayouts, threadA).sidePanelSlot.active).toBeNull();
    expect(desktopWorkspacePanelLayout(resetLayouts, threadB).sidePanelSlot.active).toBe('review');
    expect(resetDesktopWorkspacePanelLayout(layouts, 'thread:other')).toBe(layouts);
  });
});
