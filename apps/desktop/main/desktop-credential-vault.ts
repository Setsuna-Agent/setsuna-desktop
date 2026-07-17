import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VAULT_VERSION = 1;
const MAX_CREDENTIAL_KEY_LENGTH = 256;
const CREDENTIAL_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/u;

type StoredCredentialVault = {
  version: number;
  entries: Record<string, string>;
};

export type CredentialEncryptionProvider = {
  backend(): string;
  isAvailable(): Promise<boolean>;
  encrypt(plainText: string): Promise<Buffer>;
  decrypt(encrypted: Buffer): Promise<string>;
};

export type CredentialVaultStatus = {
  available: boolean;
  backend: string;
};

export interface CredentialVault {
  status(): Promise<CredentialVaultStatus>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * 磁盘上只保存经操作系统加密的数据块。Electron 的 safeStorage 提供方
 * 由主进程注入，确保 runtime 子进程永远不会获得平台密钥。
 */
export class DesktopCredentialVault implements CredentialVault {
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly encryption: CredentialEncryptionProvider,
  ) {}

  async status(): Promise<CredentialVaultStatus> {
    return {
      available: await this.encryption.isAvailable(),
      backend: this.encryption.backend(),
    };
  }

  async get(keyInput: string): Promise<string | undefined> {
    const key = normalizeCredentialKey(keyInput);
    await this.assertAvailable();
    const vault = await this.readVault();
    const encoded = vault.entries[key];
    if (!encoded) return undefined;
    try {
      return await this.encryption.decrypt(Buffer.from(encoded, 'base64'));
    } catch (error) {
      throw new Error(`Unable to decrypt credential '${key}'.`, { cause: error });
    }
  }

  async set(keyInput: string, value: string): Promise<void> {
    const key = normalizeCredentialKey(keyInput);
    if (typeof value !== 'string') throw new Error('Credential value must be a string.');
    await this.assertAvailable();
    await this.enqueueUpdate(async () => {
      const vault = await this.readVault();
      const encrypted = await this.encryption.encrypt(value);
      vault.entries[key] = encrypted.toString('base64');
      await this.writeVault(vault);
    });
  }

  async delete(keyInput: string): Promise<void> {
    const key = normalizeCredentialKey(keyInput);
    await this.assertAvailable();
    await this.enqueueUpdate(async () => {
      const vault = await this.readVault();
      if (!(key in vault.entries)) return;
      delete vault.entries[key];
      await this.writeVault(vault);
    });
  }

  private async assertAvailable(): Promise<void> {
    if (await this.encryption.isAvailable()) return;
    throw new Error(`Secure credential storage is unavailable (backend: ${this.encryption.backend()}).`);
  }

  private async enqueueUpdate(update: () => Promise<void>): Promise<void> {
    const run = this.updateQueue.then(update, update);
    this.updateQueue = run.catch(() => undefined);
    await run;
  }

  private async readVault(): Promise<StoredCredentialVault> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<StoredCredentialVault>;
      if (parsed.version !== VAULT_VERSION || !isStringRecord(parsed.entries)) {
        throw new Error('Unsupported credential vault format.');
      }
      return { version: VAULT_VERSION, entries: parsed.entries };
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { version: VAULT_VERSION, entries: {} };
      }
      throw error;
    }
  }

  private async writeVault(vault: StoredCredentialVault): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(vault, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      await rename(tempPath, this.filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function normalizeCredentialKey(value: string): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > MAX_CREDENTIAL_KEY_LENGTH || !CREDENTIAL_KEY_PATTERN.test(key)) {
    throw new Error('Credential key contains unsupported characters.');
  }
  return key;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, item]) => CREDENTIAL_KEY_PATTERN.test(key) && typeof item === 'string'));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
