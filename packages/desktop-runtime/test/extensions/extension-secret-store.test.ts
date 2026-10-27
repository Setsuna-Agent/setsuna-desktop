import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimePluginUiFieldNode } from '@setsuna-desktop/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionSecretStore } from '../../src/extensions/extension-secret-store.js';
import { FileExtensionStateStore } from '../../src/extensions/file-extension-state-store.js';

const fields: RuntimePluginUiFieldNode[] = ['apiKey', 'token'].map((name) => ({ type: 'field', name, label: name, secret: true }));

describe('Plugin credential persistence', () => {
  let root: string;
  let state: FileExtensionStateStore;
  let entries: Map<string, string>;
  let vault: { get: ReturnType<typeof vi.fn<(key: string) => Promise<string | undefined>>>;
    set: ReturnType<typeof vi.fn<(key: string, value: string) => Promise<void>>>;
    delete: ReturnType<typeof vi.fn<(key: string) => Promise<void>>> };
  let secrets: ExtensionSecretStore;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'setsuna-plugin-secrets-'));
    state = new FileExtensionStateStore(root);
    entries = new Map();
    vault = {
      get: vi.fn(async (key: string) => entries.get(key)),
      set: vi.fn(async (key: string, value: string) => { entries.set(key, value); }),
      delete: vi.fn(async (key: string) => { entries.delete(key); }),
    };
    secrets = new ExtensionSecretStore(state, vault);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('keeps plaintext out of Plugin state, survives restart, and serializes edits without crossing plugins', async () => {
    await Promise.all([
      secrets.apply('search', fields, { apiKey: 'sk-private-a' }),
      secrets.apply('search', fields, { token: 'sk-private-b' }),
      secrets.apply('other', fields, { apiKey: 'sk-private-other' }),
    ]);
    const persisted = await readFile(path.join(root, 'extension-state.json'), 'utf8');
    expect(persisted).not.toContain('sk-private');
    const restarted = new ExtensionSecretStore(new FileExtensionStateStore(root), vault);
    await expect(restarted.get('search', 'apiKey')).resolves.toBe('sk-private-a');
    await expect(restarted.get('search', 'token')).resolves.toBe('sk-private-b');
    await expect(restarted.configured('search', fields)).resolves.toEqual(['apiKey', 'token']);
    await restarted.apply('search', fields, { apiKey: '' });
    await expect(restarted.get('search', 'apiKey')).resolves.toBe('sk-private-a');
    await restarted.apply('search', fields, { apiKey: 'sk-replacement', token: null });
    await expect(restarted.configured('search', fields)).resolves.toEqual(['apiKey']);
    await restarted.deletePlugin('search');
    await expect(restarted.get('search', 'apiKey')).resolves.toBeUndefined();
    await expect(restarted.get('other', 'apiKey')).resolves.toBe('sk-private-other');
    expect(entries.size).toBe(1);
    await restarted.apply('search', fields, { apiKey: 'new-install' });
    await expect(restarted.get('search', 'token')).resolves.toBeUndefined();
  });

  it('does not touch the vault on construction or unused-plugin cleanup and never falls back after a vault failure', async () => {
    expect(vault.get).not.toHaveBeenCalled();
    await secrets.deletePlugin('no-credentials');
    expect(vault.delete).not.toHaveBeenCalled();
    vault.set.mockRejectedValueOnce(new Error('Vault locked'));
    await expect(secrets.apply('search', fields, { apiKey: 'must-not-persist' })).rejects.toThrow('Vault locked');
    await expect(secrets.get('search', 'apiKey')).resolves.toBeUndefined();
    expect(entries.size).toBe(0);
    await secrets.apply('search', fields, { apiKey: 'retry-succeeds' });
    await expect(secrets.get('search', 'apiKey')).resolves.toBe('retry-succeeds');
    expect(await readFile(path.join(root, 'extension-state.json'), 'utf8')).not.toContain('must-not-persist');
  });

  it('rejects undeclared, oversized, missing-required and cancelled changes without altering a saved key', async () => {
    const required: RuntimePluginUiFieldNode[] = [{ ...fields[0], required: true, maxLength: 12 }];
    await secrets.apply('search', required, { apiKey: 'original' });
    await expect(secrets.apply('search', required, { token: 'wrong-field' })).rejects.toThrow('Invalid');
    await expect(secrets.apply('search', required, { apiKey: 'x'.repeat(13) })).rejects.toThrow('Invalid');
    await expect(secrets.apply('search', required, { apiKey: null })).rejects.toThrow('required');
    await expect(secrets.apply('search', required, { apiKey: 'cancelled' }, AbortSignal.abort())).rejects.toThrow();
    await expect(secrets.get('search', 'apiKey')).resolves.toBe('original');
    expect(vault.set).toHaveBeenCalledTimes(1);
  });

  it('restores credentials when reference deletion fails and reports an unsuccessful rollback', async () => {
    await secrets.apply('search', fields, { apiKey: 'keep-api-key', token: 'keep-token' });
    const stateError = new Error('State file locked');
    const removeReference = vi.spyOn(state, 'delete').mockRejectedValueOnce(stateError);
    await expect(secrets.deletePlugin('search')).rejects.toBe(stateError);
    await expect(secrets.get('search', 'apiKey')).resolves.toBe('keep-api-key');
    await expect(secrets.get('search', 'token')).resolves.toBe('keep-token');

    const vaultError = new Error('Vault unavailable during rollback');
    removeReference.mockRejectedValueOnce(stateError);
    vault.set.mockRejectedValueOnce(vaultError);
    await expect(secrets.deletePlugin('search')).rejects.toMatchObject({
      message: 'Plugin credential removal failed and rollback was incomplete.',
      errors: [stateError, vaultError],
    });
  });

  it('clears ordinary state without accessing the vault when no credentials were configured', async () => {
    await state.set('plain-plugin', 'global', 'settings', { city: 'Hangzhou' });
    await secrets.deletePlugin('plain-plugin', () => state.deletePlugin('plain-plugin'));
    await expect(state.get('plain-plugin', 'global', 'settings')).resolves.toBeUndefined();
    expect(vault.get).not.toHaveBeenCalled();
    expect(vault.delete).not.toHaveBeenCalled();
  });
});
