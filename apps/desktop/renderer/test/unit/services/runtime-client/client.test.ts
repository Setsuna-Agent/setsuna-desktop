import type { RuntimeRequestInput } from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopRuntimeClient } from '../../../../src/services/runtime-client/client.js';

describe('desktop runtime client advanced thread methods', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the raw request bridge private to the renderer adapter', () => {
    installRuntimeBridge(() => ({}));

    const client = createDesktopRuntimeClient();

    expect(client).not.toHaveProperty('request');
  });

  it('forwards ordered event batches without expanding them into callback churn', () => {
    const batch = { events: [] };
    const unsubscribe = vi.fn();
    const startSse = vi.fn((
      _threadId: string,
      _sinceSeq: number | undefined,
      onBatch: (value: typeof batch) => void,
    ) => {
      onBatch(batch);
      return unsubscribe;
    });
    vi.stubGlobal('window', {
      setsunaDesktop: {
        runtime: {
          request: vi.fn(),
          startSse,
        },
      },
    });
    const client = createDesktopRuntimeClient();
    const onBatch = vi.fn();

    const stop = client.subscribeEvents('thread_1', 4, onBatch);

    expect(startSse).toHaveBeenCalledWith('thread_1', 4, onBatch);
    expect(onBatch).toHaveBeenCalledOnce();
    expect(onBatch).toHaveBeenCalledWith(batch);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('serializes parent and ancestor thread filters', async () => {
    const request = installRuntimeBridge(() => ({ threads: [] }));
    const client = createDesktopRuntimeClient();

    await client.listThreads({ ancestorThreadId: 'root thread', parentThreadId: 'parent/thread', includeArchived: true });

    expect(request).toHaveBeenCalledWith({
      path: '/v1/threads?includeArchived=true&ancestorThreadId=root+thread&parentThreadId=parent%2Fthread',
    });
  });

  it('requests a bounded thread snapshot and cursor-based older messages', async () => {
    const request = installRuntimeBridge(() => ({ messages: [], nextBefore: null, total: 0 }));
    const client = createDesktopRuntimeClient();

    await client.getThread('thread / 1');
    await client.listThreadMessages('thread / 1', { before: 40, limit: 20 });

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      { path: '/v1/threads/thread%20%2F%201?messageLimit=160' },
      { path: '/v1/threads/thread%20%2F%201/messages?before=40&limit=20' },
    ]);
  });

  it('uses a separate complete-content request when a file enters edit mode', async () => {
    const request = installRuntimeBridge(() => ({}));
    const client = createDesktopRuntimeClient();

    await client.readProjectFile('project / 1', 'src/generated file.html');
    await client.readProjectFileForEdit('project / 1', 'src/generated file.html');

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      {
        path: '/v1/projects/project%20%2F%201/read?path=src%2Fgenerated%20file.html',
      },
      {
        path: '/v1/projects/project%20%2F%201/read?path=src%2Fgenerated%20file.html&mode=edit',
      },
    ]);
  });

  it('routes queued turn input operations through encoded thread and input paths', async () => {
    const request = installRuntimeBridge(() => ({ accepted: true }));
    const client = createDesktopRuntimeClient();
    const queuedInput = {
      input: 'follow up',
      clientId: 'client_1',
      kind: 'message' as const,
      skillIds: ['skill_1'],
      thinking: true,
      thinkingEffort: 'high',
    };

    await client.queueTurnInput('thread / 1', queuedInput);
    await client.retrieveQueuedTurnInput('thread / 1', 'input / 1');
    await client.releaseQueuedTurnInputEdit('thread / 1', 'input / 1', { editToken: 'edit_1' });
    await client.updateQueuedTurnInput('thread / 1', 'input / 1', {
      editToken: 'edit_2',
      input: 'edited follow up',
      attachments: [],
    });
    await client.deleteQueuedTurnInput('thread / 1', 'input / 1');
    await client.sendQueuedTurnInputNow('thread / 1', 'input / 1');

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs',
        method: 'POST',
        body: queuedInput,
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201/retrieve',
        method: 'POST',
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201/release',
        method: 'POST',
        body: { editToken: 'edit_1' },
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201',
        method: 'PATCH',
        body: {
          editToken: 'edit_2',
          input: 'edited follow up',
          attachments: [],
        },
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201',
        method: 'DELETE',
      },
      {
        path: '/v1/threads/thread%20%2F%201/queued-turn-inputs/input%20%2F%201/send-now',
        method: 'POST',
      },
    ]);
  });

  it('lists and terminates thread-scoped background shell services through encoded paths', async () => {
    const request = installRuntimeBridge(() => ({ processes: [] }));
    const client = createDesktopRuntimeClient();

    await client.listBackgroundShellProcesses('thread / 1');
    await client.terminateBackgroundShellProcess('thread / 1', 'process / 1');

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      { path: '/v1/threads/thread%20%2F%201/background-shell-processes' },
      {
        path: '/v1/threads/thread%20%2F%201/background-shell-processes/process%20%2F%201',
        method: 'DELETE',
      },
    ]);
  });

  it('uses narrow bridges for local links, managed uploads, and pending deletes', async () => {
    const linkAttachment = vi.fn(async () => ({
      id: 'attachment_link_1',
      assetId: 'attachment_link_1',
      source: 'runtime' as const,
      name: 'notes.txt',
      type: 'text/plain',
      size: 5,
    }));
    const uploadAttachment = vi.fn(async () => ({
      id: 'attachment_1',
      assetId: 'attachment_1',
      source: 'runtime' as const,
      name: 'guide.pdf',
      type: 'application/pdf',
      size: 3,
    }));
    const request = vi.fn(async () => ({ deleted: true }));
    vi.stubGlobal('window', {
      setsunaDesktop: {
        runtime: { linkAttachment, request, uploadAttachment, startSse: vi.fn(() => vi.fn()) },
      },
    });
    const client = createDesktopRuntimeClient();
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const input = { name: 'guide.pdf', type: 'application/pdf', data: new Uint8Array([1, 2, 3]) };

    await expect(client.linkAttachment(file)).resolves.toMatchObject({ assetId: 'attachment_link_1' });
    await expect(client.uploadAttachment(input)).resolves.toMatchObject({ assetId: 'attachment_1' });
    await expect(client.deleteAttachment('attachment / 1')).resolves.toEqual({ deleted: true });
    expect(linkAttachment).toHaveBeenCalledWith(file);
    expect(uploadAttachment).toHaveBeenCalledWith(input);
    expect(request).toHaveBeenCalledWith({ path: '/v1/attachments/attachment%20%2F%201', method: 'DELETE' });
  });

  it('routes thread deletion and reviews through first-party REST', async () => {
    const request = installRuntimeBridge((input) => {
      if (input.path.endsWith('/reviews')) {
        return { accepted: true, turnId: 'turn_review' };
      }
      return { ok: true };
    });
    const client = createDesktopRuntimeClient();
    const target = { type: 'baseBranch' as const, branch: 'main' };
    const reviewInput = {
      modelSelection: { providerId: 'provider-selected', modelId: 'model-selected' },
      target,
    };

    await client.deleteThread('thread / 1');
    await expect(client.startReview('thread / 1', reviewInput)).resolves.toEqual({
      accepted: true,
      turnId: 'turn_review',
    });

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      {
        path: '/v1/threads/thread%20%2F%201',
        method: 'DELETE',
      },
      {
        path: '/v1/threads/thread%20%2F%201/reviews',
        method: 'POST',
        body: reviewInput,
      },
    ]);
  });

  it('routes hooks and skill roots through first-party REST', async () => {
    const request = installRuntimeBridge((input) => {
      if (input.path.startsWith('/v1/hooks')) {
        return { data: [] };
      }
      return { ok: true };
    });
    const client = createDesktopRuntimeClient();

    await client.listHooks(['/repo one', '/repo/two']);
    await client.setSkillExtraRoots(['/skills/one']);

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      {
        path: '/v1/hooks?cwd=%2Frepo+one&cwd=%2Frepo%2Ftwo',
      },
      {
        path: '/v1/skills/extra-roots',
        method: 'PUT',
        body: { extraRoots: ['/skills/one'] },
      },
    ]);
  });

  it('requests the workspace scoped to a conversation thread', async () => {
    const request = installRuntimeBridge(() => ({ exists: true, readable: true }));
    const client = createDesktopRuntimeClient();

    await client.getWorkspaceStatus({ threadId: 'thread / 1' });

    expect(request).toHaveBeenCalledWith({
      path: '/v1/workspace/status?threadId=thread+%2F+1',
    });
  });
});

function installRuntimeBridge(handler: (input: RuntimeRequestInput) => unknown) {
  const request = vi.fn(async (input: RuntimeRequestInput) => handler(input));
  vi.stubGlobal('window', {
    setsunaDesktop: {
      runtime: {
        request,
        startSse: vi.fn(() => vi.fn()),
      },
    },
  });
  return request;
}
