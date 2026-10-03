import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerSettingsService } from '../../src/main/settings.js';
import type { ComputerCommand } from '../../src/contracts/index.js';
import { ComputerElevationCancelledError } from '../../src/main/backend.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const start: ComputerCommand = { kind: 'start', identity: { threadId: 't', turnId: 'u', unattended: false, readOnly: false, supportsImages: true } };
async function fixture(windows = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'computer-settings-'));
  directories.push(directory);
  const filePath = path.join(directory, 'computer-use.json');
  let authorized = false;
  const administrator = {
    isAuthorized: () => authorized,
    authorize: vi.fn(async (_signal: AbortSignal) => { authorized = true; }),
    revoke: vi.fn(async () => { authorized = false; }),
  };
  const control = { execute: vi.fn(async () => ({ kind: 'stopped' as const })), stop: vi.fn(async () => { await administrator.revoke(); }) };
  const write = vi.fn(async (file: string, value: unknown) => { await writeFile(file, JSON.stringify(value)); });
  const create = () => new ComputerSettingsService(filePath, control, write, () => ({ screen: 'granted', accessibility: 'granted' }), windows ? administrator : undefined);
  const settings = create(); await settings.load();
  return { settings, create, control, write, filePath, administrator };
}

describe('persistent desktop control setting', () => {
  it('defaults off, rejects direct commands and restores explicit choices across restarts', async () => {
    const f = await fixture();
    expect(await f.settings.isEnabled()).toBe(false);
    await expect(f.settings.execute(start)).rejects.toThrow('disabled');
    expect(f.control.execute).not.toHaveBeenCalled();
    await f.settings.execute({ ...start, kind: 'stop' });
    await expect(f.settings.setEnabled('true' as unknown as boolean)).rejects.toThrow('Invalid');
    await f.settings.setEnabled(true);
    const restarted = f.create(); await restarted.load();
    expect(await restarted.isEnabled()).toBe(true);
    await restarted.execute(start);
    await restarted.setEnabled(false);
    const disabled = f.create(); await disabled.load();
    expect(await disabled.isEnabled()).toBe(false);
  });

  it('revokes immediately while an earlier enable is still being persisted', async () => {
    const f = await fixture();
    let release!: () => void;
    const write = f.write.getMockImplementation()!;
    f.write.mockImplementationOnce(async (file, value) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await write(file, value);
    });
    const enabled = f.settings.setEnabled(true);
    await vi.waitFor(() => expect(release).toBeDefined());
    const disabled = f.settings.setEnabled(false);
    expect(f.control.stop).toHaveBeenCalledWith('settings-disabled');
    expect(await f.settings.isEnabled()).toBe(false);
    release(); await Promise.all([enabled, disabled]);
    expect(await f.settings.isEnabled()).toBe(false);
    expect(JSON.parse(await readFile(f.filePath, 'utf8'))).toEqual({ enabled: false });
    await expect(f.settings.execute(start)).rejects.toThrow('disabled');
  });

  it('does not enable on a failed save, and keeps control stopped if saving a disable fails', async () => {
    const f = await fixture();
    f.write.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(f.settings.setEnabled(true)).rejects.toThrow('disk unavailable');
    expect(await f.settings.isEnabled()).toBe(false);
    await f.settings.setEnabled(true);
    f.write.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(f.settings.setEnabled(false)).rejects.toThrow('disk unavailable');
    expect(await f.settings.isEnabled()).toBe(false);
    expect(f.control.stop).toHaveBeenCalledWith('settings-disabled');
    await expect(f.settings.execute(start)).rejects.toThrow('disabled');
    await f.settings.setEnabled(false);
    const restarted = f.create(); await restarted.load();
    expect(await restarted.isEnabled()).toBe(false);
  });

  it('reports actual authorization, ignores legacy saved grants and keeps cancellation ungranted', async () => {
    const f = await fixture();
    await writeFile(f.filePath, JSON.stringify({ enabled: true, elevateOnStart: true }));
    await f.settings.load();
    expect(f.settings.settings().permissions.administrator).toBe('not-determined');
    f.administrator.authorize.mockRejectedValueOnce(new ComputerElevationCancelledError('cancelled'));
    await f.settings.requestAdministratorAccess();
    expect(f.settings.settings().permissions.administrator).toBe('not-determined');
    await f.settings.requestAdministratorAccess();
    expect(f.settings.settings().permissions.administrator).toBe('granted');
    await f.settings.requestAdministratorAccess();
    expect(f.administrator.authorize).toHaveBeenCalledTimes(2);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.control.execute).not.toHaveBeenCalled();
    await f.administrator.revoke();
    expect(f.settings.settings().permissions.administrator).toBe('not-determined');
  });

  it('deduplicates pending UAC, blocks model input, and cancels authorization when control is disabled', async () => {
    const f = await fixture(); await f.settings.setEnabled(true);
    let signal!: AbortSignal;
    f.administrator.authorize.mockImplementationOnce((value) => {
      signal = value;
      return new Promise<void>((_resolve, reject) => value.addEventListener('abort', () => reject(value.reason), { once: true }));
    });
    const pending = f.settings.requestAdministratorAccess();
    const rejected = expect(pending).rejects.toThrow('disabled');
    expect(f.settings.requestAdministratorAccess()).toBe(pending);
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(f.settings.execute(start)).rejects.toThrow('authorization is in progress');
    expect(f.administrator.authorize).toHaveBeenCalledOnce();
    await f.settings.setEnabled(false); await rejected;
    expect(signal.aborted).toBe(true);
    expect(f.settings.settings().permissions.administrator).toBe('not-determined');
  });

  it('does not expose Windows administrator access on macOS', async () => {
    const f = await fixture(false);
    expect(f.settings.settings().permissions.administrator).toBeUndefined();
    await expect(f.settings.requestAdministratorAccess()).rejects.toThrow('only available on Windows');
    expect(f.administrator.authorize).not.toHaveBeenCalled();
  });
});
