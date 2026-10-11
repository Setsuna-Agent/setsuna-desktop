import { act, fireEvent } from '@testing-library/react';
import { vi, type Mock } from 'vitest';
import type { PluginUiDocumentInput } from '@setsuna-desktop/contracts';
import { SANDBOXED_UI_CHANNEL } from '../../src/kernel/sandboxed-plugin-ui/sandbox-document.js';

const documents = new Map<string, string>();

export function mockPluginUiDocuments() {
  documents.clear();
  const createPluginUiDocument = vi.fn(async ({ html }: PluginUiDocumentInput) => {
    const id = crypto.randomUUID();
    const url = `about:blank#${id}`;
    documents.set(url, html);
    return { id, url };
  });
  const releasePluginUiDocument = vi.fn(async () => undefined);
  return { createPluginUiDocument, releasePluginUiDocument };
}

export function connectSandboxedUiFrame(frame: HTMLIFrameElement): {
  post: Mock<(message: Record<string, unknown>) => void>;
  closed: Mock<() => void>;
  send(data: Record<string, unknown>): void;
} {
  const bootstrap = new DOMParser().parseFromString(documents.get(frame.src) ?? frame.srcdoc, 'text/html').querySelector('script')?.textContent;
  const documentId = bootstrap?.match(/const documentId = ("[^"]*");/u)?.[1];
  if (!documentId) throw new Error('Document bridge identity is missing.');
  const port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn<(message: Record<string, unknown>) => void>(), start: vi.fn(), close: vi.fn<() => void>(),
  };
  fireEvent(window, new MessageEvent('message', {
    source: frame.contentWindow,
    data: { channel: SANDBOXED_UI_CHANNEL, type: 'ready', documentId: JSON.parse(documentId) },
    ports: [port as unknown as MessagePort],
  }));
  return {
    post: port.postMessage,
    closed: port.close,
    send: (data: Record<string, unknown>) => act(() => {
      port.onmessage?.(new MessageEvent('message', { data: { channel: SANDBOXED_UI_CHANNEL, ...data } }));
    }),
  };
}
