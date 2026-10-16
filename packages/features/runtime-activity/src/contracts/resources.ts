import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';

export type ProcessResourceSample = Readonly<{
  pid: number;
  startedAt: number;
  type: string;
  name: string;
  cpuTimeSeconds: number | null;
  residentBytes: number;
  canTerminate: boolean;
  pages: readonly Readonly<{ id: number; title: string; url: string }>[];
}>;

export type ProcessResourceSnapshot = Readonly<{
  sampledAt: number;
  processes: readonly ProcessResourceSample[];
}>;

export const RUNTIME_ACTIVITY_RESOURCE_CHANNEL = 'runtime-activity:resources';
export const RUNTIME_ACTIVITY_TERMINATE_RESOURCE_CHANNEL = 'runtime-activity:terminate-resource';

export type ResourceProcessTarget = Readonly<{ pid: number; startedAt: number; pageIds: readonly number[] }>;
export type ResourceProcessTermination = 'terminated' | 'stale' | 'protected';

export interface RuntimeActivityDesktopBridge {
  sampleResources(): Promise<ProcessResourceSnapshot>;
  terminateResourceProcess(target: ResourceProcessTarget): Promise<ResourceProcessTermination>;
}

export type RuntimeActivityPreloadContribution = Readonly<{ runtimeActivity: RuntimeActivityDesktopBridge }>;

const resourceSnapshotCodec = defineRuntimeCodec<ProcessResourceSnapshot>((value) => {
  if (!value || typeof value !== 'object') throw new Error('Invalid resource snapshot.');
  const snapshot = value as ProcessResourceSnapshot;
  if (!finite(snapshot.sampledAt) || !Array.isArray(snapshot.processes)) throw new Error('Invalid resource snapshot.');
  for (const item of snapshot.processes) {
    if (!item || !Number.isSafeInteger(item.pid) || item.pid <= 0 || !finite(item.startedAt)
      || typeof item.type !== 'string' || typeof item.name !== 'string' || !finite(item.residentBytes) || typeof item.canTerminate !== 'boolean'
      || (item.cpuTimeSeconds !== null && !finite(item.cpuTimeSeconds))
      || !Array.isArray(item.pages) || item.pages.some((page: ProcessResourceSample['pages'][number]) => !page || !Number.isSafeInteger(page.id)
        || typeof page.title !== 'string' || typeof page.url !== 'string')) throw new Error('Invalid process resource sample.');
  }
  return snapshot;
});

export const sampleRuntimeResources = defineFeatureOperation({
  id: 'runtime-activity.resources',
  method: 'GET',
  path: '/v1/features/runtime-activity/resources',
  input: defineRuntimeCodec<undefined>((value) => {
    if (value === undefined || value === null) return undefined;
    throw new Error('Resource sampling does not accept input.');
  }),
  output: resourceSnapshotCodec,
  errors: Object.freeze({}),
  idempotency: 'safe',
});

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
