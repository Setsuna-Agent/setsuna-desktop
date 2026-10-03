// @vitest-environment happy-dom

import { composeRendererMessages, declareRendererChildSlot, defineSingleRendererSlot } from '@setsuna-desktop/feature-core/renderer';
import { parseBrowserAnnotationMessage, type BrowserAnnotationSendHandler, type BrowserAnnotationTarget } from '@setsuna-desktop/feature-browser/contracts';
import { BrowserWorkspacePanel, browserRendererFeature } from '@setsuna-desktop/feature-browser/renderer';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopWorkspacePanelLayer, type DesktopWorkspacePanelModel } from '../../../../src/app/layout/DesktopWorkspacePanelLayer.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import type { ChatComposerTargetIdentity } from '../../../../src/features/chat/hooks/useChatComposerSession.js';
import { desktopWorkspaceBrowserPanelInstances, useDesktopWorkspacePanelSession } from '../../../../src/features/workspace/hooks/useDesktopWorkspacePanelSession.js';
import { addPanelToSlotState, createBrowserPanel } from '../../../../src/features/workspace/model.js';
import { RendererKernelProvider, RendererOwnedSlotsProvider, RendererRootSingleSlot } from '../../../../src/kernel/renderer-plugins/RendererKernelProvider.js';
import { createRendererPluginRuntime } from '../../../../src/kernel/renderer-plugins/runtime.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';
import { hostMessages } from '../../../../src/shared/i18n/messages.js';

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: undefined });
});

it.each(['ordinary message', 'annotation'])('retains the guest, saved notes and draft when the first %s claims the panel', async (firstMessage) => {
  const target: BrowserAnnotationTarget = {
    id: '27f0b1c9-8c70-452e-8cce-2dd7e029f084', selector: '#first', tag: 'button', text: 'First',
    url: 'https://example.com/', title: 'Example', bounds: { x: 1, y: 2, width: 30, height: 40 },
    viewport: { width: 800, height: 600 }, styles: {},
  };
  const second = { ...target, id: '69a247d0-0ea1-4d87-9d27-701e850138ee', selector: '#second' };
  const bridge = {
    pickAnnotation: vi.fn().mockResolvedValueOnce(target).mockResolvedValueOnce(second),
    cancelAnnotation: vi.fn(async () => undefined), setAnnotationMarkers: vi.fn(async () => true),
    getAnnotationAnchor: vi.fn(async () => null),
    captureAnnotationScreenshots: vi.fn(async (_id: string, ids: string[]) => ids.map(() => ({
      dataUrl: 'data:image/png;base64,aW1hZ2U=', width: 800, height: 600, mimeType: 'image/png', size: 5,
    }))),
    registerTab: vi.fn(async () => true), unregisterTab: vi.fn(async () => true),
    setActiveTab: vi.fn(async () => true), setDeviceEmulation: vi.fn(async () => true),
    onContextMenu: () => () => undefined, dismissContextMenu: vi.fn(async () => undefined),
  };
  Object.defineProperty(window, 'setsunaDesktop', {
    configurable: true, value: { browser: bridge, desktop: { platform: 'darwin' }, links: { openExternal: vi.fn() } },
  });
  let claim!: () => void;
  let finishSend!: (accepted: boolean) => void;
  const send = vi.fn<BrowserAnnotationSendHandler>(async () => true).mockImplementationOnce(() => {
    if (firstMessage === 'annotation') claim();
    return new Promise((resolve) => { finishSend = resolve; });
  });
  const runtime = createRendererPluginRuntime();
  const root = defineSingleRendererSlot<{ children: ReactNode }>({ id: 'renderer.fixture.browser-panels', scope: 'app' });
  runtime.declareRoot({ pluginId: 'core.fixture', scopeId: 'root' }, { slot: root, required: true });
  const registrar = runtime.createRegistrar({ pluginId: 'core.fixture', scopeId: 'panels' });
  registrar.single(root, {
    id: 'fixture.shell', children: [declareRendererChildSlot(workspacePanelSlot)],
    render: ({ children }, slots) => <RendererOwnedSlotsProvider slots={slots}>{children}</RendererOwnedSlotsProvider>,
  });
  registrar.keyed(workspacePanelSlot, { id: 'fixture.browser', key: 'browser', render: (props) => <BrowserWorkspacePanel {...props} /> });
  runtime.commitInitial();
  const messages = composeRendererMessages(hostMessages, [{ module: browserRendererFeature }]);
  const panel = createBrowserPanel('browser-draft', target.url);

  function Workspace() {
    const [identity, setIdentity] = useState<ChatComposerTargetIdentity>('new-thread-slot:global');
    const session = useDesktopWorkspacePanelSession(identity);
    const { setSidePanelSlot } = session;
    useEffect(() => {
      if (identity === 'new-thread-slot:global') setSidePanelSlot((slot) => addPanelToSlotState(slot, panel));
    }, [identity, setSidePanelSlot]);
    claim = () => { session.claimForThread('created'); setIdentity('thread:created'); };
    // Other workspace surfaces are inactive in this browser lifecycle fixture.
    const model = {
      context: { currentThread: identity === 'thread:created' ? { id: 'created', messages: [] } : null, threads: [], workspaceApps: [] },
      panels: {
        sidePanelSlot: session.sidePanelSlot, bottomPanelSlot: session.bottomPanelSlot,
        sideActivePanel: panel, sidePanelPresent: true, bottomPanelVisible: false, terminalSessionsByPanelId: {},
        browserPanelInstances: desktopWorkspaceBrowserPanelInstances(session.layouts, identity, { sideVisible: true, bottomVisible: false }),
      },
      layout: { workspaceMinWidth: 320, workspaceMaxWidth: 900, workspaceWidth: 400, onWorkspaceResizeStart: vi.fn(), onWorkspaceResizeStep: vi.fn() },
      actions: {
        onSendBrowserAnnotations: send,
        onUpdateBrowserPanel: vi.fn(),
      },
    } as unknown as DesktopWorkspacePanelModel;
    return <DesktopWorkspacePanelLayer model={model} onAddWorkspaceMention={vi.fn()} onCloseFileContextMenu={vi.fn()}
      requestImageAttachment={() => 'added'} workspaceFileContextTarget={null} />;
  }

  try {
    render(<I18nProvider initialLocale="en-US" messageCatalog={messages}><ToastProvider>
      <RendererKernelProvider runtime={runtime}><RendererRootSingleSlot slot={root} props={{ children: <Workspace /> }} /></RendererKernelProvider>
    </ToastProvider></I18nProvider>);
    const guest = document.querySelector('webview')!;
    Object.assign(guest, { getWebContentsId: () => 42, getURL: () => target.url, getZoomFactor: () => 1, canGoBack: () => false, canGoForward: () => false });
    fireEvent(guest, new Event('dom-ready'));
    fireEvent(guest, new Event('did-stop-loading'));
    fireEvent.click(screen.getByRole('button', { name: 'Annotate page' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Comment' }), { target: { value: 'Saved note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));
    await waitFor(() => expect(bridge.pickAnnotation).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'Unsent draft' } });
    if (firstMessage === 'ordinary message') act(() => claim());
    fireEvent.click(screen.getByRole('button', { name: 'Send to Agent' }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await act(async () => finishSend(false));
    expect(document.querySelector('webview')).toBe(guest);
    expect(bridge.registerTab).toHaveBeenCalledOnce();
    expect(bridge.unregisterTab).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe('Unsent draft');
    fireEvent.click(screen.getByRole('button', { name: 'Send to Agent' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(parseBrowserAnnotationMessage(send.mock.calls[1][0])?.annotations).toEqual([
      { target, comment: 'Saved note' }, { target: second, comment: 'Unsent draft' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Agent' }));
    expect(send).toHaveBeenCalledTimes(2);
    expect(bridge.captureAnnotationScreenshots).toHaveBeenLastCalledWith(panel.id, [target.id, second.id]);
  } finally {
    cleanup();
    await runtime.dispose();
  }
});
