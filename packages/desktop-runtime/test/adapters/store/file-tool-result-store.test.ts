import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileToolResultStore } from '../../../src/adapters/store/file-tool-result-store.js';
import { createTestTempDirectory } from '../../support/test-temp-directory.js';

const SAMPLE = (index: number): string => `line-${index} `.repeat(100).trim();

describe('file tool result store', () => {
  it('saves, paginates, and authorizes reads per thread', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-');
    const store = new FileToolResultStore(dataDir);
    // 每块 6 字节(5 字符 + 1 换行);40 块 = 240 字节,字节偏移可预测。
    const content = Array.from({ length: 40 }, (_, index) => `${String(index).padStart(2, '0')}abc\n`).join('');
    await store.save({
      resultId: 'tool_result_1',
      threadId: 'thread_1',
      toolCallId: 'call_1',
      toolName: 'run_shell_command',
      fullText: content,
      originalEstimatedTokens: 20,
      visibleTokenLimit: 8_000,
      locallyTruncated: false,
    });
    const totalBytes = Buffer.byteLength(content, 'utf8');
    expect(totalBytes).toBe(240);

    const first = await store.read('thread_1', 'tool_result_1', 0, 12);
    expect(first).not.toBeNull();
    expect(first!.content).toBe('00abc\n01abc\n');
    expect(first!.nextOffset).toBe(12);
    expect(first!.totalBytes).toBe(totalBytes);

    const second = await store.read('thread_1', 'tool_result_1', 12, 12);
    expect(second!.content).toBe('02abc\n03abc\n');
    expect(second!.nextOffset).toBe(24);

    // 最后一页:剩余 4 行(24 字节),next_offset 为 end(null)。
    const last = await store.read('thread_1', 'tool_result_1', totalBytes - 24, 1_000);
    expect(last!.content).toBe('36abc\n37abc\n38abc\n39abc\n');
    expect(last!.nextOffset).toBeNull();

    // 其他 thread 即使猜中 result_id 也不能读取。
    await expect(store.read('thread_2', 'tool_result_1', 0, 12)).resolves.toBeNull();
    await expect(store.read('thread_1', 'tool_result_1', 999_999, 12)).resolves.toEqual({
      content: '',
      nextOffset: null,
      totalBytes,
    });
  });

  it('clips a single oversized result at the hard cap and reports locallyTruncated', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-cap-');
    const store = new FileToolResultStore(dataDir, 1_024, 64 * 1_024);
    const content = 'z'.repeat(4_096);
    const saved = await store.save({
      resultId: 'tool_result_big',
      threadId: 'thread_1',
      toolCallId: 'call_1',
      toolName: 'browser_snapshot',
      fullText: content,
      originalEstimatedTokens: 1_024,
      visibleTokenLimit: 4_000,
      locallyTruncated: false,
    });
    expect(saved.locallyTruncated).toBe(true);
    const page = await store.read('thread_1', 'tool_result_big', 0, 1_024);
    expect(page!.totalBytes).toBeLessThanOrEqual(1_024);
    expect(page!.content).toBe('z'.repeat(1_024));
  });

  it('never splits a UTF-8 character when clipping at the hard cap', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-cap-utf8-');
    const store = new FileToolResultStore(dataDir, 1_000, 64 * 1_024);
    // 每字 3 字节;1_000 字节的裁剪点必然落在一个中文字符中间。
    await store.save({
      resultId: 'tool_result_utf8',
      threadId: 'thread_1',
      toolCallId: 'call_1',
      toolName: 'run_shell_command',
      fullText: '汉'.repeat(1_000),
      originalEstimatedTokens: 750,
      visibleTokenLimit: 8_000,
      locallyTruncated: false,
    });
    const page = await store.read('thread_1', 'tool_result_utf8', 0, 2_000);
    expect(page!.totalBytes % 3).toBe(0);
    expect(page!.content.includes('\uFFFD')).toBe(false);
  });

  it('always advances pagination when the requested limit is smaller than a UTF-8 character', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-page-utf8-');
    const store = new FileToolResultStore(dataDir);
    const content = '汉字🙂';
    await store.save({
      resultId: 'tool_result_page_utf8',
      threadId: 'thread_1',
      toolCallId: 'call_1',
      toolName: 'read_file',
      fullText: content,
      originalEstimatedTokens: 3,
      visibleTokenLimit: 10_000,
      locallyTruncated: false,
    });

    const pages: string[] = [];
    let offset = 0;
    const totalBytes = Buffer.byteLength(content, 'utf8');
    while (offset < totalBytes) {
      const page = await store.read('thread_1', 'tool_result_page_utf8', offset, 1);
      expect(page).not.toBeNull();
      pages.push(page!.content);
      if (page!.nextOffset === null) break;
      expect(page!.nextOffset).toBeGreaterThan(offset);
      offset = page!.nextOffset;
    }

    expect(pages.join('')).toBe(content);
  });

  it('evicts the oldest results when the thread quota is exceeded', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-quota-');
    const store = new FileToolResultStore(dataDir, 1_024, 2_048);
    for (const index of [1, 2, 3]) {
      await store.save({
        resultId: `tool_result_quota_${index}`,
        threadId: 'thread_1',
        toolCallId: `call_${index}`,
        toolName: 'run_shell_command',
        fullText: 'q'.repeat(1_024),
        originalEstimatedTokens: 256,
        visibleTokenLimit: 8_000,
        locallyTruncated: false,
      });
    }
    await expect(store.read('thread_1', 'tool_result_quota_1', 0, 1_024)).resolves.toBeNull();
    await expect(store.read('thread_1', 'tool_result_quota_2', 0, 1_024)).resolves.not.toBeNull();
    await expect(store.read('thread_1', 'tool_result_quota_3', 0, 1_024)).resolves.not.toBeNull();
  });

  it('retains results for fork threads and releases per-thread references', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-retain-');
    const store = new FileToolResultStore(dataDir);
    await store.save({
      resultId: 'tool_result_fork',
      threadId: 'thread_parent',
      toolCallId: 'call_1',
      toolName: 'read_file',
      fullText: SAMPLE(1),
      originalEstimatedTokens: 25,
      visibleTokenLimit: 10_000,
      locallyTruncated: false,
    });

    await expect(store.retainForThread({
      sourceThreadId: 'thread_parent',
      destinationThreadId: 'thread_child',
      resultIds: ['tool_result_fork'],
    })).resolves.toEqual({
      retainedResultIds: ['tool_result_fork'],
      unavailableResultIds: [],
    });
    await expect(store.read('thread_child', 'tool_result_fork', 0, 100)).resolves.not.toBeNull();

    // 父线程释放后,子线程引用仍保留结果。
    await store.releaseThread('thread_parent');
    await expect(store.read('thread_child', 'tool_result_fork', 0, 100)).resolves.not.toBeNull();
    await store.releaseThread('thread_child');
    await expect(store.read('thread_child', 'tool_result_fork', 0, 100)).resolves.toBeNull();
  });

  it('retains available results and reports missing references', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-retain-missing-');
    const store = new FileToolResultStore(dataDir);
    await store.save({
      resultId: 'tool_result_existing',
      threadId: 'thread_parent',
      toolCallId: 'call_1',
      toolName: 'read_file',
      fullText: SAMPLE(1),
      originalEstimatedTokens: 25,
      visibleTokenLimit: 10_000,
      locallyTruncated: false,
    });

    await expect(store.retainForThread({
      sourceThreadId: 'thread_parent',
      destinationThreadId: 'thread_child',
      resultIds: ['tool_result_existing', 'tool_result_missing'],
    })).resolves.toEqual({
      retainedResultIds: ['tool_result_existing'],
      unavailableResultIds: ['tool_result_missing'],
    });
    await expect(store.read('thread_child', 'tool_result_existing', 0, 100)).resolves.not.toBeNull();
    await expect(store.read('thread_parent', 'tool_result_existing', 0, 100)).resolves.not.toBeNull();
  });

  it('keeps fork ownership after parent eviction without letting the parent regrant access', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-shared-quota-');
    const store = new FileToolResultStore(dataDir, 1_024, 2_048);
    await store.save({
      resultId: 'tool_result_01_shared',
      threadId: 'thread_parent',
      toolCallId: 'call_1',
      toolName: 'read_file',
      fullText: 'a'.repeat(1_024),
      originalEstimatedTokens: 256,
      visibleTokenLimit: 10_000,
      locallyTruncated: false,
    });
    await store.retainForThread({
      sourceThreadId: 'thread_parent',
      destinationThreadId: 'thread_child',
      resultIds: ['tool_result_01_shared'],
    });
    for (const index of [2, 3]) {
      await store.save({
        resultId: `tool_result_0${index}`,
        threadId: 'thread_parent',
        toolCallId: `call_${index}`,
        toolName: 'read_file',
        fullText: String(index).repeat(1_024),
        originalEstimatedTokens: 256,
        visibleTokenLimit: 10_000,
        locallyTruncated: false,
      });
    }

    await expect(store.read('thread_parent', 'tool_result_01_shared', 0, 16)).resolves.toBeNull();
    await expect(store.read('thread_child', 'tool_result_01_shared', 0, 16)).resolves.toMatchObject({
      content: 'a'.repeat(16),
    });
    await expect(store.retainForThread({
      sourceThreadId: 'thread_parent',
      destinationThreadId: 'thread_second_child',
      resultIds: ['tool_result_01_shared'],
    })).resolves.toEqual({
      retainedResultIds: [],
      unavailableResultIds: ['tool_result_01_shared'],
    });
    await expect(store.read('thread_second_child', 'tool_result_01_shared', 0, 16)).resolves.toBeNull();
  });

  it('recovers orphan results and files after startup', async () => {
    const dataDir = await createTestTempDirectory('tool-result-store-recover-');
    const store = new FileToolResultStore(dataDir);
    await store.save({
      resultId: 'tool_result_alive',
      threadId: 'thread_alive',
      toolCallId: 'call_1',
      toolName: 'run_shell_command',
      fullText: SAMPLE(2),
      originalEstimatedTokens: 25,
      visibleTokenLimit: 8_000,
      locallyTruncated: false,
    });
    await store.save({
      resultId: 'tool_result_dead',
      threadId: 'thread_dead',
      toolCallId: 'call_2',
      toolName: 'run_shell_command',
      fullText: SAMPLE(3),
      originalEstimatedTokens: 25,
      visibleTokenLimit: 8_000,
      locallyTruncated: false,
    });
    // 额外放置一个索引外的孤儿文件。
    const filesRoot = path.join(dataDir, 'tool-results', 'files');
    await writeFile(path.join(filesRoot, 'tool_result_orphan'), 'orphan', { flag: 'a' });

    await store.recover(['thread_alive']);

    await expect(store.read('thread_alive', 'tool_result_alive', 0, 100)).resolves.not.toBeNull();
    await expect(store.read('thread_alive', 'tool_result_dead', 0, 100)).resolves.toBeNull();
    await expect(readFile(path.join(filesRoot, 'tool_result_orphan'))).rejects.toThrow();
  });
});
