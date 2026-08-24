import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { webDavSyncFeature } from '../contracts/index.js';
import {
  webDavSyncLifecycleCapability,
  webDavSyncMainHostCapability,
} from './capabilities.js';
import { WebDavSyncConfigStore } from './config-store.js';
import { registerWebDavSyncIpc } from './ipc.js';
import { WebDavSyncService } from './service.js';

const dependencies = defineMainDependencies({
  host: requiredCapability(webDavSyncMainHostCapability),
});

export const webDavSyncMainFeature = defineMainFeature({
  definition: webDavSyncFeature,
  dependencies,
  provides: [declareCapabilityProvider(webDavSyncLifecycleCapability)],
  async setup(context) {
    const { host } = context.dependencies;
    const service = new WebDavSyncService({
      appVersion: host.appVersion,
      configStore: new WebDavSyncConfigStore(
        host.configPath,
        host.credentialVault,
        { writeConfig: (filePath, value) => host.storage.writeJsonAtomically(filePath, value) },
      ),
      dataRoot: host.dataRoot,
      featureSettingsDocuments: host.featureSettingsDocuments,
      fetch: (input, init) => host.fetch(input, init),
      runtime: host.runtime,
      storage: host.storage,
    });

    context.scope.add(() => service.close());
    context.scope.add(registerWebDavSyncIpc(
      service,
      host.mainWindow,
      (operation) => context.scope.runOperation(operation),
      () => host.requestRelaunch(),
    ));
    let startPromise: Promise<void> | null = null;
    context.provide(
      declareCapabilityProvider(webDavSyncLifecycleCapability),
      Object.freeze({
        start() {
          startPromise ??= service.initialize().catch((error: unknown) => {
            // Damaged sync metadata must not prevent the rest of the desktop from starting.
            console.error('[webdav-sync] unable to initialize sync service', error);
          });
          return startPromise;
        },
        close: () => service.close(),
      }),
    );
  },
});
