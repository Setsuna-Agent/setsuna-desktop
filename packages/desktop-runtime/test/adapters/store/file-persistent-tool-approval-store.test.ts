import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilePersistentToolApprovalStore } from '../../../src/adapters/store/file-persistent-tool-approval-store.js';

describe('file persistent tool approval store', () => {
  it('persists normalized approval keys', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-tool-approval-store-test-'));
    const store = new FilePersistentToolApprovalStore(dataDir);

    await expect(store.hasAll(['pc-local:write_file'])).resolves.toBe(false);
    await store.approve([' pc-local:write_file ', '', 'pc-local:write_file', 'pc-local:edit_file']);

    await expect(store.hasAll(['pc-local:write_file'])).resolves.toBe(true);
    await expect(store.hasAll(['pc-local:write_file', 'pc-local:edit_file'])).resolves.toBe(true);
    await expect(store.hasAll(['pc-local:missing'])).resolves.toBe(false);
    await expect(readFile(path.join(dataDir, 'tool-approvals.json'), 'utf8')).resolves.toContain('pc-local:edit_file');
  });
});
