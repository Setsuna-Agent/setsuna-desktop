// @vitest-environment happy-dom
import type { RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { artifactResultEnvelope } from '@setsuna-desktop/feature-artifact/contracts';
import { designMentionText, type ChatDesignResult } from '@setsuna-desktop/feature-design/contracts';
import { ToastProvider } from '@setsuna-desktop/renderer-ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatDesignPanels } from '../../../../src/composition/design/ChatDesignCanvas.js';
import { ArtifactFeatureNavigationBoundary } from '../../../../src/composition/ArtifactFeatureBoundary.js';
import { ConversationArtifactGroup } from '../../../../src/features/chat/artifacts/ConversationArtifactGroup.js';
import { ChatDesignReferenceText } from '../../../../src/features/chat/mentions/ChatDesignReference.js';
import type { RendererOwnedSlotRenderer } from '@setsuna-desktop/feature-core/renderer';
import type { WorkspacePanelSlotProps } from '@setsuna-desktop/renderer-contracts/workspace';
import type { DesignClient } from '@setsuna-desktop/feature-design/renderer';
import { DesignFeatureServiceBoundary } from '../../../../src/composition/design/DesignClientContext.js';
import { DesktopWorkspacePanelLayer, type DesktopWorkspacePanelModel } from '../../../../src/app/layout/DesktopWorkspacePanelLayer.js';
import { createDesignPanel, createSubagentPanel } from '../../../../src/features/workspace/model.js';
import { RendererPluginTestHost } from '../../support/RendererPluginTestHost.js';

afterEach(cleanup);

it('keeps a live canvas connection while inspecting a worker and releases it when its tab closes', () => {
  const owner = { ref: { storageId: 'local', path: 'team.design.json' }, documentId: 'team' };
  const canvas = createDesignPanel(owner);
  const worker = createSubagentPanel('child', 'thread', 'Designer');
  const thread = { id: 'thread', messages: [{ id: 'call', role: 'assistant', turnId: 'draw', content: '', toolRuns: [{
    id: 'open', name: 'chat_design', status: 'success', data: { resultKind: 'design.draft', resultMajor: 1,
      payload: { ...owner, action: 'open', revision: '1', canvasRequestId: 'request' } },
  }] }] } as RuntimeThread;
  const resolveResourceRoot = vi.fn<DesignClient['resolveResourceRoot']>((_ref, signal) =>
    new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })));
  const client: Pick<DesignClient, 'resolveResourceRoot'> = { resolveResourceRoot };
  const slots: RendererOwnedSlotRenderer = { chain: () => null as never, single: () => null, keyedEntries: () => [], list: () => null,
    listEntryIds: () => [], keyed: (_slot, key, props) => key === 'design' ? (props as WorkspacePanelSlotProps).renderDefault() : null };
  const open = vi.fn();
  function view(active: typeof canvas, keepCanvas: boolean) {
    const model = {
      context: { currentThread: thread, threads: [], workspaceApps: [] }, actions: {}, layout: {},
      panels: { sidePanelPresent: true, sideActivePanel: active, sidePanelSlot: { panels: keepCanvas ? [canvas, worker] : [worker] },
        bottomPanelSlot: { panels: [] }, browserPanelInstances: [], terminalSessionsByPanelId: {} },
    } as unknown as DesktopWorkspacePanelModel;
    return <RendererPluginTestHost slots={slots}><DesignFeatureServiceBoundary client={client as DesignClient}>
      <ChatDesignPanels thread={thread} activeTurnId="draw" open={open}>
        <DesktopWorkspacePanelLayer model={model} onAddWorkspaceMention={vi.fn()} onCloseFileContextMenu={vi.fn()}
          requestImageAttachment={() => 'added'} workspaceFileContextTarget={null} />
      </ChatDesignPanels>
    </DesignFeatureServiceBoundary></RendererPluginTestHost>;
  }
  const ui = render(view(canvas, true));
  const signal = resolveResourceRoot.mock.calls[0][1]!;
  ui.rerender(view(worker, true));
  expect(signal.aborted).toBe(false);
  ui.rerender(view(canvas, true));
  expect(resolveResourceRoot).toHaveBeenCalledTimes(1);
  ui.rerender(view(worker, false));
  expect(signal.aborted).toBe(true);
});

it('opens a new canvas once, leaves later batches in the background and reopens historical outputs on demand', async () => {
  const owner = { ref: { storageId: 'local', path: '画布 (2).design.json' }, documentId: 'original' };
  const open = vi.fn();
  const showFile = vi.fn();
  const message = (id: string, name: string, data: unknown): RuntimeMessage => ({
    id, turnId: 'draw', role: 'assistant', content: '', createdAt: '2026-01-01T00:00:00Z', toolRuns: [{ id, name, status: 'success', data }],
  });
  const receipt = (action: ChatDesignResult['action'], revision: string) => message(revision, 'chat_design',
    { resultKind: 'design.draft', resultMajor: 1, payload: { ...owner, action, revision } });
  const old = message('published', 'publish_artifact', artifactResultEnvelope({ id: 'readme', kind: 'file', projectId: 'p',
    workspaceRoot: '/old', name: 'notes.md', path: 'notes.md', size: 10, mimeType: 'text/markdown' }));
  const client = { listThreadMessages: vi.fn(async () => ({ messages: [old], total: 1, nextBefore: null })) };
  const view = (messages: RuntimeMessage[], turnId: string | null) => {
    const thread = { id: 'thread', messages, lastSeq: messages.length } as RuntimeThread;
    return <ToastProvider><ChatDesignPanels thread={thread} open={open} activeTurnId={turnId}>
      <ArtifactFeatureNavigationBoundary projectId="p" onShowInFiles={showFile} onOpenBrowser={vi.fn()}>
        <ChatDesignReferenceText content={designMentionText(owner)} />
        <ConversationArtifactGroup client={client} threadId={thread.id} messages={messages} before={1} />
      </ArtifactFeatureNavigationBoundary>
    </ChatDesignPanels></ToastProvider>;
  };
  const created = receipt('create', 'first');
  const edited = receipt('edit', 'second');
  const ui = render(view([], 'draw'));
  ui.rerender(view([created], 'draw'));
  expect(open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(owner));
  ui.rerender(view([created, edited], 'draw'));
  expect(open).toHaveBeenCalledTimes(1);
  ui.unmount();
  render(view([created, edited], null));
  expect(open).toHaveBeenCalledTimes(1);
  fireEvent.click(await screen.findByRole('button', { name: 'notes.md' }));
  expect(showFile).toHaveBeenCalledWith('/old/notes.md');
  for (const button of screen.getAllByRole('button', { name: '画布 (2)' })) fireEvent.click(button);
  expect(open).toHaveBeenCalledTimes(3);
  expect(open.mock.calls.slice(1).every(([value]) => value.documentId === owner.documentId && value.ref.path === owner.ref.path)).toBe(true);
});
