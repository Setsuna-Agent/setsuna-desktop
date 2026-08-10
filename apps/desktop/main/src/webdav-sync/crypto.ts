import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { appendFile, mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const RECOVERY_KEY_PREFIX = 'setsuna-v1-';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_MAGIC = Buffer.from('SETSDAV1', 'ascii');
const ENVELOPE_HEADER_BYTES = ENVELOPE_MAGIC.byteLength + NONCE_BYTES;
export const WEB_DAV_ENCRYPTED_OBJECT_OVERHEAD_BYTES = ENVELOPE_HEADER_BYTES + AUTH_TAG_BYTES;

export function generateWebDavRecoveryKey(): string {
  return `${RECOVERY_KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;
}

export function normalizeWebDavRecoveryKey(value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith(RECOVERY_KEY_PREFIX)) {
    throw new Error('恢复密钥格式无效。');
  }
  const encoded = normalized.slice(RECOVERY_KEY_PREFIX.length);
  let key: Buffer;
  try {
    key = Buffer.from(encoded, 'base64url');
  } catch {
    throw new Error('恢复密钥格式无效。');
  }
  if (key.byteLength !== KEY_BYTES || key.toString('base64url') !== encoded) {
    throw new Error('恢复密钥格式无效。');
  }
  return `${RECOVERY_KEY_PREFIX}${encoded}`;
}

export function recoveryKeyBytes(value: string): Buffer {
  const normalized = normalizeWebDavRecoveryKey(value);
  return Buffer.from(normalized.slice(RECOVERY_KEY_PREFIX.length), 'base64url');
}

export function webDavRepositoryKeyVerifier(recoveryKey: string, repositoryId: string): string {
  return createHmac('sha256', recoveryKeyBytes(recoveryKey))
    .update(`setsuna-webdav-repository\0${repositoryId}`, 'utf8')
    .digest('base64url');
}

export function verifyWebDavRepositoryKey(
  recoveryKey: string,
  repositoryId: string,
  expected: string,
): boolean {
  const actual = Buffer.from(webDavRepositoryKeyVerifier(recoveryKey, repositoryId), 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actual.byteLength === expectedBytes.byteLength && timingSafeEqual(actual, expectedBytes);
}

export function webDavObjectAad(
  repositoryId: string,
  snapshotId: string,
  objectName: string,
): string {
  return `setsuna-webdav-object/v1\0${repositoryId}\0${snapshotId}\0${objectName}`;
}

export function encryptWebDavBuffer(data: Buffer, recoveryKey: string, aad: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', recoveryKeyBytes(recoveryKey), nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([ENVELOPE_MAGIC, nonce, encrypted, cipher.getAuthTag()]);
}

export function decryptWebDavBuffer(envelope: Buffer, recoveryKey: string, aad: string): Buffer {
  if (envelope.byteLength < ENVELOPE_HEADER_BYTES + AUTH_TAG_BYTES) {
    throw new Error('加密备份对象已损坏。');
  }
  const magic = envelope.subarray(0, ENVELOPE_MAGIC.byteLength);
  if (!magic.equals(ENVELOPE_MAGIC)) throw new Error('加密备份对象格式不受支持。');
  const nonce = envelope.subarray(ENVELOPE_MAGIC.byteLength, ENVELOPE_HEADER_BYTES);
  const authTag = envelope.subarray(envelope.byteLength - AUTH_TAG_BYTES);
  const encrypted = envelope.subarray(ENVELOPE_HEADER_BYTES, envelope.byteLength - AUTH_TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', recoveryKeyBytes(recoveryKey), nonce);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (error) {
    throw new Error('无法解密备份对象，请检查恢复密钥或远端数据完整性。', { cause: error });
  }
}

export async function encryptWebDavFile(input: {
  sourcePath: string;
  destinationPath: string;
  recoveryKey: string;
  aad: string;
  signal?: AbortSignal;
}): Promise<{ sha256: string; size: number }> {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', recoveryKeyBytes(input.recoveryKey), nonce);
  cipher.setAAD(Buffer.from(input.aad, 'utf8'));
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  await writeFile(input.destinationPath, Buffer.concat([ENVELOPE_MAGIC, nonce]), {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    await pipeline(
      createReadStream(input.sourcePath),
      meter,
      cipher,
      createWriteStream(input.destinationPath, { flags: 'a' }),
      input.signal ? { signal: input.signal } : {},
    );
    await appendFile(input.destinationPath, cipher.getAuthTag());
    return { sha256: hash.digest('hex'), size };
  } catch (error) {
    await rm(input.destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function decryptWebDavFile(input: {
  sourcePath: string;
  destinationPath: string;
  recoveryKey: string;
  aad: string;
  mode?: number;
  signal?: AbortSignal;
}): Promise<{ sha256: string; size: number }> {
  const sourceStat = await stat(input.sourcePath);
  if (!sourceStat.isFile() || sourceStat.size < ENVELOPE_HEADER_BYTES + AUTH_TAG_BYTES) {
    throw new Error('加密备份对象已损坏。');
  }
  const sourceHandle = await open(input.sourcePath, 'r');
  const header = Buffer.alloc(ENVELOPE_HEADER_BYTES);
  const authTag = Buffer.alloc(AUTH_TAG_BYTES);
  try {
    const headerRead = await sourceHandle.read(header, 0, header.byteLength, 0);
    const tagRead = await sourceHandle.read(
      authTag,
      0,
      authTag.byteLength,
      sourceStat.size - AUTH_TAG_BYTES,
    );
    if (headerRead.bytesRead !== header.byteLength || tagRead.bytesRead !== authTag.byteLength) {
      throw new Error('加密备份对象已损坏。');
    }
  } finally {
    await sourceHandle.close();
  }
  const magic = header.subarray(0, ENVELOPE_MAGIC.byteLength);
  if (!magic.equals(ENVELOPE_MAGIC)) throw new Error('加密备份对象格式不受支持。');
  const nonce = header.subarray(ENVELOPE_MAGIC.byteLength, ENVELOPE_HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', recoveryKeyBytes(input.recoveryKey), nonce);
  decipher.setAAD(Buffer.from(input.aad, 'utf8'));
  decipher.setAuthTag(authTag);
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await mkdir(path.dirname(input.destinationPath), { recursive: true });
  const encryptedBytes = sourceStat.size - ENVELOPE_HEADER_BYTES - AUTH_TAG_BYTES;
  if (encryptedBytes === 0) {
    try {
      const decrypted = decipher.final();
      await writeFile(input.destinationPath, decrypted, { flag: 'wx', mode: input.mode ?? 0o600 });
      return { sha256: sha256Buffer(decrypted), size: decrypted.byteLength };
    } catch (error) {
      await rm(input.destinationPath, { force: true }).catch(() => undefined);
      throw new Error('无法解密备份对象，请检查恢复密钥或远端数据完整性。', { cause: error });
    }
  }
  try {
    await pipeline(
      createReadStream(input.sourcePath, {
        start: ENVELOPE_HEADER_BYTES,
        end: sourceStat.size - AUTH_TAG_BYTES - 1,
      }),
      decipher,
      meter,
      createWriteStream(input.destinationPath, { flags: 'wx', mode: input.mode ?? 0o600 }),
      input.signal ? { signal: input.signal } : {},
    );
    return { sha256: hash.digest('hex'), size };
  } catch (error) {
    await rm(input.destinationPath, { force: true }).catch(() => undefined);
    throw new Error('无法解密备份对象，请检查恢复密钥或远端数据完整性。', { cause: error });
  }
}

export function sha256Buffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
