// @vitest-environment happy-dom

import { ToastProvider, UiProvider } from '@setsuna-desktop/renderer-ui';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { designDocumentVersion, type DesignDocument } from '../../src/contracts/index.js';
import type { DesignClient } from '../../src/renderer/client.js';
import { useDesignDocument } from '../../src/renderer/use-design-document.js';
import { DesignDocumentService } from '../../src/runtime/design-document-service.js';

afterEach(cleanup);

it('drains submitted coordinates after unmount and waits for them when reopening the document', async () => {
  const documentRef = { projectId: 'project', rootId: 'root', path: 'tile.design.json' };
  const source: DesignDocument = { schemaVersion: designDocumentVersion, documentId: 'tile', rootIds: ['tile'], nodes: {
    tile: { kind: 'rectangle', x: 0, y: 0, width: 12, height: 12, cornerRadius: 0 },
  } };
  let content = JSON.stringify(source);
  let revision = 0;
  let releaseSave!: () => void;
  const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
  const replace = vi.fn(async (next: string) => {
    await gate;
    content = next;
    return String(++revision);
  });
  const service = new DesignDocumentService({ create: vi.fn(),
    withDocument: (_ref, _signal, run) => run({ key: source.documentId, workspaceRoot: '/designs',
      read: async () => ({ content, revision: String(revision) }), replace }),
  });
  const signal = new AbortController().signal;
  const read = vi.fn<DesignClient['read']>((ref) => service.read(ref, signal));
  const commit = vi.fn<DesignClient['commit']>((edit) => service.commit(edit, signal));
  const client: DesignClient = {
    projectDesigns: async () => [], catalog: async () => ({ directories: [], associations: [] }), setProject: vi.fn(),
    fonts: { list: vi.fn().mockResolvedValue([]), read: vi.fn(), import: vi.fn(), remove: vi.fn() },
    read, commit, list: vi.fn(), listEntries: vi.fn(), create: vi.fn(), move: vi.fn(), delete: vi.fn(), importImage: vi.fn(), importScript: vi.fn(),
    readScriptParameters: vi.fn(), renderScript: vi.fn(), importShader: vi.fn(), readShader: vi.fn(), navigate: vi.fn(),
    resolveResourceRoot: async (ref) => ref,
    prepareLibraryPreset: vi.fn(),
    assets: { search: vi.fn(), read: vi.fn(), readLinkedImage: vi.fn(), requestClipboardPaste: vi.fn(), output: {
      saveDesignHtml: vi.fn(), saveDesignSvg: vi.fn(), saveImageAs: vi.fn(), copyImageToClipboard: vi.fn(),
      copyDesignLayers: vi.fn(), readDesignLayers: vi.fn(), copyText: vi.fn(),
    } },
  };
  const translate = (key: string) => key;
  const wrapper = ({ children }: PropsWithChildren) => <UiProvider locale="en-US"><ToastProvider>{children}</ToastProvider></UiProvider>;
  const open = () => renderHook(() => useDesignDocument({ client, documentRef, translate }), { wrapper });

  try {
    const editor = open();
    await waitFor(() => expect(editor.result.current.snapshot?.revision).toBe('0'));
    let x!: Promise<boolean>;
    act(() => { x = editor.result.current.editFields(new Map([['tile', (node) => ({ ...node, x: 12 })]]), '0'); });
    await waitFor(() => expect(replace).toHaveBeenCalledOnce());
    let y!: Promise<boolean>;
    act(() => { y = editor.result.current.editFields(new Map([['tile', (node) => ({ ...node, y: 9 })]]), editor.result.current.snapshot!.revision); });
    editor.unmount();
    const reopened = open();
    expect(commit).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();

    await act(async () => {
      releaseSave();
      expect(await Promise.all([x, y])).toEqual([true, true]);
    });
    await waitFor(() => expect(reopened.result.current.snapshot?.document.nodes.tile).toMatchObject({ x: 12, y: 9 }));
    expect(commit.mock.calls.map(([input]) => input.expectedRevision)).toEqual(['0', '1']);
    reopened.unmount();

    // The chat receipt still identifies the opening revision while a second editor saves.
    let notify!: () => void;
    const watchDirectories = (_root: string, _paths: readonly string[], callback: () => void) => { notify = callback; return () => {}; };
    const chat = renderHook(() => useDesignDocument({ client, documentRef, translate, fileRevision: '2', watchDirectories }), { wrapper });
    await waitFor(() => expect(notify).toBeDefined());
    const previous = await service.read(documentRef, signal);
    await service.commit({ ref: documentRef, expectedRevision: previous.revision,
      edits: [{ kind: 'update', nodeId: 'tile', node: { ...previous.document.nodes.tile, y: 23 } }] }, signal);
    act(() => notify());
    await waitFor(() => expect(chat.result.current.snapshot?.document.nodes.tile.y).toBe(23));
    await act(async () => expect(await chat.result.current.editFields(new Map([['tile', (node) => ({ ...node, x: 14 })]]),
      chat.result.current.snapshot!.revision)).toBe(true));
    expect((await service.read(documentRef, signal)).document.nodes.tile).toMatchObject({ x: 14, y: 23 });
  } finally {
    releaseSave();
  }
});
