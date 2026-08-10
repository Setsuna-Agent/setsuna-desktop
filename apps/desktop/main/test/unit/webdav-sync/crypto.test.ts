import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decryptWebDavBuffer,
  decryptWebDavFile,
  encryptWebDavBuffer,
  encryptWebDavFile,
  generateWebDavRecoveryKey,
  normalizeWebDavRecoveryKey,
  verifyWebDavRepositoryKey,
  webDavRepositoryKeyVerifier,
} from '../../../src/webdav-sync/crypto.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WebDAV sync encryption', () => {
  it('round-trips buffers and rejects the wrong key, AAD, and tampering', () => {
    const key = generateWebDavRecoveryKey();
    const payload = Buffer.from('model-api-key-value', 'utf8');
    const encrypted = encryptWebDavBuffer(payload, key, 'repo/snapshot/key');

    expect(encrypted).not.toContain(payload);
    expect(decryptWebDavBuffer(encrypted, key, 'repo/snapshot/key')).toEqual(payload);
    expect(() => decryptWebDavBuffer(encrypted, generateWebDavRecoveryKey(), 'repo/snapshot/key'))
      .toThrow('无法解密');
    expect(() => decryptWebDavBuffer(encrypted, key, 'different-aad')).toThrow('无法解密');
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptWebDavBuffer(tampered, key, 'repo/snapshot/key')).toThrow('无法解密');
  });

  it('streams files and verifies the repository key without persisting plaintext', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-crypto-'));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, 'source.bin');
    const encryptedPath = path.join(root, 'encrypted.bin');
    const restoredPath = path.join(root, 'restored.bin');
    const payload = Buffer.alloc(2 * 1024 * 1024 + 7, 0x5a);
    await writeFile(sourcePath, payload);
    const key = generateWebDavRecoveryKey();

    const encrypted = await encryptWebDavFile({
      sourcePath,
      destinationPath: encryptedPath,
      recoveryKey: key,
      aad: 'file-aad',
    });
    const restored = await decryptWebDavFile({
      sourcePath: encryptedPath,
      destinationPath: restoredPath,
      recoveryKey: key,
      aad: 'file-aad',
      mode: 0o700,
    });

    expect(restored).toEqual(encrypted);
    expect(await readFile(restoredPath)).toEqual(payload);
    if (process.platform !== 'win32') {
      expect((await stat(restoredPath)).mode & 0o777).toBe(0o700);
    }
    expect(await readFile(encryptedPath)).not.toContain(Buffer.from('model-api-key-value'));
    const verifier = webDavRepositoryKeyVerifier(key, 'repo-id');
    expect(verifyWebDavRepositoryKey(key, 'repo-id', verifier)).toBe(true);
    expect(verifyWebDavRepositoryKey(generateWebDavRecoveryKey(), 'repo-id', verifier)).toBe(false);
  }, 30_000);

  it('accepts only canonical 256-bit recovery keys', () => {
    const key = generateWebDavRecoveryKey();
    expect(normalizeWebDavRecoveryKey(` ${key} `)).toBe(key);
    expect(() => normalizeWebDavRecoveryKey('setsuna-v1-short')).toThrow('恢复密钥格式无效');
    expect(() => normalizeWebDavRecoveryKey(key.replace('setsuna-v1-', 'other-'))).toThrow('恢复密钥格式无效');
  });

  it('round-trips an authenticated empty file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-empty-'));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, 'empty.bin');
    const encryptedPath = path.join(root, 'empty.enc');
    const restoredPath = path.join(root, 'restored.bin');
    const key = generateWebDavRecoveryKey();
    await writeFile(sourcePath, Buffer.alloc(0));

    const encrypted = await encryptWebDavFile({
      sourcePath,
      destinationPath: encryptedPath,
      recoveryKey: key,
      aad: 'empty-file-aad',
    });
    const restored = await decryptWebDavFile({
      sourcePath: encryptedPath,
      destinationPath: restoredPath,
      recoveryKey: key,
      aad: 'empty-file-aad',
    });

    expect(restored).toEqual(encrypted);
    expect(await readFile(restoredPath)).toHaveLength(0);
  });
});
