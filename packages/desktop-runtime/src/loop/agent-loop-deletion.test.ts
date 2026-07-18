import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeAttachmentUploadInput,
  RuntimeMessageAttachment,
  RuntimeStoredMessageAttachment,
} from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
import { systemClock } from '../ports/clock.js';
import type { AttachmentStore, RuntimeResolvedAttachment } from '../ports/attachment-store.js';
import type { ModelClient } from '../ports/model-client.js';
import { AgentLoop } from './agent-loop.js';

describe('agent loop thread deletion barrier', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('drains a pre-cancelled goal task, rejects new work, and leaves the global event writer healthy', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-agent-loop-delete-'));
    roots.push(root);
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(root, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Delete active goal' });
    const modelClient = new AbortIgnoringModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.setThreadGoal(thread.id, { objective: 'Keep working until deleted', status: 'active' });
    await modelClient.waitUntilStarted();
    const turnId = loop.activeTurnId(thread.id);
    expect(turnId).toEqual(expect.any(String));

    // This is the dangerous boundary: cancellation hides the task from activeTurnId while its
    // non-cooperative provider generator and goal observer are still unsettled.
    await loop.cancelTurn(thread.id, turnId!);
    expect(loop.activeTurnId(thread.id)).toBeNull();

    let enteredDelete = false;
    const deletion = loop.withThreadDeletionBarrier(thread.id, async () => {
      enteredDelete = true;
      await threadStore.deleteThread(thread.id);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(enteredDelete).toBe(false);
    await expect(loop.startTurn(thread.id, { input: 'must not start during deletion' }))
      .rejects.toThrow('being deleted');

    modelClient.release();
    await deletion;
    expect(await threadStore.getThread(thread.id)).toBeNull();

    const survivingThread = await threadStore.createThread({ title: 'Writer remains usable' });
    await expect(loop.sendTurn(survivingThread.id, { input: 'continue normally' })).resolves.toBeUndefined();
    expect((await threadStore.getThread(survivingThread.id))?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'complete',
      content: 'completed after deletion',
    });
  });

  it('releases the deletion barrier when the destructive operation fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-agent-loop-delete-'));
    roots.push(root);
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(root, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Retry after failed deletion' });
    const modelClient = new AbortIgnoringModelClient();
    modelClient.release();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await expect(loop.withThreadDeletionBarrier(thread.id, async () => {
      throw new Error('delete commit failed');
    })).rejects.toThrow('delete commit failed');

    await expect(loop.sendTurn(thread.id, { input: 'work may resume' })).resolves.toBeUndefined();
    expect((await threadStore.getThread(thread.id))?.messages.at(-1)?.content).toBe('completed after deletion');
  });

  it('waits for preprocessing admitted before deletion and rejects later admissions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-agent-loop-delete-'));
    roots.push(root);
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(root, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Delete during preprocessing' });
    const attachmentStore = new DeferredClaimAttachmentStore();
    const loop = new AgentLoop({
      threadStore,
      attachmentStore,
      modelClient: new AbortIgnoringModelClient(),
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });
    const attachment: RuntimeStoredMessageAttachment = {
      id: 'attachment_1',
      assetId: 'asset_1',
      source: 'runtime',
      name: 'guide.pdf',
      type: 'application/pdf',
      size: 10,
    };
    const starting = loop.startTurn(thread.id, { input: 'Use the attachment.', attachments: [attachment] });
    const startingResult = expect(starting).rejects.toThrow('being deleted');
    await attachmentStore.waitUntilClaimStarted();

    let enteredDelete = false;
    const deletion = loop.withThreadDeletionBarrier(thread.id, async () => {
      enteredDelete = true;
      await threadStore.deleteThread(thread.id);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(enteredDelete).toBe(false);
    await expect(loop.startTurn(thread.id, { input: 'late admission' })).rejects.toThrow('being deleted');

    attachmentStore.releaseClaim();
    await startingResult;
    await deletion;
    expect(enteredDelete).toBe(true);
    expect(await threadStore.getThread(thread.id)).toBeNull();
  });

  it('waits for an admitted direct mutation and rejects direct writes after deletion starts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-agent-loop-delete-'));
    roots.push(root);
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(root, systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Direct mutation admission' });
    const modelClient = new AbortIgnoringModelClient();
    modelClient.release();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });
    let signalMutationStarted: () => void = () => undefined;
    const mutationStarted = new Promise<void>((resolve) => {
      signalMutationStarted = resolve;
    });
    let releaseMutation: () => void = () => undefined;
    const mutationReleased = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutation = loop.withThreadMutation(thread.id, async () => {
      signalMutationStarted();
      await mutationReleased;
      await threadStore.updateThread(thread.id, { title: 'Mutation completed first' });
    });
    await mutationStarted;

    let enteredDelete = false;
    const deletion = loop.withThreadDeletionBarrier(thread.id, async () => {
      enteredDelete = true;
      await threadStore.deleteThread(thread.id);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(enteredDelete).toBe(false);
    await expect(loop.withThreadMutation(thread.id, async () => undefined)).rejects.toThrow('being deleted');

    releaseMutation();
    await mutation;
    await deletion;
    expect(await threadStore.getThread(thread.id)).toBeNull();
  });
});

class DeferredClaimAttachmentStore implements AttachmentStore {
  private claimStartedResolve: () => void = () => undefined;
  private readonly claimStarted = new Promise<void>((resolve) => {
    this.claimStartedResolve = resolve;
  });
  private releaseClaimResolve: () => void = () => undefined;
  private readonly claimReleased = new Promise<void>((resolve) => {
    this.releaseClaimResolve = resolve;
  });

  async recover(_validThreadIds: string[]): Promise<void> {
    return undefined;
  }

  async create(_input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment> {
    throw new Error('not implemented in this test');
  }

  async deletePending(_assetId: string): Promise<boolean> {
    return false;
  }

  async claimForThread(
    _threadId: string,
    attachments: RuntimeMessageAttachment[],
  ): Promise<RuntimeMessageAttachment[]> {
    this.claimStartedResolve();
    await this.claimReleased;
    return attachments;
  }

  async retainForThread(_threadId: string, _attachments: RuntimeMessageAttachment[]): Promise<void> {
    return undefined;
  }

  async releaseThread(_threadId: string): Promise<void> {
    return undefined;
  }

  async resolveForThread(
    _threadId: string,
    _attachments: RuntimeMessageAttachment[],
  ): Promise<RuntimeResolvedAttachment[]> {
    return [];
  }

  releaseClaim(): void {
    this.releaseClaimResolve();
  }

  async waitUntilClaimStarted(): Promise<void> {
    await this.claimStarted;
  }
}

class AbortIgnoringModelClient implements ModelClient {
  private startedResolve: () => void = () => undefined;
  private readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve;
  });
  private releaseResolve: () => void = () => undefined;
  private readonly released = new Promise<void>((resolve) => {
    this.releaseResolve = resolve;
  });
  private requestCount = 0;

  release(): void {
    this.releaseResolve();
  }

  async waitUntilStarted(): Promise<void> {
    await this.started;
  }

  async *stream(_request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requestCount += 1;
    if (this.requestCount === 1) {
      this.startedResolve();
      // Deliberately ignore AbortSignal to prove deletion waits for the registered done promise.
      await this.released;
    }
    yield { type: 'text_delta', text: 'completed after deletion' };
    yield { type: 'done', finishReason: 'stop' };
  }
}
