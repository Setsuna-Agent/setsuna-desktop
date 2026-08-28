import type { RuntimeToolRun } from '@setsuna-desktop/contracts';
import type {
  ResolvedToolResultView,
  ToolResultViewCatalog,
} from '@setsuna-desktop/feature-core/renderer';

export type RuntimeFeatureToolResult = Readonly<{
  result: ResolvedToolResultView;
  runId: string;
}>;

export function resolveRuntimeFeatureToolResult(
  catalog: ToolResultViewCatalog,
  run: RuntimeToolRun,
): ResolvedToolResultView | null {
  return catalog.resolve(run.data, { toolName: run.name });
}

/** Keeps the latest position and payload when a persistent result republishes the same identity. */
export function assistantTailFeatureToolResults(
  catalog: ToolResultViewCatalog,
  runs: readonly RuntimeToolRun[],
): RuntimeFeatureToolResult[] {
  const seenIdentities = new Set<string>();
  const results = [...runs].reverse().flatMap((run) => {
    if (run.status !== 'success') return [];
    const result = resolveRuntimeFeatureToolResult(catalog, run);
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
