import { FeatureSettingsRevisionConflictError } from '@setsuna-desktop/feature-core/settings';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import {
  diagnoseWorkspaceDependencies,
  repairWorkspaceDependencies,
  updateWorkspaceDependencySettings,
  workspaceDependenciesFeature,
  type WorkspaceDependencySettings,
  type WorkspaceDependenciesRuntimeHost,
} from '../../src/contracts/index.js';
import { workspaceDependenciesRuntimeFeature } from '../../src/runtime/feature.js';
import { ManagedWorkspaceDependencyManager } from '../../src/runtime/managed-workspace-dependency-manager.js';

describe('Workspace Dependencies Feature', () => {
  it('imports legacy settings once and retires them only after the Feature document is readable', async () => {
    const imported = await setupFeature({ settingsExist: false, settingsReadable: true });
    expect(imported.initialize).toHaveBeenCalledWith({ value: LEGACY_SETTINGS });
    expect(imported.retire).toHaveBeenCalledTimes(1);
    expect(imported.setCondition).toHaveBeenCalledWith('settings', null);

    const invalid = await setupFeature({ settingsExist: true, settingsReadable: false });
    expect(invalid.initialize).not.toHaveBeenCalled();
    expect(invalid.retire).not.toHaveBeenCalled();
    expect(invalid.setCondition).toHaveBeenCalledWith('settings', {
      code: 'WORKSPACE_DEPENDENCY_SETTINGS_INVALID',
      message: 'Workspace dependency settings could not be applied.',
    });
  });

  it('maps settings revision conflicts to the kernel operation error', async () => {
    const fixture = await setupFeature({
      settingsExist: true,
      settingsReadable: true,
      updateError: new FeatureSettingsRevisionConflictError(2, LEGACY_SETTINGS),
    });

    await expect(fixture.routes.get(updateWorkspaceDependencySettings.id)?.({
      expectedRevision: 1,
      patch: { npmRegistryUrl: 'https://registry.changed.example/npm/' },
    })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      retryable: true,
    });
  });

  it('maps diagnose and repair failures to the declared toolchain error', async () => {
    const diagnose = vi.spyOn(ManagedWorkspaceDependencyManager.prototype, 'diagnose')
      .mockRejectedValue(new Error('diagnostic failed'));
    const repair = vi.spyOn(ManagedWorkspaceDependencyManager.prototype, 'repair')
      .mockRejectedValue(new Error('repair failed'));
    try {
      const fixture = await setupFeature({ settingsExist: true, settingsReadable: true });

      await expect(fixture.routes.get(diagnoseWorkspaceDependencies.id)?.(undefined))
        .rejects.toMatchObject({
          code: 'TOOLCHAIN_UNAVAILABLE',
          message: 'diagnostic failed',
          retryable: true,
        });
      await expect(fixture.routes.get(repairWorkspaceDependencies.id)?.(undefined))
        .rejects.toMatchObject({
          code: 'TOOLCHAIN_UNAVAILABLE',
          message: 'repair failed',
          retryable: true,
        });
    } finally {
      diagnose.mockRestore();
      repair.mockRestore();
    }
  });
});

const LEGACY_SETTINGS: WorkspaceDependencySettings = Object.freeze({
  npmRegistryUrl: 'https://registry.example/npm/',
  pythonPackageIndexUrl: 'https://mirror.example/simple',
});

async function setupFeature(options: Readonly<{
  settingsExist: boolean;
  settingsReadable: boolean;
  updateError?: unknown;
}>) {
  const scope = createFeatureScope({
    featureId: workspaceDependenciesFeature.id,
    process: 'runtime',
    scopeId: `workspace-dependencies-migration:${options.settingsExist}:${options.settingsReadable}`,
  });
  const initialize = vi.fn(async () => ({ value: LEGACY_SETTINGS, revision: 0 }));
  const retire = vi.fn(async () => undefined);
  const setCondition = vi.fn();
  const routes = new Map<string, (input: unknown) => unknown | PromiseLike<unknown>>();
  const settingsHandle = {
    async exists() { return options.settingsExist; },
    initialize,
    async read() {
      if (!options.settingsReadable) throw new Error('corrupt Feature settings');
      return { value: LEGACY_SETTINGS, revision: 1 };
    },
    async readPublic() { return { value: LEGACY_SETTINGS, revision: 1 }; },
    async readSecret() { return undefined; },
    async update() { throw options.updateError ?? new Error('not used during setup'); },
    subscribeRuntime() { return () => undefined; },
  };

  await workspaceDependenciesRuntimeFeature.setup({
    scope: scope.scope,
    dependencies: {
      routes: {
        register(_scope, operation, handler) {
          routes.set(operation.id, (input) => handler(input as never, {
            signal: new AbortController().signal,
          }));
          return Object.freeze({ dispose() {} });
        },
      },
      settings: {
        open: () => settingsHandle,
        diagnoseDocument: async () => ({
          featureId: workspaceDependenciesFeature.id,
          documentId: 'preferences',
          status: options.settingsReadable ? 'ok' : 'schema-invalid',
          diagnosisId: 'workspace-dependencies-migration-test',
        }),
      },
      host: workspaceDependenciesHost(),
      legacySettings: {
        async read() { return LEGACY_SETTINGS; },
        retire,
      },
    },
    health: { setCondition },
    provide() {},
  });
  await scope.finishDispose();

  return { initialize, retire, routes, setCondition };
}

function workspaceDependenciesHost(): WorkspaceDependenciesRuntimeHost {
  return {
    dataDir: '/tmp/setsuna-workspace-dependencies-feature-test',
    fetch: async () => { throw new Error('not used during setup'); },
    resolveNetworkEnvironment: async () => ({}),
    sandboxNetworkAccessEnabled: async () => true,
  };
}
