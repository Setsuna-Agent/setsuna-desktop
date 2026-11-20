// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import { runDesignSelectionTask } from '../../src/renderer/agent/design-selection-task.js';
import { useDesignAgentActivity } from '../../src/renderer/agent/use-design-agent-activity.js';
import { emptyDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import { DesignDocumentService } from '../../src/runtime/design-document-service.js';
import { DesignTasks } from '../../src/runtime/design-tasks.js';

it('tracks a cross-board preview, then retains the deleted target until the next focus takes over', async () => {
  const source: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'focus', rootIds: ['chart', 'nav'], nodes: {
    chart: { kind: 'frame', x: 0, y: 0, width: 160, height: 100, childIds: ['plot'] },
    plot: { kind: 'frame', x: 10, y: 10, width: 90, height: 60, childIds: ['line', 'label'] },
    line: { kind: 'rectangle', x: 4, y: 3, width: 45, height: 2, cornerRadius: 0 },
    label: { kind: 'rectangle', x: 6, y: 8, width: 20, height: 8, cornerRadius: 0 },
    nav: { kind: 'frame', x: 240, y: 0, width: 100, height: 120, childIds: ['indicator'] },
    indicator: { kind: 'rectangle', name: 'Navigation indicator', x: 4, y: 8, width: 2, height: 16, cornerRadius: 0 },
  } };
  let content = JSON.stringify(source);
  let revision = 0;
  const documents = new DesignDocumentService({ create: vi.fn(), withDocument: (_ref, _signal, operation) => operation({
    key: source.documentId,
    read: async () => ({ content, revision: String(revision) }),
    replace: async (next) => { content = next; return String(++revision); },
  }) });
  const client = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: async () => undefined }, documents);
  const ref = { projectId: 'project', path: 'focus.design.json' };
  const controller = new AbortController();
  const { signal } = controller;
  const layoutEngine = await loadYoga();
  let snapshot = await documents.read(ref, signal);
  const { result, unmount } = renderHook(useDesignAgentActivity);
  act(() => result.current.setRunning(true));
  const ready = Promise.withResolvers<void>();
  const exchange = runDesignSelectionTask({ client, ref, selection: [], threadId: 'chat', signal,
    onReady: ready.resolve, approve: async () => true,
    synchronize: async (signal) => snapshot = await documents.read(ref, signal),
    view() {
      const { document } = snapshot;
      const scene = resolveDesignScene(layoutEngine, document, () => ({ width: 0, height: 0 }));
      return { document, projected: document, scene, layoutEngine, resources: emptyDesignLibraryResources, showFocus: result.current.showFocus,
        preview: async ([id]) => ({ image: 'data:image/png;base64,AA==', bounds: scene[id].paintBounds }) };
    },
  }).catch((error: unknown) => { if (!signal.aborted) throw error; });

  try {
    await Promise.race([ready.promise, exchange]);
    const indicator = { boardId: 'nav', ids: ['indicator'], point: { x: 246, y: 24 } };
    await act(async () => { await client.execute('chat', 'design_preview', { ids: ['indicator', 'line', 'label'] }, signal); });
    expect(result.current.focus).toEqual([indicator, { boardId: 'chart', ids: ['line', 'label'], point: { x: 59, y: 26 } }]);
    await act(async () => { await client.execute('chat', 'design_inspect', { name: 'Navigation indicator' }, signal); });
    expect(result.current.focus).toEqual([indicator]);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      await client.execute('chat', 'design_edit', { action: 'delete', ids: ['indicator'], revision: snapshot.revision }, signal);
      await client.execute('chat', 'design_preview', { ids: ['chart'] }, signal);
    });
    expect(snapshot.document.nodes.indicator).toBeUndefined();
    expect(result.current.focus).toEqual([indicator]);

    act(() => vi.advanceTimersByTime(650));
    expect(result.current.focus).toEqual([{ boardId: 'chart', ids: ['chart'], point: { x: 160, y: 100 } }]);
    await act(async () => { await client.execute('chat', 'design_inspect', { name: 'Navigation indicator' }, signal); });
    expect(result.current.focus).toBeUndefined();
  } finally {
    controller.abort();
    unmount();
    vi.useRealTimers();
    await exchange;
  }
});
