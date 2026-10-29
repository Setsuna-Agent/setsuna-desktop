// @vitest-environment happy-dom

import { composeRendererMessages } from '@setsuna-desktop/feature-core/renderer';
import type { CollaborationTask } from '@setsuna-desktop/feature-collaboration/contracts';
import { collaborationRendererFeature } from '@setsuna-desktop/feature-collaboration/renderer';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { ReviewFeatureHostBoundary } from '../../../../../src/composition/review-feature-adapter.js';
import type { ChatComposerTargetIdentity } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';
import { useDesktopWorkspacePanels } from '../../../../../src/features/workspace/hooks/useDesktopWorkspacePanels.js';
import { I18nProvider } from '../../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../../src/shared/i18n/messages.js';

const messageCatalog = composeRendererMessages(hostMessages, [{ module: collaborationRendererFeature }]);

afterEach(() => { cleanup(); localStorage.clear(); });

function Providers({ children }: PropsWithChildren) {
  return <I18nProvider initialLocale="zh-CN" messageCatalog={messageCatalog}><ToastProvider>
    <ReviewFeatureHostBoundary>{children}</ReviewFeatureHostBoundary>
  </ToastProvider></I18nProvider>;
}

function task(childThreadId: string): CollaborationTask {
  return {
    id: `task:${childThreadId}`, childThreadId,
    identity: { displayName: 'Worker', avatarSeed: childThreadId },
    title: 'Implement the task', objective: '', status: 'running', createdAt: '', updatedAt: '',
  };
}

it.each(['side', 'bottom'] as const)('navigates the list and agents in one %s panel while keeping conversations isolated', (placement) => {
  const view = renderHook(({ identity }) => useDesktopWorkspacePanels({
    activeProject: null, activeView: 'chat', conversationDebugEnabled: false,
    targetIdentity: identity, workspaceStatus: 'idle', setError: vi.fn(),
  }), { initialProps: { identity: 'thread:parent-A' as ChatComposerTargetIdentity }, wrapper: Providers });
  const slotKey = placement === 'side' ? 'sidePanelSlot' : 'bottomPanelSlot';
  const otherSlotKey = placement === 'side' ? 'bottomPanelSlot' : 'sidePanelSlot';

  act(() => view.result.current.openSubagentPanel('parent-A'));
  const panelId = view.result.current.sideActivePanel!.id;
  if (placement === 'bottom') act(() => view.result.current.moveDesktopPanel('side', panelId, 'bottom', null, 'after'));
  expect(view.result.current[slotKey].panels[0]?.subagent).toEqual({ parentThreadId: 'parent-A', threadId: null });

  act(() => view.result.current.openSubagentPanel('parent-A', task('child-1')));
  // Both agents have the same label: selecting another must still update the observed thread.
  act(() => view.result.current.openSubagentPanel('parent-A', task('child-2')));
  expect(view.result.current[slotKey].panels).toHaveLength(1);
  expect(view.result.current[slotKey].active).toBe(panelId);
  expect(view.result.current[slotKey].panels[0]?.subagent).toEqual({ parentThreadId: 'parent-A', threadId: 'child-2' });
  expect(view.result.current[otherSlotKey].panels.some((panel) => panel.type === 'subagent')).toBe(false);

  view.rerender({ identity: 'thread:parent-B' });
  expect(view.result.current.sidePanelSlot.panels).toEqual([]);
  expect(view.result.current.bottomPanelSlot.panels).toEqual([]);
  act(() => view.result.current.openSubagentPanel('parent-B', task('child-3')));
  view.rerender({ identity: 'thread:parent-A' });
  expect(view.result.current[slotKey].panels[0]?.subagent?.threadId).toBe('child-2');

  act(() => view.result.current.openSubagentPanel('parent-A'));
  expect(view.result.current[slotKey].panels).toHaveLength(1);
  expect(view.result.current[slotKey].active).toBe(panelId);
  expect(view.result.current[slotKey].panels[0]?.subagent?.threadId).toBeNull();
  act(() => view.result.current.closeDesktopPanelItem(placement, panelId));
  expect(view.result.current[slotKey].panels.some((panel) => panel.type === 'subagent')).toBe(false);
  act(() => view.result.current.openSubagentPanel('parent-A', task('child-1')));
  expect(view.result.current.sideActivePanel?.subagent).toEqual({ parentThreadId: 'parent-A', threadId: 'child-1' });
});
