import type { RuntimeConfiguredModelReference } from '../config.js';

export type WorkspaceConversationOptions = Readonly<{
  model?: RuntimeConfiguredModelReference;
  thinking?: Readonly<{ enabled: boolean; effort: string }>;
  skillIds?: readonly string[];
}>;

export type WorkspaceConversationDefaults =
  | (WorkspaceConversationOptions & { readonly sourceProjectId?: never })
  | Readonly<{ sourceProjectId: string; model?: never; thinking?: never; skillIds?: never }>;

type ProjectDefaultsSource = Readonly<{
  id: string;
  conversationDefaults?: WorkspaceConversationDefaults;
  archivedAt?: string;
}>;

/** Resolve at use time so following projects see source edits without copying stored values. */
export function resolveWorkspaceConversationDefaults(
  project: ProjectDefaultsSource | undefined,
  projects: readonly ProjectDefaultsSource[],
): WorkspaceConversationOptions | undefined {
  const visited = new Set<string>();
  let current = project;
  while (current) {
    if (visited.has(current.id)) return undefined;
    visited.add(current.id);
    const defaults = current.conversationDefaults;
    if (defaults?.sourceProjectId === undefined) return defaults;
    current = projects.find((candidate) => candidate.id === defaults.sourceProjectId && !candidate.archivedAt);
  }
  return undefined;
}

/** Reject self references, missing sources and loops before persisting a following relationship. */
export function canFollowWorkspaceConversationDefaults(
  projectId: string | undefined,
  sourceProjectId: string,
  projects: readonly ProjectDefaultsSource[],
): boolean {
  const visited = new Set(projectId ? [projectId] : []);
  let sourceId: string | undefined = sourceProjectId;
  while (sourceId !== undefined) {
    if (visited.has(sourceId)) return false;
    visited.add(sourceId);
    const source = projects.find((candidate) => candidate.id === sourceId && !candidate.archivedAt);
    if (!source) return false;
    sourceId = source.conversationDefaults?.sourceProjectId;
  }
  return true;
}

/** Omission preserves defaults; null clears them. Defaults are data, never an executable preset. */
export function normalizeWorkspaceConversationDefaults(value: unknown): WorkspaceConversationDefaults | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversation defaults.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['model', 'thinking', 'skillIds', 'sourceProjectId'].includes(key))) throw new Error('Unknown conversation default.');
  const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error('Invalid conversation default identifier.');
    return value.trim();
  };
  if (record.sourceProjectId !== undefined) {
    if (['model', 'thinking', 'skillIds'].some((key) => record[key] !== undefined)) {
      throw new Error('Following a project and custom defaults are mutually exclusive.');
    }
    return { sourceProjectId: text(record.sourceProjectId) };
  }
  let model: RuntimeConfiguredModelReference | undefined;
  if (record.model !== undefined) {
    const input = record.model as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid default model.');
    model = { providerId: text(input.providerId), modelId: text(input.modelId) };
  }
  let thinking: WorkspaceConversationDefaults['thinking'];
  if (record.thinking !== undefined) {
    const input = record.thinking as Record<string, unknown>;
    if (!input || typeof input.enabled !== 'boolean' || typeof input.effort !== 'string' || input.effort.length > 64) throw new Error('Invalid default thinking.');
    thinking = { enabled: input.enabled, effort: input.effort };
  }
  let skillIds: string[] | undefined;
  if (record.skillIds !== undefined) {
    if (!Array.isArray(record.skillIds) || record.skillIds.length > 24) throw new Error('Invalid default skills.');
    skillIds = [...new Set(record.skillIds.map(text))];
  }
  return { ...(model ? { model } : {}), ...(thinking ? { thinking } : {}), ...(skillIds?.length ? { skillIds } : {}) };
}
