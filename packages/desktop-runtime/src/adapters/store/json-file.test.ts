import { beforeEach, describe, expect, it, vi } from 'vitest';

const { renameMock } = vi.hoisted(() => ({
  renameMock: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: renameMock };
});

import { renameWithRetry } from './json-file.js';

describe('renameWithRetry', () => {
  beforeEach(() => {
    renameMock.mockReset();
  });

  it('retries a transient file-handle error before completing the atomic move', async () => {
    renameMock
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockResolvedValueOnce(undefined);

    await expect(renameWithRetry('staging', 'installed', { platform: 'win32' })).resolves.toBeUndefined();

    expect(renameMock).toHaveBeenCalledTimes(2);
    expect(renameMock).toHaveBeenNthCalledWith(1, 'staging', 'installed');
    expect(renameMock).toHaveBeenNthCalledWith(2, 'staging', 'installed');
  });

  it('does not retry a permanent path error', async () => {
    renameMock.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    await expect(renameWithRetry('missing', 'installed', { platform: 'win32' })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(renameMock).toHaveBeenCalledTimes(1);
  });
});
