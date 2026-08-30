import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import {
  chatToolResultResolverSlot,
  type ResolvedChatToolResult,
} from '@setsuna-desktop/renderer-contracts/chat';
import { useRendererRootChainResolver } from '../../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useCallback } from 'react';

export type RuntimeFeatureToolResult = Readonly<{
  result: ResolvedChatToolResult;
  runId: string;
}>;

export function resolveRuntimeFeatureToolResult(
  resolve: RuntimeFeatureToolResultResolver,
  run: RuntimeToolRun,
): ResolvedChatToolResult | null {
  return resolve(run);
}

export type RuntimeFeatureToolResultResolver = (
  run: RuntimeToolRun,
) => ResolvedChatToolResult | null;

export function useRuntimeFeatureToolResultResolver(): RuntimeFeatureToolResultResolver {
  const resolve = useRendererRootChainResolver(chatToolResultResolverSlot);
  return useCallback(
    (run: RuntimeToolRun) => resolve({ toolName: run.name, value: run.data }),
    [resolve],
  );
}

/** Keeps the latest position and payload when a persistent result republishes the same identity. */
export function assistantTailFeatureToolResults(
  resolve: RuntimeFeatureToolResultResolver,
  runs: readonly RuntimeToolRun[],
): RuntimeFeatureToolResult[] {
  const seenIdentities = new Set<string>();
  const results = [...runs].reverse().flatMap((run) => {
    if (run.status !== 'success') return [];
    const result = resolveRuntimeFeatureToolResult(resolve, run);
    if (result?.contribution.placement !== 'assistant-tail') return [];
    const identity = result.contribution.identity?.(result.payload);
    if (identity) {
      const key = `${result.featureId}\u0000${result.contribution.id}\u0000${identity}`;
      if (seenIdentities.has(key)) return [];
      seenIdentities.add(key);
    }
    return [{ result, runId: run.id }];
  });
  return results.reverse();
}
