import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  TOOL_OUTPUT_LOCAL_HARD_CAP_BYTES,
  TOOL_OUTPUT_THREAD_QUOTA_BYTES,
  utf8CharEnd,
  utf8CharStart,
} from '../../loop/tools/tool-output-budget.js';
import {
  type RetainStoredToolResultsInput,
  type RetainStoredToolResultsResult,
  type StoredToolResultInput,
  type StoredToolResultPage,
  type StoredToolResultRecord,
  type ToolResultStore,
} from '../../ports/tool-result-store.js';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

type ToolResultIndex = {
  version: 1;
  results: StoredToolResultRecord[];
};

const EMPTY_INDEX: ToolResultIndex = { version: 1, results: [] };

/**
 * 超限工具结果的本地存储,目录位于 runtime/tool-results/。
 *
 * - 单结果 16 MiB 硬上限:落盘前裁剪并在记录上标记 locallyTruncated。
 * - 单 thread 128 MiB 配额:按最旧优先淘汰,防止结果长期堆积。
 * - 读取按 thread 授权,只有记录 threadIds 包含请求线程才能读到。
 */
export class FileToolResultStore implements ToolResultStore {
  private readonly root: string;
  private readonly filesRoot: string;
  private readonly indexPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly hardCapBytes = TOOL_OUTPUT_LOCAL_HARD_CAP_BYTES,
    private readonly threadQuotaBytes = TOOL_OUTPUT_THREAD_QUOTA_BYTES,
  ) {
    this.root = path.join(dataDir, 'tool-results');
    this.filesRoot = path.join(this.root, 'files');
    this.indexPath = path.join(this.root, 'index.json');
  }

  save(input: StoredToolResultInput): Promise<{ locallyTruncated: boolean }> {
    return this.enqueueMutation(async () => {
      const safeThreadId = assertSafeRuntimeId(input.threadId, 'Thread id');
      const resultId = assertSafeRuntimeId(input.resultId, 'Tool result id');
      const fullBuffer = Buffer.from(input.fullText, 'utf8');
      const locallyTruncated = input.locallyTruncated || fullBuffer.byteLength > this.hardCapBytes;
      const storedBuffer = locallyTruncated
        ? fullBuffer.subarray(0, utf8CharEnd(fullBuffer, this.hardCapBytes))
        : fullBuffer;

      const index = await this.readIndex();
      const threadResults = index.results.filter((record) => record.threadIds.includes(safeThreadId));
      const threadBytes = threadResults.reduce((sum, record) => sum + record.sizeBytes, 0);
      let evictedForThread = new Set<string>();
      if (threadBytes + storedBuffer.byteLength > this.threadQuotaBytes) {
        const evictTarget = threadBytes + storedBuffer.byteLength - this.threadQuotaBytes;
        const evictionCandidates = [...threadResults]
          .sort((left, right) => createdAtMs(left) - createdAtMs(right) || left.resultId.localeCompare(right.resultId));
        let freedBytes = 0;
        const toEvict: string[] = [];
        for (const record of evictionCandidates) {
          if (freedBytes >= evictTarget) break;
          toEvict.push(record.resultId);
          freedBytes += record.sizeBytes;
        }
        evictedForThread = new Set(toEvict);
      }
      const orphanedResultIds: string[] = [];
      const retained = index.results.flatMap((record) => {
        if (!evictedForThread.has(record.resultId)) return [record];
        const threadIds = record.threadIds.filter((threadId) => threadId !== safeThreadId);
        if (threadIds.length) return [{ ...record, threadIds }];
        orphanedResultIds.push(record.resultId);
        return [];
      });
      const record: StoredToolResultRecord = {
        resultId,
        threadIds: [safeThreadId],
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        originalEstimatedTokens: input.originalEstimatedTokens,
        visibleTokenLimit: input.visibleTokenLimit,
        locallyTruncated,
        sizeBytes: storedBuffer.byteLength,
        createdAt: new Date().toISOString(),
      };
      await mkdir(this.filesRoot, { recursive: true });
      await writeFile(this.filePath(resultId), storedBuffer, { flag: 'wx', mode: 0o600 });
      try {
        await this.writeIndex({ version: 1, results: [...retained, record] });
      } catch (error) {
        await rm(this.filePath(resultId), { force: true }).catch(() => undefined);
        throw error;
      }
      await Promise.all(orphanedResultIds.map((id) => rm(this.filePath(id), { force: true }).catch(() => undefined)));
      return { locallyTruncated };
    });
  }

  async read(threadId: string, resultId: string, offset: number, limit: number): Promise<StoredToolResultPage | null> {
    await this.mutationQueue;
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    const safeResultId = assertSafeRuntimeId(resultId, 'Tool result id');
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) return null;
    const index = await this.readIndex();
    const record = index.results.find((item) => item.resultId === safeResultId);
    if (!record || !record.threadIds.includes(safeThreadId)) return null;

    const buffer = await readFile(this.filePath(safeResultId)).catch(() => null);
    if (!buffer) return null;
    if (offset >= buffer.length) return { content: '', nextOffset: null, totalBytes: buffer.length };

    const start = utf8CharStart(buffer, offset);
    let end = utf8CharEnd(buffer, Math.min(buffer.length, start + limit));
    if (end <= start && start < buffer.length) {
      // A caller may request fewer bytes than the next UTF-8 code point. Allow
      // that one code point through so returned nextOffset always makes progress
      // and page-by-page recovery never drops data or loops forever.
      end = nextUtf8CharacterEnd(buffer, start);
    }
    const content = buffer.subarray(start, end).toString('utf8');
    return {
      content,
      nextOffset: end < buffer.length ? end : null,
      totalBytes: buffer.length,
    };
  }

  retainForThread(input: RetainStoredToolResultsInput): Promise<RetainStoredToolResultsResult> {
    return this.enqueueMutation(async () => {
      const sourceThreadId = assertSafeRuntimeId(input.sourceThreadId, 'Source thread id');
      const destinationThreadId = assertSafeRuntimeId(input.destinationThreadId, 'Destination thread id');
      const ids = [...new Set(input.resultIds.map((id) => assertSafeRuntimeId(id, 'Tool result id')))];
      if (!ids.length) return { retainedResultIds: [], unavailableResultIds: [] };
      const index = await this.readIndex();
      const recordsById = new Map(index.results.map((record) => [record.resultId, record]));
      const unavailableResultIds: string[] = [];
      const records = ids.flatMap((id) => {
        const record = recordsById.get(id);
        if (!record?.threadIds.includes(sourceThreadId)) {
          unavailableResultIds.push(id);
          return [];
        }
        return [record];
      });
      let changed = false;
      for (const record of records) {
        if (!record.threadIds.includes(destinationThreadId)) {
          record.threadIds.push(destinationThreadId);
          changed = true;
        }
      }
      if (changed) await this.writeIndex(index);
      return {
        retainedResultIds: records.map((record) => record.resultId),
        unavailableResultIds,
      };
    });
  }

  releaseThread(threadId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
      const index = await this.readIndex();
      const removedIds: string[] = [];
      const results = index.results.flatMap((record) => {
        if (!record.threadIds.includes(safeThreadId)) return [record];
        const threadIds = record.threadIds.filter((id) => id !== safeThreadId);
        if (threadIds.length) return [{ ...record, threadIds }];
        removedIds.push(record.resultId);
        return [];
      });
      await this.writeIndex({ version: 1, results });
      await Promise.all(removedIds.map((id) => rm(this.filePath(id), { force: true }).catch(() => undefined)));
    });
  }

  async recover(validThreadIds: string[]): Promise<void> {
    const validThreads = new Set(validThreadIds.map((id) => assertSafeRuntimeId(id, 'Thread id')));
    await this.enqueueMutation(async () => {
      await mkdir(this.filesRoot, { recursive: true });
      const index = await this.readIndex();
      const removedIds: string[] = [];
      const results = index.results.flatMap((record) => {
        const threadIds = record.threadIds.filter((id) => validThreads.has(id));
        if (!threadIds.length) {
          removedIds.push(record.resultId);
          return [];
        }
        return [{ ...record, threadIds }];
      });
      await this.writeIndex({ version: 1, results });
      await Promise.all(removedIds.map((id) => rm(this.filePath(id), { force: true }).catch(() => undefined)));

      const retainedIds = new Set(results.map((record) => record.resultId));
      const files = await readdir(this.filesRoot, { withFileTypes: true });
      const orphanFiles = files
        .filter((entry) => entry.isFile() && !retainedIds.has(entry.name))
        .map((entry) => entry.name)
        // readdir 名称进入删除前仍需显式范围校验。
        .filter((name) => {
          const candidate = path.resolve(this.filesRoot, name);
          return path.dirname(candidate) === path.resolve(this.filesRoot);
        });
      await Promise.all(orphanFiles.map((name) => rm(path.join(this.filesRoot, name), { force: true }).catch(() => undefined)));
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private readIndex(): Promise<ToolResultIndex> {
    return readJsonFile(this.indexPath, EMPTY_INDEX).then(normalizeIndex);
  }

  private writeIndex(index: ToolResultIndex): Promise<void> {
    return writeJsonFile(this.indexPath, index, { mode: 0o600 });
  }

  private filePath(resultId: string): string {
    return path.join(this.filesRoot, assertSafeRuntimeId(resultId, 'Tool result id'));
  }
}

function createdAtMs(record: StoredToolResultRecord): number {
  const parsed = Date.parse(record.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIndex(value: ToolResultIndex): ToolResultIndex {
  if (!value || value.version !== 1 || !Array.isArray(value.results)) return EMPTY_INDEX;
  const results = value.results.flatMap<StoredToolResultRecord>((record) => {
    if (!record || typeof record !== 'object') return [];
    try {
      const resultId = assertSafeRuntimeId(String(record.resultId ?? ''), 'Tool result id');
      if (typeof record.toolName !== 'string' || typeof record.createdAt !== 'string') return [];
      const threadIds = Array.isArray(record.threadIds)
        ? [...new Set(record.threadIds.flatMap((threadId) => {
            try {
              return [assertSafeRuntimeId(String(threadId), 'Thread id')];
            } catch {
              return [];
            }
          }))]
        : [];
      if (!threadIds.length) return [];
      return [{
        resultId,
        threadIds,
        toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : '',
        toolName: record.toolName,
        originalEstimatedTokens: finiteNonNegative(record.originalEstimatedTokens),
        visibleTokenLimit: finiteNonNegative(record.visibleTokenLimit),
        locallyTruncated: record.locallyTruncated === true,
        sizeBytes: finiteNonNegative(record.sizeBytes),
        createdAt: record.createdAt,
      } satisfies StoredToolResultRecord];
    } catch {
      return [];
    }
  });
  return { version: 1, results };
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function nextUtf8CharacterEnd(buffer: Buffer, start: number): number {
  const firstByte = buffer[start] ?? 0;
  const width = firstByte < 0x80
    ? 1
    : firstByte < 0xe0
      ? 2
      : firstByte < 0xf0
        ? 3
        : 4;
  return Math.min(buffer.length, start + width);
}
