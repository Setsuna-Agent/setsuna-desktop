import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { nextContextCompactionBatch } from '../../../src/loop/context/context-compaction-batches.js';
import { compactionSummaryPrompt, compactionSummarySource } from '../../../src/loop/context/context-compaction-summary.js';
import { createRuntimeContextCompactionCandidate, estimateRuntimeMessageTokens } from '../../../src/loop/context/context-compaction.js';
import { nativeCompactionCandidate } from '../../../src/loop/context/context-compaction-native.js';

const now = '2026-10-30T00:00:00Z';

describe('complete compaction source coverage', () => {
  it('carries long-message middle evidence, full tool arguments and all images through bounded batches', () => {
    const evidence = `${'前面的证据。'.repeat(3000)}\nMIDDLE_EVIDENCE_42\n${'后面的证据。'.repeat(3000)}`;
    const messages: RuntimeMessage[] = [{
      id: 'evidence', role: 'assistant', content: evidence, createdAt: now,
      toolCalls: [{ id: 'call', name: 'write_file', arguments: JSON.stringify({ content: `${'a'.repeat(6000)}FULL_ARGUMENT${'z'.repeat(6000)}` }) }],
    }, {
      id: 'tool', role: 'tool', toolCallId: 'call', content: 'Result evidence', createdAt: now,
      attachments: [0, 1].map((i) => ({ id: `image_${i}`, source: 'generated', assetId: `asset_${i}`, name: `${i}.png`, type: 'image/png', size: 10, modelVisible: true })),
    }, { id: 'latest', role: 'user', content: 'Continue with these constraints', createdAt: now }];
    const candidate = createRuntimeContextCompactionCandidate({ messages, force: true, keepRecentMessages: 1 })!;
    const initial = compactionSummarySource(candidate);
    const budget = { contextWindow: 10_000, inputTokenLimit: 8_000, modelOutputLimit: 2000, summaryTokenLimit: 500, supportsImages: true, modelRequest: { model: 'summary' } };
    let source = initial;
    const batches = [];
    do {
      const previousSummary = batches.length ? 'Preserve earlier verified progress and pending image checks.' : '';
      const next = nextContextCompactionBatch({ source, previousSummary, budget, createdAt: now });
      const prompt = compactionSummaryPrompt(next.source, now, budget.summaryTokenLimit, true, previousSummary);
      expect(estimateRuntimeMessageTokens(prompt)).toBeLessThanOrEqual(budget.inputTokenLimit);
      batches.push(next.source);
      source = next.remaining;
      expect(batches.length).toBeLessThan(30);
    } while (source.olderHistory || source.recentContext || source.images?.length);
    expect(batches.length).toBeGreaterThan(2);
    expect(batches.map((batch) => batch.olderHistory).join('')).toBe(initial.olderHistory);
    expect(batches.map((batch) => batch.recentContext).join('')).toBe(initial.recentContext);
    expect(batches.flatMap((batch) => batch.images ?? [])).toEqual(initial.images);
    expect(initial.olderHistory).toContain(evidence);
    expect(initial.olderHistory).toContain(messages[0]!.toolCalls![0]!.arguments);
    const textOnly = compactionSummarySource(candidate, undefined, false);
    expect(textOnly.images).toEqual([]);
    expect(textOnly.olderHistory).toContain('asset_0');
    expect(textOnly.olderHistory).toContain('asset_1');
  });

  it('retains only active genuine user inputs around a V2 checkpoint, without replaying the summarized tool suffix', () => {
    const messages: RuntimeMessage[] = [
      { id: 'archived', role: 'user', content: 'Old task', visibility: 'transcript', createdAt: now },
      { id: 'task', role: 'user', content: 'Current task', createdAt: now },
      { id: 'evidence', role: 'assistant', content: 'x'.repeat(12_000), createdAt: now },
      { id: 'report', role: 'user', content: 'Context report', promptSource: 'runtime_context', visibility: 'model', createdAt: now },
      { id: 'correction', role: 'user', content: 'Keep the Windows work', createdAt: now },
      { id: 'tool', role: 'tool', content: 'Recent tool result', toolCallId: 'call', createdAt: now },
    ];
    const candidate = createRuntimeContextCompactionCandidate({ messages, force: true })!;
    const v2 = nativeCompactionCandidate(candidate, messages, 'responses-v2', 100);
    expect(v2.pinnedMessages.map((message) => message.id)).toEqual(['task', 'correction']);
    expect(v2.recentMessages).toEqual([]);
    expect(v2.olderMessages.map((message) => message.id)).toEqual(['evidence', 'report', 'tool']);
    const standalone = nativeCompactionCandidate(candidate, messages, 'responses-compact', 100);
    expect(standalone.pinnedMessages).toEqual([]);
    expect(standalone.recentMessages).toEqual([]);
  });
});
