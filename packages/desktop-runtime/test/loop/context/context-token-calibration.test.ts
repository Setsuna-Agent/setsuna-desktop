import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { ContextTokenCalibration } from '../../../src/loop/context/context-token-calibration.js';
import { createRuntimeContextCompactionCandidate, estimateRuntimeMessageTokens, reserveRuntimeContextCompactionBudget } from '../../../src/loop/context/context-compaction.js';
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
    expect(calibration.adjustment(model, messages)).toBe(0);
  });
});
