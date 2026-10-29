import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { BUILTIN_COLLABORATION_ROLES, LEGACY_COLLABORATION_ROLE_TEXT } from '@setsuna-desktop/feature-collaboration/contracts';
import { createRuntimeServerTestHarness } from '../../support/runtime-server/harness.js';

it('migrates saved English defaults to inherited text while preserving edited, cleared, and custom-role fields', async () => {
  const harness = await createRuntimeServerTestHarness();
  try {
    await harness.server.close();
    const directory = path.join(harness.runtimeDataDir, 'runtime', 'features', 'collaboration', 'settings');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'agents.json');
    const roles = BUILTIN_COLLABORATION_ROLES.map((name) => ({ name, ...LEGACY_COLLABORATION_ROLE_TEXT[name], model: null, reasoningEffort: null }));
    roles[1] = { ...roles[1]!, description: '团队的实现代理', instructions: '' };
    const custom = { name: 'auditor', ...LEGACY_COLLABORATION_ROLE_TEXT.worker, model: null, reasoningEffort: null };
    await writeFile(file, JSON.stringify({ featureId: 'collaboration', documentId: 'agents', schemaVersion: 1, revision: 4,
      data: { model: null, reasoningEffort: null, roles: [...roles, custom] },
    }));
    await harness.startRuntimeServer(harness.runtimeDataDir);
    const current = await harness.runtimeFetch('/v1/features/collaboration/settings');
    expect(current.settings.roles[0]).toMatchObject({ description: null, instructions: null });
    expect(current.settings.roles[1]).toMatchObject({ description: '团队的实现代理', instructions: '' });
    expect(current.settings.roles[2]).toMatchObject({ description: null, instructions: null });
    expect(current.settings.roles[3]).toEqual(custom);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ schemaVersion: 2, data: current.settings });
  } finally { await harness.close(); }
});

it('persists agent roles through typed routes with revision protection and rejects model/permission escalation and cross-parent actions', async () => {
  const harness = await createRuntimeServerTestHarness();
  const url = '/v1/features/collaboration/settings';
  try {
    const initial = await harness.runtimeFetch(url);
    expect(initial.settings.roles.map((role: { name: string }) => role.name)).toEqual(['default', 'worker', 'explorer']);
    const settings = { ...initial.settings, roles: [...initial.settings.roles, {
      name: 'verifier', description: 'Check ownership', instructions: 'Verify before changing cleanup.', model: null, reasoningEffort: null,
      avatar: { type: 'preset', key: 'gem', color: '#123456' },
      permissionProfile: 'danger-full-access', approvalPolicy: 'full',
    }] };
    const saved = await harness.runtimeFetch(url, { method: 'PATCH', body: JSON.stringify({ expectedRevision: initial.revision, settings }) });
    expect(saved.settings.roles.at(-1)).toEqual({ name: 'verifier', description: 'Check ownership', instructions: 'Verify before changing cleanup.',
      model: null, reasoningEffort: null, avatar: { type: 'preset', key: 'gem', color: '#123456' } });
    expect(await harness.runtimeFetch(url)).toEqual(saved);
    const document = JSON.parse(await readFile(path.join(harness.runtimeDataDir, 'runtime', 'features', 'collaboration', 'settings', 'agents.json'), 'utf8'));
    expect(document.data).toEqual(saved.settings);
    await expect(harness.runtimeFetch(url, { method: 'PATCH', body: JSON.stringify({ expectedRevision: initial.revision, settings }) })).rejects.toThrow('REVISION_CONFLICT');
    await expect(harness.runtimeFetch(url, { method: 'PATCH', body: JSON.stringify({ expectedRevision: saved.revision, settings: { ...saved.settings, model: { providerId: 'missing', modelId: 'missing' } } }) })).rejects.toThrow('INVALID_CONFIGURATION');
    expect(await harness.runtimeFetch(url)).toEqual(saved);
    const first = await harness.runtimeFetch('/v1/threads', { method: 'POST', body: JSON.stringify({ title: 'First' }) });
    const second = await harness.runtimeFetch('/v1/threads', { method: 'POST', body: JSON.stringify({ title: 'Unrelated' }) });
    await expect(harness.runtimeFetch(`/v1/features/collaboration/threads/${first.id}/tasks/${second.id}/actions`, {
      method: 'POST', body: JSON.stringify({ action: 'interrupt', expectedTurnId: null }),
    })).rejects.toThrow('TASK_CONFLICT');
  } finally { await harness.close(); }
});
