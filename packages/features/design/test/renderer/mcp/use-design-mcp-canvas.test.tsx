// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import type { DesignMcpBridge, DesignMcpCanvasEvent, DesignMcpRead, DesignMcpReply } from '../../../src/contracts/design-mcp.js';
import { designDocumentVersion, type DesignDocument } from '../../../src/contracts/document.js';
import { emptyDesignLibraryResources } from '../../../src/renderer/components/design-library-resources.js';
import { DesignUiHostContext } from '../../../src/renderer/context/design-ui-host.js';
import { resolveDesignScene } from '../../../src/renderer/design-layout.js';
import type { DesignMcpCanvasView } from '../../../src/renderer/mcp/read-design-canvas.js';
import { useDesignMcpCanvas } from '../../../src/renderer/mcp/use-design-mcp-canvas.js';

afterEach(cleanup);

it('rejects an earlier inspection or preview revision after reopening the same design', async () => {
  let canvasId: string;
  let receive: (event: DesignMcpCanvasEvent) => void;
  let requestCount = 0;
  const reply = vi.fn<DesignMcpBridge['reply']>();
  const bridge: DesignMcpBridge = {
    settings: vi.fn(), setEnabled: vi.fn(), copyConfig: vi.fn(), revokeManual: vi.fn(), reply,
    setCanvas(id, visible) { if (visible) canvasId = id; },
    onRequest(listener) { receive = listener; return () => undefined; },
  };
  const host = { mcp: bridge, ShortcutSettings: () => null, ScrollOverlay: () => null, ProjectIcon: () => null,
    copyText: async () => undefined };
  const wrapper = ({ children }: PropsWithChildren) => <DesignUiHostContext.Provider value={host}>{children}</DesignUiHostContext.Provider>;
  const layoutEngine = await loadYoga();
  const preview = vi.fn<DesignMcpCanvasView['preview']>();

  function open(name: string) {
    const document: DesignDocument = { documentId: 'same-draft', schemaVersion: designDocumentVersion, rootIds: ['board'], nodes: {
      board: { kind: 'frame', name, x: 0, y: 0, width: 100, height: 80, childIds: [] },
    } };
    const view: DesignMcpCanvasView = { name: 'Draft', document, projected: document, layoutEngine, revision: 'edit:1', preview,
      scene: resolveDesignScene(layoutEngine, document, () => ({ width: 0, height: 0 })), resources: emptyDesignLibraryResources, selection: [] };
    return renderHook(() => useDesignMcpCanvas(true, { ...view }), { wrapper });
  }

  async function read(read: DesignMcpRead) {
    const result = Promise.withResolvers<DesignMcpReply>();
    reply.mockImplementationOnce((_id, response) => result.resolve(response));
    await act(async () => {
      receive({ kind: 'read', canvasId, requestId: String(++requestCount), read, agent: { id: 'agent-1', name: 'Agent' } });
      await result.promise;
    });
    return result.promise;
  }

  const first = open('First edit');
  const active = await read({ kind: 'active' });
  if (!active.ok) throw new Error(active.error);
  const { documentId, revision } = JSON.parse(active.value.content) as { documentId: string; revision: string };
  expect(await read({ kind: 'inspect', documentId, revision, offset: 0 })).toMatchObject({ ok: true });
  first.unmount();

  open('Second edit');
  for (const request of [{ kind: 'inspect', offset: 1 }, { kind: 'preview' }] as const) {
    expect(await read({ ...request, documentId, revision })).toEqual({ ok: false, error: expect.stringContaining('revision changed') });
  }
  expect(preview).not.toHaveBeenCalled();
});
