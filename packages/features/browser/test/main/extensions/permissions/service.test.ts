import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Extension } from 'electron';
import { expect, it, vi } from 'vitest';
import { BrowserExtensionState } from '../../../../src/main/extensions/state.js';
import { BrowserExtensionPermissions } from '../../../../src/main/extensions/permissions/service.js';

vi.mock('electron', () => ({ nativeImage: {} }));

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-extension-permissions-'));
  const file = path.join(directory, 'state.json');
  const state = new BrowserExtensionState(file); await state.load();
  const extension = { id: 'a'.repeat(32), path: '/extension', version: '1.0', manifest: {
    permissions: ['storage', 'cookies'], host_permissions: ['https://required.test/*'],
    content_scripts: [{ matches: ['https://content-only.test/*'] }],
    optional_permissions: ['tabs', 'notifications'], optional_host_permissions: ['https://*.optional.test/*', 'https://content-only.test/*'],
  } } as unknown as Extension;
  const confirm = vi.fn(async () => true); const publish = vi.fn();
  let current: Extension | null = extension; let queue: Promise<unknown> = Promise.resolve();
  const service = new BrowserExtensionPermissions({ state, current: () => current, confirm, publish,
    serialize: operation => { const result = queue.then(operation); queue = result.catch(() => undefined); return result; } });
  return { state, extension, service, confirm, publish, file, unload: () => { current = null; },
    dispose: () => rm(directory, { recursive: true, force: true }) };
}

it('persists confirmed subsets, reports complete ranges and revokes only optional grants', async () => {
  const { state, extension, service, confirm, publish, file, dispose } = await fixture();
  try {
    expect(await service.call(extension, 'contains', [{ origins: ['https://sub.optional.test/*'] }])).toBe(false);
    const requested = { permissions: ['tabs'], origins: ['https://sub.optional.test/path'] };
    expect(await service.call(extension, 'request', [requested])).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(await service.call(extension, 'contains', [{ origins: ['https://sub.optional.test/anything'] }])).toBe(true);
    for (const origin of ['http://sub.optional.test/*', 'https://*.optional.test/*', 'https://other.optional.test/*', '<all_urls>']) {
      expect(await service.call(extension, 'contains', [{ origins: [origin] }])).toBe(false);
    }
    expect(await service.call(extension, 'request', [requested])).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    const restored = new BrowserExtensionState(file); await restored.load();
    expect(restored.grantedPermissions(extension.id)).toEqual(requested);
    expect(service.effective(extension).manifest.host_permissions).toEqual(['https://required.test/*', requested.origins[0]]);
    expect(await service.call(extension, 'contains', [{ origins: ['https://content-only.test/*'] }])).toBe(true);
    expect(await service.call(extension, 'remove', [{ permissions: ['cookies'] }])).toBe(false);
    expect(await service.call(extension, 'remove', [requested])).toBe(true);
    expect(state.grantedPermissions(extension.id)).toEqual({ permissions: [], origins: [] });
    expect(publish.mock.calls.map(([, event]) => event.kind)).toEqual(['permissionsAdded', 'permissionsRemoved']);
  } finally { await dispose(); }
});

it.each(['<all_urls>', 'https://*.required.test/*'])('revokes a broader optional host grant (%s) while retaining required access', async (origin) => {
  const { state, extension, service, publish, file, dispose } = await fixture();
  extension.manifest.optional_host_permissions = [origin];
  const granted = { permissions: ['tabs'], origins: [origin] };
  try {
    expect(await service.call(extension, 'request', [granted])).toBe(true);
    expect(await service.call(extension, 'remove', [{ origins: ['https://required.test/*'] }])).toBe(false);
    expect(state.grantedPermissions(extension.id)).toEqual(granted);
    expect(await service.call(extension, 'remove', [{ origins: [origin] }])).toBe(true);
    const remaining = { permissions: ['tabs'], origins: [] };
    expect(state.grantedPermissions(extension.id)).toEqual(remaining);
    const restored = new BrowserExtensionState(file); await restored.load();
    expect(restored.grantedPermissions(extension.id)).toEqual(remaining);
    expect(service.effective(extension).manifest.host_permissions).toEqual(['https://required.test/*']);
    expect(await service.call(extension, 'contains', [{ origins: [origin] }])).toBe(false);
    expect(await service.call(extension, 'contains', [{ origins: ['https://required.test/*'] }])).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(extension.id, {
      kind: 'permissionsRemoved', permissions: { permissions: [], origins: [origin] },
    });
  } finally { await dispose(); }
});

it('requires explicit approval and persistence for API access even when a content script already matches the site', async () => {
  const { extension, service, state, confirm, publish, file, dispose } = await fixture();
  const requested = { origins: ['https://content-only.test/*'] };
  try {
    expect(service.getAll(extension).origins).toContain(requested.origins[0]);
    expect(service.effective(extension).manifest.host_permissions).not.toContain(requested.origins[0]);
    confirm.mockResolvedValueOnce(false);
    expect(await service.call(extension, 'request', [requested])).toBe(false);
    expect(state.grantedPermissions(extension.id).origins).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
    expect(await service.call(extension, 'request', [requested])).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenLastCalledWith(extension, { permissions: [], ...requested });
    const restored = new BrowserExtensionState(file); await restored.load();
    expect(restored.grantedPermissions(extension.id).origins).toEqual(requested.origins);
    expect(service.effective(extension).manifest.host_permissions).toContain(requested.origins[0]);
    expect(await service.call(extension, 'request', [requested])).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await service.call(extension, 'remove', [requested])).toBe(true);
    expect(service.effective(extension).manifest.host_permissions).not.toContain(requested.origins[0]);
    expect(service.getAll(extension).origins).toContain(requested.origins[0]);
    expect(publish.mock.calls.map(([, event]) => event.kind)).toEqual(['permissionsAdded', 'permissionsRemoved']);
    await expect(service.call(extension, 'request', [{ origins: ['https://required.test/*'] }])).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  } finally { await dispose(); }
});

it('rejects undeclared ranges, cancelled requests, unsupported APIs and stale installations without granting access', async () => {
  const { extension, service, state, confirm, publish, unload, dispose } = await fixture();
  try {
    for (const origin of ['https://optional.test.evil/*', 'https://*.test/*', '*://*.optional.test/*']) {
      await expect(service.call(extension, 'request', [{ origins: [origin] }])).rejects.toThrow('not declared');
    }
    await expect(service.call(extension, 'request', [{ permissions: ['notifications'] }])).rejects.toThrow('not supported');
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(false);
    expect(await service.call(extension, 'request', [{ origins: ['https://sub.optional.test/*'] }])).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    confirm.mockImplementationOnce(async () => { unload(); return true; });
    await expect(service.call(extension, 'request', [{ origins: ['https://sub.optional.test/*'] }])).rejects.toThrow('unavailable');
    expect(state.grantedPermissions(extension.id)).toEqual({ permissions: [], origins: [] });
  } finally { await dispose(); }
});

it('serializes concurrent permissions and preferences without losing grants, and preserves access if persistence fails', async () => {
  const { extension, service, state, file, dispose } = await fixture();
  try {
    await Promise.all([
      service.call(extension, 'request', [{ origins: ['https://first.optional.test/*'] }]),
      service.call(extension, 'request', [{ origins: ['https://second.optional.test/*'] }]),
    ]);
    await state.setEnabled(extension.id, false);
    await state.setUserScriptsAllowed(extension.id, true);
    const restored = new BrowserExtensionState(file); await restored.load();
    expect(restored.isEnabled(extension.id)).toBe(false);
    expect(restored.allowsUserScripts(extension.id)).toBe(true);
    expect(restored.grantedPermissions(extension.id).origins).toHaveLength(2);
    const saved = await readFile(file, 'utf8');
    expect(JSON.parse(saved).optionalPermissions[extension.id].origins).toHaveLength(2);
    await rm(file); await mkdir(file);
    await expect(service.call(extension, 'remove', [{ origins: ['https://first.optional.test/*'] }])).rejects.toThrow();
    expect(state.grantedPermissions(extension.id).origins).toHaveLength(2);
    const updated = { ...extension, manifest: { ...extension.manifest, optional_host_permissions: [] } };
    expect(service.getAll(updated).origins).not.toContain('https://first.optional.test/*');
  } finally { await dispose(); }
});
