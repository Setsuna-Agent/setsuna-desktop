import { expect, it, vi } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { ThreadReadToolHost } from '../../../src/adapters/tool/thread-read-tool-host.js';
import { isRuntimeReadOnlyTool } from '../../../src/loop/context/runtime-read-only-tools.js';
import { RuntimeToolRouter } from '../../../src/loop/tools/tool-router.js';

const message = (role: RuntimeMessage['role'], content: string, extra: Partial<RuntimeMessage> = {}): RuntimeMessage => ({
  id: content, role, content, createdAt: '2026-10-13T00:00:00Z', ...extra,
});

it('projects conversation data without internal prompts, reasoning, attachments or provider metadata', async () => {
  const listMessages = vi.fn().mockResolvedValue({ total: 10, nextBefore: 2, messages: [
    message('system', 'SYSTEM_SECRET'),
    message('user', 'MODEL_SECRET', { visibility: 'model' }),
    message('user', 'HOOK_SECRET', { promptSource: 'runtime_context' }),
    message('assistant', 'COMPACTION_SECRET', { contextCompaction: {
      compactedMessageCount: 2, compactedTokens: 10, keptRecentMessageCount: 1, maxContextTokensK: 8, originalMessageCount: 3, originalTokens: 20,
    } }),
    message('user', 'Original question', { attachments: [{
      id: 'ATTACHMENT_SECRET', name: 'private.txt', type: 'text/plain', size: 10, source: 'runtime', assetId: 'ASSET_SECRET',
    }] }),
    message('assistant', '<think>REASONING_SECRET</think>Checking', { id: 'legacy' }),
    message('assistant', 'STRUCTURED_SECRET', { id: 'structured', streamParts: [
      { type: 'reasoning', content: 'STRUCTURED_SECRET' }, { type: 'content', content: 'Visible answer' },
    ], toolCalls: [{ id: 'call', name: 'read_file', arguments: '{"path":"README.md"}' }], providerMetadata: { semanticFingerprint: 'PROVIDER_SECRET' } }),
    message('tool', 'Stored tool output', { toolName: 'read_file', toolCallId: 'call' }),
  ] });
  const host = new ThreadReadToolHost({ listMessages });
  const context = { threadId: 'current', features: { plugins: false }, readOnly: true };
  const result = await host.runTool('read_thread', { thread_id: 'source' }, context);
  expect(listMessages).toHaveBeenCalledExactlyOnceWith('source', { limit: 20 });
  expect(result.content).not.toMatch(/SECRET|Stored tool output/);
  expect(result.data).toMatchObject({ thread_id: 'source', next_before: 2, total: 10, messages: [
    { role: 'user', content: 'Original question' },
    { role: 'assistant', content: 'Checking' },
    { role: 'assistant', content: 'Visible answer', toolCalls: [{ id: 'call', name: 'read_file', arguments: '{"path":"README.md"}' }] },
  ] });
  expect(result.containsExternalContext).toBe(true);
  const detailed = await host.runTool('read_thread', { thread_id: 'source', include_tool_results: true }, context);
  expect(detailed.data.messages.at(-1)).toMatchObject({ role: 'tool', toolName: 'read_file', toolCallId: 'call', content: 'Stored tool output' });
  expect(detailed.content).not.toContain('SECRET');
});

it('keeps the cursor through a filtered page and advertises history reads in a plugin-free read-only turn', async () => {
  const listMessages = vi.fn().mockResolvedValue({ total: 4, nextBefore: 2, messages: [message('user', 'hidden', { visibility: 'model' })] });
  const host = new ThreadReadToolHost({ listMessages });
  const context = { threadId: 'current', turnId: 'turn', features: { plugins: false }, readOnly: true,
    environment: { id: 'workspace', workspaceRoot: '/workspace', cwd: '/workspace', workspaceRoots: ['/workspace'] }, permissionProfile: 'read-only' as const,
    sandboxWorkspaceWrite: undefined, signal: new AbortController().signal };
  const router = await RuntimeToolRouter.create({ toolHost: host, context, approvalPolicy: 'on-request', orchestrator: null,
    allowTool: (tool) => isRuntimeReadOnlyTool(tool.name) });
  expect(router.tools.map((tool) => tool.name)).toContain('read_thread');
  expect(router.catalogToolDefinitions.find((tool) => tool.name === 'read_thread')?.source).toBeUndefined();
  expect((await router.toolRuntimeMetadata()).find((tool) => tool.name === 'read_thread')).toMatchObject({ source: 'host', supportsParallel: true });
  expect((await host.runTool('read_thread', { thread_id: 'source', before: 3, limit: 1 }, context)).data)
    .toMatchObject({ messages: [], next_before: 2 });
  expect(listMessages).toHaveBeenCalledExactlyOnceWith('source', { before: 3, limit: 1 });
});

it('rejects unsafe identifiers, invalid paging and cancelled reads before accessing storage', async () => {
  const listMessages = vi.fn();
  const host = new ThreadReadToolHost({ listMessages });
  const context = { threadId: 'current' };
  for (const input of [
    {}, { thread_id: '../private' }, { thread_id: 'thread://source' }, { thread_id: 'x'.repeat(193) },
    ...[0, 101, 1.5, '20', null].map((limit) => ({ thread_id: 'source', limit })),
    ...[-1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1].map((before) => ({ thread_id: 'source', before })),
    { thread_id: 'source', include_tool_results: 'true' },
  ]) {
    await expect(host.runTool('read_thread', input, context)).rejects.toThrow();
  }
  await expect(host.runTool('read_thread', { thread_id: 'source' }, { ...context, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(listMessages).not.toHaveBeenCalled();
  listMessages.mockRejectedValue(new Error('Thread not found: deleted'));
  await expect(host.runTool('read_thread', { thread_id: 'deleted' }, context)).rejects.toThrow('Thread not found');
});
