import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DesktopCredentialVault, type CredentialEncryptionProvider } from './desktop-credential-vault.js';

describe('DesktopCredentialVault', () => {
  it('serializes encrypted updates without writing plaintext credentials', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-credential-vault-test-'));
    const filePath = path.join(dataDir, 'secure-credentials.json');
    const vault = new DesktopCredentialVault(filePath, testEncryption());

    await Promise.all([
      vault.set('mcp.server.alpha.token', 'alpha-secret'),
      vault.set('mcp.server.beta.token', 'beta-secret'),
    ]);

    await expect(vault.get('mcp.server.alpha.token')).resolves.toBe('alpha-secret');
    await expect(vault.get('mcp.server.beta.token')).resolves.toBe('beta-secret');
    const raw = await readFile(filePath, 'utf8');
    expect(raw).not.toContain('alpha-secret');
    expect(raw).not.toContain('beta-secret');
    if (process.platform !== 'win32') expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    await vault.delete('mcp.server.alpha.token');
    await expect(vault.get('mcp.server.alpha.token')).resolves.toBeUndefined();
  });

  it('fails closed when the OS credential backend is unavailable', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-credential-vault-test-'));
    const unavailable = testEncryption(false);
    const vault = new DesktopCredentialVault(path.join(dataDir, 'secure-credentials.json'), unavailable);

    await expect(vault.status()).resolves.toEqual({ available: false, backend: 'test' });
    await expect(vault.set('mcp.token', 'secret')).rejects.toThrow('Secure credential storage is unavailable');
  });
});

function testEncryption(available = true): CredentialEncryptionProvider {
  return {
    backend: () => 'test',
    isAvailable: async () => available,
    encrypt: async (plainText) => Buffer.from(`encrypted:${plainText}`, 'utf8'),
    decrypt: async (encrypted) => encrypted.toString('utf8').replace(/^encrypted:/u, ''),
  };
}
