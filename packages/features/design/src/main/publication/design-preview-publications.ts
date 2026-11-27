import { randomUUID } from 'node:crypto';
import { maxDesignPreviewBoardBytes, maxDesignPreviewBytes, parseDesignPreviewFrame,
  type BeginDesignPreview, type DesignPreviewFrame, type DesignPublishedPreview } from '../../contracts/design-publication.js';
import { designPreviewInitialVariant, designPreviewVariantCount } from '../../contracts/design-preview-variables.js';
import { designFileKey } from '../../contracts/operations.js';
import { designPreviewBindingKey, listDesignPreviewBindings } from './design-preview-addresses.js';
import type { DesignPreviewServer, DesignPreviewStoredFrame } from './design-preview-server.js';
import type { DesignViewerTheme } from './design-preview-viewer.js';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type PendingPreview = {
  id: string;
  owner: number;
  input: BeginDesignPreview;
  images: Buffer[];
  variants: Map<string, DesignPreviewStoredFrame>;
  variantCount: number;
  bytes: number;
  lifecycle: AbortController;
  publishing: boolean;
};

type ActivePreview = {
  owner: number;
  bindingKey: string;
  status: DesignPublishedPreview;
  server: DesignPreviewServer;
  networkCheck: NodeJS.Timeout;
};

export class DesignPreviewPublications {
  private pending?: PendingPreview;
  private active?: ActivePreview;

  constructor(private readonly bindings = listDesignPreviewBindings) {}

  status(): DesignPublishedPreview | null {
    const active = this.active;
    if (!active) return null;
    if (designPreviewBindingKey(this.bindings()) !== active.bindingKey) {
      void this.stop(active.status.id);
      return null;
    }
    return active.status;
  }

  begin(owner: number, input: BeginDesignPreview, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.pending) throw new Error('A design preview is already being prepared.');
    const id = randomUUID();
    const bytes = Buffer.byteLength(JSON.stringify({ boards: input.boards, variables: input.variables }));
    if (bytes > maxDesignPreviewBytes) throw new Error('The design preview exceeds its size budget.');
    const variantCount = input.boards.reduce((count, { modes }) => count + designPreviewVariantCount(modes) - 1, 0);
    this.pending = { id, owner, input, images: [], variants: new Map(), variantCount, bytes,
      lifecycle: new AbortController(), publishing: false };
    return id;
  }

  append(owner: number, ticket: string, index: unknown, data: unknown) {
    const pending = this.requirePending(owner, ticket);
    const board = pending.input.boards[pending.images.length];
    if (!board || index !== pending.images.length) throw new Error('The design preview is incomplete.');
    const png = previewPng(pending, board, data);
    pending.images.push(png);
    pending.bytes += png.length;
  }

  appendVariant(owner: number, ticket: string, board: unknown, variant: unknown, frame: unknown, data: unknown) {
    const pending = this.requirePending(owner, ticket);
    const plan = typeof board === 'number' && Number.isSafeInteger(board) ? pending.input.boards[board]?.modes : undefined;
    const key = typeof board === 'number' && typeof variant === 'number' ? `${board}/${variant}` : '';
    if (!plan || typeof variant !== 'number' || !Number.isSafeInteger(variant) || variant < 0 || variant >= designPreviewVariantCount(plan)
      || variant === designPreviewInitialVariant(plan) || pending.variants.has(key)) throw new Error('Invalid preview variant.');
    const descriptor = parseDesignPreviewFrame(frame);
    const metadata = JSON.stringify(descriptor);
    const bytes = Buffer.byteLength(metadata);
    const png = previewPng(pending, descriptor, data, bytes);
    pending.variants.set(key, { metadata, png });
    pending.bytes += bytes + png.length;
  }

  async publish(owner: number, ticket: string, requestSignal: AbortSignal, theme: DesignViewerTheme = 'light') {
    const pending = this.requirePending(owner, ticket);
    if (pending.publishing || pending.images.length !== pending.input.boards.length || pending.variants.size !== pending.variantCount) {
      throw new Error('The design preview is incomplete.');
    }
    pending.publishing = true;
    const signal = AbortSignal.any([requestSignal, pending.lifecycle.signal]);
    let server: DesignPreviewServer | undefined;
    try {
      const { input, images, variants } = pending;
      const bindings = this.bindings();
      const bindingKey = designPreviewBindingKey(bindings);
      const { openDesignPreview } = await import('./design-preview-server.js');
      server = await openDesignPreview(bindings, { boards: input.boards, start: input.start, variables: input.variables },
        images, input.access, theme, signal, variants);
      signal.throwIfAborted();
      if (designPreviewBindingKey(this.bindings()) !== bindingKey) throw new Error('The local network addresses have changed.');
      const status = { id: ticket, designKey: designFileKey(input.ref), documentId: input.documentId,
        revision: input.revision, urls: server.urls, access: input.access.kind };
      const previous = this.active;
      // The current link stays live until every new image is present and the new listener is bound.
      this.active = { owner, bindingKey, status, server,
        networkCheck: setInterval(() => { this.status(); }, 2_000).unref(),
      };
      server = undefined;
      if (previous) await closeActivePreview(previous);
      return status;
    } finally {
      if (this.pending === pending) this.pending = undefined;
      await server?.close();
    }
  }

  cancel(owner: number, ticket: string) {
    if (this.pending?.id !== ticket || this.pending.owner !== owner) return;
    this.pending.lifecycle.abort();
    this.pending = undefined;
  }

  async stop(id: string) {
    if (this.active?.status.id !== id) return;
    const active = this.active;
    this.active = undefined;
    await closeActivePreview(active);
  }

  forget(owner: number) {
    if (this.pending?.owner === owner) this.cancel(owner, this.pending.id);
    if (this.active?.owner === owner) void this.stop(this.active.status.id);
  }

  async dispose() {
    if (this.pending) this.cancel(this.pending.owner, this.pending.id);
    if (this.active) await this.stop(this.active.status.id);
  }

  private requirePending(owner: number, ticket: string) {
    const pending = this.pending;
    if (!pending || pending.id !== ticket || pending.owner !== owner) throw new Error('The design preview request is no longer active.');
    return pending;
  }
}

function previewPng(pending: PendingPreview, frame: DesignPreviewFrame, data: unknown, metadataBytes = 0) {
  if (pending.publishing || !(data instanceof ArrayBuffer) || data.byteLength < 33 || data.byteLength > maxDesignPreviewBoardBytes
    || pending.bytes + metadataBytes + data.byteLength > maxDesignPreviewBytes) {
    throw new Error('The design preview exceeds its image budget or is incomplete.');
  }
  const png = Buffer.from(data);
  if (!png.subarray(0, 8).equals(pngSignature) || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR'
    || png.readUInt32BE(16) !== frame.width || png.readUInt32BE(20) !== frame.height) {
    throw new Error('The design preview image is invalid.');
  }
  return png;
}

async function closeActivePreview(active: ActivePreview) {
  clearInterval(active.networkCheck);
  await active.server.close();
}
