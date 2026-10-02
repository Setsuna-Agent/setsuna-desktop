import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerSettingsService } from '../../src/main/settings.js';
import type { ComputerCommand } from '../../src/contracts/index.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const start: ComputerCommand = { kind: 'start', identity: { threadId: 't', turnId: 'u', unattended: false, readOnly: false, supportsImages: true } };
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'computer-settings-'));
  directories.push(directory);
  const filePath = path.join(directory, 'computer-use.json');
  const control = { execute: vi.fn(async () => ({ kind: 'stopped' as const })), stop: vi.fn(async () => undefined) };
  const write = vi.fn(async (file: string, value: unknown) => { await writeFile(file, JSON.stringify(value)); });
  const create = () => new ComputerSettingsService(filePath, control, write, () => ({ screen: 'granted', accessibility: 'granted' }));
  const settings = create(); await settings.load();
  return { settings, create, control, write, filePath };
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
});
