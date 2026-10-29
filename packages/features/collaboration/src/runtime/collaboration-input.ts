import type { CollaborationTask } from '../contracts/index.js';

export function requiredString(record: Record<string, unknown>, keys: string[], label: string): string {
  const value = optionalString(record, keys);
  if (!value) throw new Error(`${label} is required`);
  return value;
}

export function optionalString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function collaborationTitle(record: Record<string, unknown>, prompt: string): string {
  const title = optionalString(record, ['title', 'name']);
  if (title) return title;
  const compact = prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
  return compact ? `Subagent: ${compact}` : 'Subagent';
}

/** 短展示名：优先工具参数 name，其次按同父线程现有任务数生成 Agent N，并做去重。 */
export function collaborationDisplayName(
  record: Record<string, unknown>,
  existingTasks: readonly CollaborationTask[],
): string {
  const requested = optionalString(record, ['name']).slice(0, 24);
  const existingNames = new Set(existingTasks.map((task) => task.identity.displayName));
  if (requested) {
    if (!existingNames.has(requested)) return requested;
    let suffix = 2;
    while (existingNames.has(`${requested} ${suffix}`)) suffix += 1;
    return `${requested} ${suffix}`;
  }
  const fallbackIndex = existingTasks.length + 1;
  return existingNames.has(`Agent ${fallbackIndex}`)
    ? `Agent ${fallbackIndex + 1}`
    : `Agent ${fallbackIndex}`;
}

export function avatarSeedForThread(childThreadId: string): string {
  // 确定性哈希：同一 child 重启后头像稳定，且不依赖外部服务。
  let hash = 2166136261;
  for (let index = 0; index < childThreadId.length; index += 1) {
    hash ^= childThreadId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function collaborationTimeoutMs(record: Record<string, unknown>): number | undefined {
  const value = record.timeout_ms ?? record.timeoutMs;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  // Node timers overflow beyond a signed 32-bit delay and would otherwise fire immediately.
  return Math.max(0, Math.min(2_147_483_647, Math.floor(value)));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function neutralizePromptClosingTags(value: string, tagNames: readonly string[]): string {
  if (!value || !tagNames.length) return value;
  const alternatives = tagNames.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  return value.replace(new RegExp(`</(?:${alternatives})`, 'giu'), (match) => `<\\/${match.slice(2)}`);
}
