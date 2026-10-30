import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { ContextTokenCalibration } from '../../../src/loop/context/context-token-calibration.js';
import { createRuntimeContextCompactionCandidate, estimateRuntimeMessageTokens, estimateRuntimeToolDefinitionTokens, reserveRuntimeContextCompactionBudget } from '../../../src/loop/context/context-compaction.js';
import { samplingContextWindowForRequest } from '../../../src/loop/context/runtime-context-compactor.js';

describe('context token calibration', () => {
  it('uses request input once, carries the correction into compaction, and resets at model/window boundaries', () => {
    const model = { providerId: 'provider', model: 'chat' };
    const messages: RuntimeMessage[] = Array.from({ length: 12 }, (_, i) => ({ id: `message_${i}`, role: 'assistant', content: 'a'.repeat(100), status: 'complete', createdAt: '2026-09-12T00:00:00Z' }));
    const calibration = new ContextTokenCalibration();
    const raw = estimateRuntimeMessageTokens(messages);
    calibration.record(model, messages, [], { inputTokens: raw + 400, cachedInputTokens: 200, outputTokens: 9000, totalTokens: 1_000_000 });
    const adjustment = calibration.adjustment(model, messages);
    expect(adjustment).toBe(400);
    const budget = { maxContextTokens: 1000, autoCompactTokenLimit: raw + 350, inputTokenAdjustment: adjustment };
    const snapshot = samplingContextWindowForRequest({ budget, messages, reservedOutputTokens: 100 })!;
    expect(snapshot.estimatedTokens).toBe(raw + 500);
    const candidate = createRuntimeContextCompactionCandidate({ budget: reserveRuntimeContextCompactionBudget(budget, 100), messages });
    expect(candidate).not.toBeNull();
    expect(candidate!.originalTokens + candidate!.reservedTokens).toBe(snapshot.estimatedTokens);
    expect(calibration.adjustment({ ...model, model: 'other' }, messages)).toBe(0);
    expect(calibration.adjustment({ ...model, providerId: 'other' }, messages)).toBe(0);
    const compacted = [{ ...messages[0]!, contextCompaction: { compactedMessageCount: 10 } as RuntimeMessage['contextCompaction'] }];
    expect(calibration.adjustment(model, compacted)).toBe(0);
    calibration.record(model, messages, [], undefined);
    expect(calibration.adjustment(model, messages)).toBe(400);
    const restored = new ContextTokenCalibration(calibration.snapshot());
    expect(restored.adjustment(model, [...messages, { ...messages[0]!, id: 'new', content: 'new result' }])).toBe(400);
    expect(restored.adjustment(model, [{ ...messages[0]!, content: 'edited prefix' }, ...messages.slice(1)])).toBe(0);
  });

  it('caps actual output using calibrated input and tool definitions without consuming the compaction reserve twice', () => {
    const messages: RuntimeMessage[] = [{ id: 'message', role: 'user', content: 'Continue the task', status: 'complete', createdAt: '2026-09-12T00:00:00Z' }];
    const tools = [{ name: 'read_file', description: 'Read evidence. '.repeat(100), inputSchema: { type: 'object' } }];
    const model = { providerId: 'provider', model: 'chat' };
    const calibration = new ContextTokenCalibration();
    const inputTokens = estimateRuntimeMessageTokens(messages) + estimateRuntimeToolDefinitionTokens(tools) + 400;
    calibration.record(model, messages, tools, { inputTokens });
    const snapshot = samplingContextWindowForRequest({
      messages, tools, maxOutputTokens: 8_000, reservedOutputTokens: 1_200,
      budget: { maxContextTokens: 8_000, inputTokenAdjustment: calibration.adjustment(model, messages) },
    });
    expect(snapshot.estimatedTokens).toBe(inputTokens + 1_200);
    expect(snapshot.maxOutputTokens).toBe(8_000 - inputTokens - 1_024);
    expect(snapshot.tokensUntilCompaction).toBe(6_800 - snapshot.estimatedTokens);
    expect(() => samplingContextWindowForRequest({
      messages, tools, maxOutputTokens: 8_000,
      budget: { maxContextTokens: 8_000, inputTokenAdjustment: 8_000 },
    })).toThrow('no output space');
  });
});
