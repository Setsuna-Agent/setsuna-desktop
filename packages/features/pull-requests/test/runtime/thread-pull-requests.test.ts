import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeatureProjectionStore, type FeatureProjectionCheckpoint, type ThreadEventReader } from '@setsuna-desktop/feature-core/runtime';
import type { SequencedThreadEventRecord } from '@setsuna-desktop/feature-core/events';
import { pullRequestAttachmentTool } from '../../src/runtime/attachment-tool.js';
import { attachmentProjectionCodec, emptyAttachments, reduceThreadAttachments } from '../../src/runtime/thread-attachments.js';
import { ThreadPullRequests } from '../../src/runtime/thread-pull-requests.js';
import { readRequestSummary, summary } from '../../src/runtime/pull-requests.js';
import { githubFixture, summaryNode } from '../support/github-fixture.js';

const url = (number: number, repository = 'owner/repo') => `https://github.com/${repository}/pull/${number}`;
function completed(seq: number, toolName: string, content = '', args: unknown = {}, data: unknown = {}, threadId = 'A'): SequencedThreadEventRecord {
  return { id: `e${seq}`, seq, threadId, type: 'tool.completed', createdAt: `2026-10-20T00:00:${String(seq).padStart(2, '0')}Z`,
    payload: { toolCallId: `t${seq}`, toolName, content, argumentsPreview: JSON.stringify(args), data, status: 'success' } };
}
const attached = (seq: number, number: number, repository = 'owner/repo', threadId = 'A') => {
  const result = pullRequestAttachmentTool.attach({ url: url(number, repository) });
  return completed(seq, 'attach_pull_request', result.content, {}, result.data, threadId);
};
afterEach(() => vi.useRealTimers());

describe('conversation PR associations', () => {
  it('replays multiple repositories/PRs, deduplicates explicit and automatic attachment, and restores from a durable checkpoint', async () => {
    const histories: Record<string, SequencedThreadEventRecord[]> = { A: [
      completed(1, 'run_shell_command', url(12), { command: 'cd /repo && gh pr create --title fix --body-file body.md' }, { exit_code: 0 }),
      attached(2, 12, 'Owner/Repo'), attached(3, 13), attached(4, 12, 'other/repo'),
    ], B: [attached(1, 99, 'owner/repo', 'B')] };
    const checkpoints = new Map<string, FeatureProjectionCheckpoint>();
    const reader: ThreadEventReader = {
      highWater: async (id) => histories[id].length,
      readPage: vi.fn(async (id, input) => ({ records: histories[id].slice(input.afterSeq, Math.min(input.throughSeq, input.afterSeq + input.limit)), throughSeq: input.throughSeq })),
      checkpoints: { read: async (id) => checkpoints.get(id) ?? null, write: async (id, _key, value) => { checkpoints.set(id, value); } },
    };
    const options = { eventReader: reader, initialState: emptyAttachments, reduce: reduceThreadAttachments, pageSize: 2,
      checkpoint: { key: 'pull-requests.attachments:1', codec: attachmentProjectionCodec } };
    const store = createFeatureProjectionStore(options);
    expect(reader.readPage).not.toHaveBeenCalled();
    expect((await store.read('A')).state.attachments.map((pr) => pr.url)).toEqual([url(12), url(13), url(12, 'other/repo')]);
    expect((await store.read('B')).state.attachments.map((pr) => pr.number)).toEqual([99]);
    await store.dispose();
    vi.mocked(reader.readPage).mockClear();
    const restored = createFeatureProjectionStore(options);
    expect((await restored.read('A')).state.attachments).toHaveLength(3);
    expect(reader.readPage).not.toHaveBeenCalled();
    histories.A.push(attached(5, 14));
    expect((await restored.read('A')).state.attachments.map((pr) => pr.number)).toEqual([12, 13, 12, 14]);
    expect(reader.readPage).toHaveBeenCalledExactlyOnceWith('A', { afterSeq: 4, throughSeq: 5, limit: 2 });
    await restored.dispose();
  });

  it('ignores reference links, failed creations and spoofed URLs, and consumes the actual MCP creation result', () => {
    let state = emptyAttachments();
    for (const event of [
      completed(1, 'run_shell_command', url(12), { command: 'gh pr view 12 --json url' }),
      completed(2, 'run_shell_command', url(12), { command: 'echo "gh pr create"' }),
      completed(3, 'run_shell_command', url(12), { command: 'gh pr create' }, { exit_code: 1 }),
      completed(4, 'mcp__github__create_pull_request', JSON.stringify({ html_url: url(12) }), {}, { result: { isError: true } }),
      completed(5, 'attach_pull_request', '', {}, { resultKind: 'pull-requests.attachment', reference: { repository: '../repo', number: 12 } }),
    ]) state = reduceThreadAttachments(state, event);
    expect(state.attachments).toEqual([]);
    for (const invalid of ['https://github.com.evil.test/owner/repo/pull/12', 'https://user@github.com/owner/repo/pull/12', 'file:///owner/repo/pull/12', 'https://github.com/owner/repo/issues/12']) {
      expect(() => pullRequestAttachmentTool.attach({ url: invalid })).toThrow();
    }
    const text = JSON.stringify({ body: `See ${url(99)} ${'description '.repeat(300)}`, html_url: url(13) });
    state = reduceThreadAttachments(state, completed(6, 'mcp__github__create_pull_request', text.slice(0, 2000), {}, {
      serverKey: 'github', toolName: 'create_pull_request', result: { isError: false, content: [{ type: 'text', text }] },
    }));
    expect(state.attachments.map((pr) => pr.number)).toEqual([13]);
  });

  it('associates a background gh create only after its process completes successfully', () => {
    let state = reduceThreadAttachments(emptyAttachments(), completed(1, 'exec_command', url(12), { cmd: 'gh pr create' }, { process_id: 'p', running: true }));
    expect(state.attachments).toEqual([]);
    state = reduceThreadAttachments(state, completed(2, 'read_shell_process', '', { process_id: 'p' }, { process_id: 'p', running: false, exit_code: 0 }));
    expect(state.attachments.map((pr) => pr.number)).toEqual([12]);
    expect(state.processes).toEqual([]);
  });

  it('returns associations without waiting for GitHub; deduplicates status reads and isolates network failures', async () => {
    const a = reduceThreadAttachments(emptyAttachments(), attached(1, 12));
    const b = reduceThreadAttachments(emptyAttachments(), attached(1, 13));
    const projection = { read: vi.fn(async (id: string) => ({ state: id === 'empty' ? emptyAttachments() : id === 'B' ? b : a, throughSeq: 1 })), dispose: vi.fn() };
    let resolve!: (value: ReturnType<typeof summary>) => void;
    const { api, request } = githubFixture(({ variables }) => variables.number === 13
      ? Promise.reject(new Error('Offline')) : { repository: { pullRequest: summaryNode(12) } });
    const load = vi.fn((reference, signal: AbortSignal) => reference.number === 12
      ? new Promise<ReturnType<typeof summary>>((done) => { resolve = done; }) : readRequestSummary(api, reference, signal));
    const service = new ThreadPullRequests(projection, load);
    expect(projection.read).not.toHaveBeenCalled();
    await service.read(['empty']);
    expect(load).not.toHaveBeenCalled();
    const initial = await service.read(['A', 'B', 'C']);
    expect(initial.threads.map((thread) => thread.items[0].summary)).toEqual([null, null, null]);
    expect(load).toHaveBeenCalledTimes(2);
    const merged = { ...summary(summaryNode(12), 'owner/repo'), state: 'MERGED' as const };
    resolve(merged);
    await vi.waitFor(async () => {
      const result = await service.read(['A', 'B', 'C']);
      expect(result.threads[0].items[0].summary?.state).toBe('MERGED');
      expect(result.threads[1].items[0].error).toBe('Offline');
      expect(result.threads[2].items[0].summary?.state).toBe('MERGED');
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('retains last known status on refresh failure and prevents a late read from replacing detail updates or reviving a disposed tracker', async () => {
    vi.useFakeTimers();
    const state = reduceThreadAttachments(emptyAttachments(), attached(1, 12));
    const projection = { read: async () => ({ state, throughSeq: 1 }), dispose: vi.fn() };
    const original = summary(summaryNode(12), 'owner/repo');
    let finish!: (value: typeof original) => void;
    const load = vi.fn().mockResolvedValueOnce(original).mockRejectedValueOnce(new Error('Offline'))
      .mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const service = new ThreadPullRequests(projection, load);
    await service.read(['A']);
    await vi.advanceTimersByTimeAsync(45_001);
    await service.read(['A']);
    await vi.advanceTimersByTimeAsync(0);
    expect((await service.read(['A'])).threads[0].items[0]).toMatchObject({ summary: { state: 'OPEN' }, error: 'Offline' });
    await vi.advanceTimersByTimeAsync(60_001);
    await service.read(['A']);
    service.remember({ ...original, state: 'CLOSED' });
    finish(original);
    await vi.advanceTimersByTimeAsync(0);
    expect((await service.read(['A'])).threads[0].items[0].summary?.state).toBe('CLOSED');
    await vi.advanceTimersByTimeAsync(45_001);
    await service.read(['A']);
    service.dispose();
    expect(load.mock.calls.at(-1)![1].aborted).toBe(true);
    finish(original);
    await vi.advanceTimersByTimeAsync(0);
    await expect(service.read(['A'])).rejects.toThrow('disposed');
  });
});
