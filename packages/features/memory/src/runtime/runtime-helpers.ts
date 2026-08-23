import type { RuntimeUsage } from '@setsuna-desktop/contracts';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      return recordInput(JSON.parse(input) as unknown);
    } catch {
      return {};
    }
  }
  return recordInput(input);
}

export function requiredStringArg(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export function optionalStringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function compactForPrompt(value: string, maxChars: number): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (normalized.length <= maxChars) return normalized;
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 48);
  return `${normalized.slice(0, head)}\n...[omitted ${normalized.length - head - tail} chars]...\n${normalized.slice(-tail)}`;
}

export function escapeSkillAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\t', '&#9;');
}

export function neutralizeMemoryTags(value: string): string {
  return neutralizePromptClosingTags(value, ['memory']);
}

export function neutralizePromptClosingTags(value: string, tagNames: readonly string[]): string {
  if (!value || !tagNames.length) return value;
  const alternatives = tagNames.map(escapeRegExp).join('|');
  return value.replace(new RegExp(`</(?:${alternatives})`, 'giu'), (match) => `<\\/${match.slice(2)}`);
}

export function parseJsonObjectFromText(value: string): Record<string, unknown> | null {
  const direct = tryParseJsonObject(value);
  if (direct) return direct;
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start < 0 || end <= start ? null : tryParseJsonObject(value.slice(start, end + 1));
}

export function parseJsonArrayFromText(value: string): unknown[] {
  const text = stripMarkdownFence(value).trim();
  const direct = tryParseJsonArray(text);
  if (direct) return direct;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  return start < 0 || end <= start ? [] : tryParseJsonArray(text.slice(start, end + 1)) ?? [];
}

export function stripMarkdownFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Memory operation aborted');
}

export function addRuntimeUsage(previous: RuntimeUsage | undefined, next: RuntimeUsage | undefined): RuntimeUsage | undefined {
  if (!next) return previous ? { ...previous } : undefined;
  const inputTokens = sumTokenCounts(previous?.inputTokens, next.inputTokens);
  const cachedInputTokens = sumTokenCounts(previous?.cachedInputTokens, next.cachedInputTokens);
  const outputTokens = sumTokenCounts(previous?.outputTokens, next.outputTokens);
  const totalTokens = sumTokenCounts(
    previous ? reportedRuntimeUsageTokenCount(previous) : undefined,
    reportedRuntimeUsageTokenCount(next),
  );
  return {
    ...previous,
    ...next,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

export function runtimeUsageTokenCount(usage: RuntimeUsage): number {
  return reportedRuntimeUsageTokenCount(usage) ?? 0;
}

export class MemoryBackgroundTaskQueue {
  private readonly controller = new AbortController();
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private pendingTasks = 0;

  enqueue<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Memory task queue is closed'));
    this.pendingTasks += 1;
    const result = this.tail.then(async () => {
      throwIfAborted(this.controller.signal);
      return task(this.controller.signal);
    });
    this.tail = result.then(() => this.finishTask(), () => this.finishTask());
    return result;
  }

  pendingTaskCount(): number {
    return this.pendingTasks;
  }

  async shutdown(timeoutMs: number): Promise<boolean> {
    if (!this.closed) {
      this.closed = true;
      this.controller.abort(new Error('Memory task queue is shutting down'));
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      timeout.unref?.();
    });
    const result = await Promise.race([this.tail.then(() => true), timedOut]);
    if (timeout) clearTimeout(timeout);
    return result;
  }

  private finishTask(): void {
    this.pendingTasks -= 1;
  }
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function tryParseJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function reportedRuntimeUsageTokenCount(usage: RuntimeUsage): number | undefined {
  return Number.isFinite(usage.totalTokens)
    ? normalizedTokenCount(usage.totalTokens)
    : sumTokenCounts(usage.inputTokens, usage.outputTokens);
}

function sumTokenCounts(...values: Array<number | undefined>): number | undefined {
  const counts = values.filter((value): value is number => Number.isFinite(value));
  return counts.length ? counts.reduce((total, value) => total + normalizedTokenCount(value), 0) : undefined;
}

function normalizedTokenCount(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}
