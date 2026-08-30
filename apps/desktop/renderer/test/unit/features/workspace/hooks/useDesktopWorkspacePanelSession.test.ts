import { describe, expect, it } from 'vitest';
import {
  claimDesktopWorkspacePanelLayout,
  desktopWorkspaceBrowserPanelInstances,
  desktopWorkspacePanelLayout,
  desktopWorkspacePanelTargetContext,
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

    const whileViewingB = desktopWorkspaceBrowserPanelInstances(layouts, threadB, {
      bottomVisible: false,
      sideVisible: false,
    });
    const afterReturningToA = desktopWorkspaceBrowserPanelInstances(layouts, threadA, {
      bottomVisible: false,
      sideVisible: true,
    });

    expect(whileViewingB).toEqual([{ active: false, panel: browser, placement: 'side', targetIdentity: threadA }]);
    expect(afterReturningToA).toEqual([{ active: true, panel: browser, placement: 'side', targetIdentity: threadA }]);
  });

  it('derives browser Slot context from the panel target instead of the active conversation', () => {
    const projectIdByThreadId = new Map([
      ['thread-A', 'project-A'],
      ['thread-B', 'project-B'],
    ]);

    expect(desktopWorkspacePanelTargetContext('thread:thread-A', projectIdByThreadId)).toEqual({
      projectId: 'project-A',
      threadId: 'thread-A',
    });
    expect(desktopWorkspacePanelTargetContext('new-thread-slot:project-C', projectIdByThreadId)).toEqual({
      projectId: 'project-C',
      threadId: null,
    });
    expect(desktopWorkspacePanelTargetContext('new-thread-slot:global', projectIdByThreadId)).toEqual({
      projectId: null,
      threadId: null,
    });
  });

  it('keeps a browser mounted and active in the bottom slot', () => {
    const thread = 'thread:A' as const;
    const browser = createBrowserPanel('browser-bottom', 'https://example.com');
    const layouts = updateDesktopWorkspacePanelLayout({}, thread, (current) => ({
      ...current,
      bottomPanelSlot: addPanelToSlotState(current.bottomPanelSlot, browser),
    }));

    expect(desktopWorkspaceBrowserPanelInstances(layouts, thread, {
      bottomVisible: true,
      sideVisible: false,
    })).toEqual([{ active: true, panel: browser, placement: 'bottom', targetIdentity: thread }]);
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
