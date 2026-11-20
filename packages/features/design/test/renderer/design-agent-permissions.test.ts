import { expect, it, vi } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import { createDesignClient } from '../../src/renderer/client.js';
import { runDesignSelectionTask } from '../../src/renderer/agent/design-selection-task.js';
import { emptyDesignLibraryResources } from '../../src/renderer/components/design-library-resources.js';
import { defaultDesignCanvasSettings } from '../../src/renderer/context/design-canvas-settings.js';
import { resolveDesignScene } from '../../src/renderer/design-layout.js';
import type { DesignDocumentService } from '../../src/runtime/design-document-service.js';
import { DesignTasks } from '../../src/runtime/design-tasks.js';

it.each(['main command timeout', 'child cancellation'] as const)('invalidates a pending deletion on %s before a late confirmation', async (reason) => {
  const ref = { projectId: 'p', path: 'draft.design.json' };
  const document: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'draft', rootIds: [], nodes: {} };
  const snapshot = { revision: '1', document, canUndo: false, canRedo: false };
  const tasks = new DesignTasks({ resolveOwnedRoot: async () => '/project', cancel: vi.fn() }, {
    read: async () => snapshot, commit: vi.fn<DesignDocumentService['commit']>(),
  });
  const client = createDesignClient({ call: vi.fn() }, {
    read: vi.fn(), search: vi.fn(), readLinkedImage: vi.fn(), requestClipboardPaste: vi.fn(), output: {
      saveDesignSvg: vi.fn(), saveDesignHtml: vi.fn(), saveImageAs: vi.fn(), copyText: vi.fn(), copyImageToClipboard: vi.fn(),
      copyDesignLayers: vi.fn(), readDesignLayers: vi.fn(),
    },
  });
  const remove = vi.spyOn(client, 'delete');
  const watch = vi.spyOn(tasks, 'watchCommand');
  const layoutEngine = await loadYoga();
  const ready = Promise.withResolvers<void>();
  const shown = Promise.withResolvers<AbortSignal>();
  const decision = Promise.withResolvers<boolean>();
  const session = new AbortController();
  const exchange = runDesignSelectionTask({ ref, selection: [], threadId: 'parent', client: tasks, signal: session.signal,
    synchronize: async () => snapshot, onReady: ready.resolve, approve: (_tool, _description, signal) => {
      shown.resolve(signal);
      return decision.promise;
    }, view: () => ({ document, projected: document, layoutEngine, resources: emptyDesignLibraryResources,
      scene: resolveDesignScene(layoutEngine, document, () => ({ width: 0, height: 0 })), preview: vi.fn(),
      editor: { ref, client, settings: defaultDesignCanvasSettings, scripts: new Map(), translate: (key) => key,
        canvas: () => null, select: vi.fn(), toggleSetting: vi.fn(), refreshFonts: vi.fn(), deliver: vi.fn(), completeFileAction: vi.fn() },
    }),
  }).catch((error) => { if (!session.signal.aborted) throw error; });
  const closed = exchange.catch((error: unknown) => error);
  try {
    await Promise.race([ready.promise, exchange]);
    const worker = new AbortController();
    const child = reason === 'child cancellation';
    if (child) tasks.join('parent', { threadId: 'child', turnId: 'child-turn', name: 'Mobile', colorIndex: 1 });
    else vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const deletion = tasks.execute(child ? 'child' : 'parent', 'design_document', { action: 'delete', revision: '1' }, worker.signal, child ? 'child-turn' : 'main-turn');
    const rejected = expect(deletion).rejects.toThrow();
    const command = await shown.promise;
    const [key] = watch.mock.calls[0];
    const fileOperation = tasks.fileOperationSignal(key, session.signal);
    if (child) worker.abort();
    else {
      await vi.advanceTimersByTimeAsync(299_999);
      expect(command.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(fileOperation.aborted).toBe(true);
    expect(() => tasks.fileOperationSignal(key, session.signal)).toThrow();
    await rejected;
    expect(command.aborted).toBe(true);
    decision.resolve(true);
    if (child) {
      await tasks.leave('child', 'child-turn');
      await tasks.execute('parent', 'design_inspect', {}, session.signal);
    } else {
      await closed;
    }
    expect(remove).not.toHaveBeenCalled();
  } finally {
    decision.resolve(false);
    session.abort();
    await closed;
    vi.useRealTimers();
  }
});
