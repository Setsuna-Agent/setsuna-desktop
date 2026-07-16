import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileMcpStore } from './file-mcp-store.js';
import { InMemorySecretStore } from './in-memory-secret-store.js';
import { FilePersistentToolApprovalStore } from './file-persistent-tool-approval-store.js';

describe('file persistent tool approval store', () => {
  it('persists normalized approval keys', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-tool-approval-store-test-'));
    const store = new FilePersistentToolApprovalStore(dataDir);

    await expect(store.hasAll(['mcp:docs:write'])).resolves.toBe(false);
    await store.approve([' mcp:docs:write ', '', 'mcp:docs:write', 'mcp:docs:delete']);

    await expect(store.hasAll(['mcp:docs:write'])).resolves.toBe(true);
    await expect(store.hasAll(['mcp:docs:write', 'mcp:docs:delete'])).resolves.toBe(true);
    await expect(store.hasAll(['mcp:docs:missing'])).resolves.toBe(false);
    await expect(readFile(path.join(dataDir, 'tool-approvals.json'), 'utf8')).resolves.toContain('mcp:docs:delete');
  });

  it('writes MCP persistent approvals back to per-tool approval mode', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-tool-approval-store-test-'));
    const mcpStore = new FileMcpStore(dataDir, new InMemorySecretStore());
    await mcpStore.upsertServer({
      key: 'docs',
      transport: 'streamableHttp',
      url: 'https://example.com/mcp',
      tools: [{ name: 'write_note', approvalMode: 'prompt' }],
    });
    const store = new FilePersistentToolApprovalStore(dataDir, mcpStore);

    await store.approve(['mcp:docs:write_note']);

    await expect(mcpStore.listServers()).resolves.toMatchObject({
      servers: [{
        key: 'docs',
        tools: [expect.objectContaining({ name: 'write_note', approvalMode: 'approve' })],
      }],
    });
  });
});
