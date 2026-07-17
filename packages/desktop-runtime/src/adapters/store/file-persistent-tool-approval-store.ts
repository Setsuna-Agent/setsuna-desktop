import path from 'node:path';
import type { McpStore } from '../../ports/mcp-store.js';
import type { PersistentToolApprovalStore } from '../../ports/persistent-tool-approval-store.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

type StoredPersistentToolApprovals = {
  approvalKeys?: unknown;
};

const approvalWriteQueues = new Map<string, Promise<void>>();

export class FilePersistentToolApprovalStore implements PersistentToolApprovalStore {
  readonly approvalsPath: string;

  constructor(dataDir: string, private readonly mcpStore?: Pick<McpStore, 'setToolApprovalMode'>) {
    this.approvalsPath = path.join(dataDir, 'tool-approvals.json');
  }

  async hasAll(keys: string[]): Promise<boolean> {
    const normalized = normalizeApprovalKeys(keys);
    if (!normalized.length) return false;
    const approved = new Set(await this.listApprovalKeys());
    return normalized.every((key) => approved.has(key));
  }

  async approve(keys: string[]): Promise<void> {
    const normalized = normalizeApprovalKeys(keys);
    if (!normalized.length) return;
    await withApprovalWriteQueue(this.approvalsPath, async () => {
      const merged = [...new Set([...(await this.listApprovalKeys()), ...normalized])].sort((left, right) => left.localeCompare(right));
      await writeJsonFile(this.approvalsPath, { approvalKeys: merged });
    });
    await this.persistMcpToolApprovals(normalized);
  }

  private async listApprovalKeys(): Promise<string[]> {
    const stored = await readJsonFile<StoredPersistentToolApprovals>(this.approvalsPath, { approvalKeys: [] });
    return normalizeApprovalKeys(stored.approvalKeys);
  }

  private async persistMcpToolApprovals(keys: string[]): Promise<void> {
    if (!this.mcpStore) return;
    await Promise.all(keys.map(async (key) => {
      const parsed = parseMcpApprovalKey(key);
      if (!parsed) return;
      // 审批键文件仍是持久化回退；MCP 配置回写仅作尽力尝试，避免过期或已删除的服务器
      // 导致获批工具运行失败。
      await this.mcpStore?.setToolApprovalMode(parsed.serverKey, parsed.toolName, 'approve').catch(() => undefined);
    }));
  }
}

function normalizeApprovalKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))];
}

function parseMcpApprovalKey(key: string): { serverKey: string; toolName: string } | null {
  const match = key.match(/^mcp:([^:]+):(.+)$/);
  if (!match?.[1] || !match[2]) return null;
  return { serverKey: match[1], toolName: match[2] };
}

async function withApprovalWriteQueue<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = approvalWriteQueues.get(filePath) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);
  approvalWriteQueues.set(filePath, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (approvalWriteQueues.get(filePath) === queued) approvalWriteQueues.delete(filePath);
  }
}
