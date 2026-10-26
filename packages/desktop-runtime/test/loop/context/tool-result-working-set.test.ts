import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { FileToolResultStore } from '../../../src/adapters/store/file-tool-result-store.js';
import { projectToolResultWorkingSet } from '../../../src/loop/context/tool-result-working-set.js';
import { boundToolOutput } from '../../../src/loop/tools/tool-output-budget.js';
import type { ToolResultStore } from '../../../src/ports/tool-result-store.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';

const messages = (): RuntimeMessage[] => Array.from({ length: 12 }, (_, index) => ({
  id: `msg_${index}`, role: 'tool', toolCallId: `call_${index}`, toolName: 'read_file',
  content: 'a'.repeat(8000), createdAt: '2026-10-26T00:00:00Z', status: 'complete',
  toolResultRef: { resultId: `result_${index}`, originalEstimatedTokens: 2000, visibleTokens: 2000, visibleTokenLimit: 10000 },
}));
const store = (available: boolean) => ({ read: async () => available ? { content: 'a' } : null }) as unknown as ToolResultStore;

describe('tool observation working set', () => {
  it('keeps recent observations and protocol identities while leaving the transcript intact', async () => {
    const original = messages();
    const result = await projectToolResultWorkingSet({ messages: original, transcriptMessages: original, store: store(true), threadId: 'thread', conversationTokenLimit: 20_000 });
    expect(result[0].content).toContain('result_id: result_0');
    expect(result[0].toolCallId).toBe('call_0');
    expect(result.slice(-6)).toEqual(original.slice(-6));
    expect(original.every(message => message.content.length === 8000)).toBe(true);
  });

  it('preserves failed output, attachments and unavailable stored observations', async () => {
    const original = messages();
    original[0].status = 'error';
    original[1].attachments = [{ id: 'image', source: 'generated', assetId: 'asset', name: 'evidence.png', type: 'image/png', size: 100 }];
    expect(await projectToolResultWorkingSet({ messages: original, transcriptMessages: original, store: store(false), threadId: 'thread', conversationTokenLimit: 20_000 })).toEqual(original);
    const result = await projectToolResultWorkingSet({ messages: original, transcriptMessages: original, store: store(true), threadId: 'thread', conversationTokenLimit: 20_000 });
    expect(result[0]).toEqual(original[0]);
    expect(result[1]).toEqual(original[1]);
  });

  it.each([20_000, 100_000])('restores previously projected evidence after eviction with a %i token window', async conversationTokenLimit => {
    const original = messages();
    const projected = await projectToolResultWorkingSet({ messages: original, transcriptMessages: original,
      store: store(true), threadId: 'thread', conversationTokenLimit: 20_000 });
    expect(projected[0].content).toContain('[Stored tool observation]');
    const restored = await projectToolResultWorkingSet({ messages: projected, transcriptMessages: original,
      store: store(false), threadId: 'thread', conversationTokenLimit });
    expect(restored).toEqual(original);
    expect(projected[0].content).toContain('[Stored tool observation]');
  });

  it('preserves the visible tail when local storage contains only the output prefix', async () => {
    const resultStore = new FileToolResultStore(await createTestTempDirectory('working-set-tail-'), 8192);
    const original = messages();
    const tail = 'FINAL SUMMARY: 37 passed, 2 failed';
    for (const [index, message] of original.entries()) {
      const fullText = index === 0 ? `Output header\n${'x'.repeat(20_000)}\n${tail}` : message.content;
      const ref = message.toolResultRef!;
      const saved = await resultStore.save({ resultId: ref.resultId, threadId: 'thread', toolCallId: message.toolCallId!,
        toolName: message.toolName!, fullText, originalEstimatedTokens: Math.ceil(fullText.length / 4),
        visibleTokenLimit: 2000, locallyTruncated: false });
      const bounded = boundToolOutput({ content: fullText, tokenLimit: 2000, resultId: ref.resultId,
        locallyTruncated: saved.locallyTruncated });
      original[index] = { ...message, content: bounded.content, toolResultRef: { ...ref,
        originalEstimatedTokens: bounded.originalEstimatedTokens, visibleTokens: bounded.visibleTokens,
        visibleTokenLimit: 2000, locallyTruncated: saved.locallyTruncated } };
    }
    const stored = await resultStore.read('thread', 'result_0', 0, 30_000);
    expect(stored).toMatchObject({ totalBytes: 8192, nextOffset: null });
    expect(stored?.content).not.toContain(tail);
    expect(original[0].content).toContain(tail);
    const projected = await projectToolResultWorkingSet({ messages: original, transcriptMessages: original,
      store: resultStore, threadId: 'thread', conversationTokenLimit: 20_000 });
    expect(projected[0]).toEqual(original[0]);
    expect(projected[1].content).toContain('[Stored tool observation]');
  });
});
