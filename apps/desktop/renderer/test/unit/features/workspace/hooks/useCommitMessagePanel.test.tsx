// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ChatComposerTargetIdentity } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';
import { useCommitMessagePanel } from '../../../../../src/features/workspace/hooks/useCommitMessagePanel.js';
import { useDesktopWorkspacePanelSession } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanelSession.js';
import { addPanelToSlotState, createEmptyPanelSlot } from '../../../../../src/features/workspace/model.js';

afterEach(cleanup);

it('accepts explicit close once after moving a tab and disposes its original conversation layout', () => {
  const view = renderHook(({ identity }: { identity: ChatComposerTargetIdentity }) => {
    const layouts = useDesktopWorkspacePanelSession(identity);
    const panel = useCommitMessagePanel({
      targetIdentity: identity,
      addPanel: (_slot, tab) => layouts.setSidePanelSlot((slot) => addPanelToSlotState(slot, tab)),
      updateLayout: layouts.updateLayoutForIdentity,
    });
    return { ...layouts, panel };
  }, { initialProps: { identity: 'thread:first' } });
  let dispose!: () => void;
  const onClose = vi.fn(() => dispose());
  const onCancel = vi.fn(() => dispose());
  act(() => { dispose = view.result.current.panel.open({ onClose, onCancel }); });
  const tab = view.result.current.sidePanelSlot.panels[0];
  expect(tab).toMatchObject({ type: 'commit-message', title: 'COMMIT_EDITMSG' });
  act(() => view.result.current.updateLayoutForIdentity('thread:first', (layout) => ({
    ...layout, sidePanelSlot: createEmptyPanelSlot(), bottomPanelSlot: addPanelToSlotState(layout.bottomPanelSlot, tab),
  })));
  view.rerender({ identity: 'thread:second' });
  expect(onClose).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
  act(() => { view.result.current.panel.close(tab.id); view.result.current.panel.close(tab.id); });
  expect(onClose).toHaveBeenCalledOnce();
  expect(view.result.current.layoutForIdentity('thread:first').bottomPanelSlot.panels).toEqual([]);
  expect(view.result.current.layoutForIdentity('thread:second').sidePanelSlot.panels).toEqual([]);

  act(() => { dispose = view.result.current.panel.open({ onClose, onCancel }); });
  const next = view.result.current.sidePanelSlot.panels[0];
  act(() => view.result.current.panel.close(next.id, true));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(view.result.current.sidePanelSlot.panels).toEqual([]);
});
