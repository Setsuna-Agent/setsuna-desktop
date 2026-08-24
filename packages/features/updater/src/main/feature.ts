import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { updaterFeature } from '../contracts/index.js';
import {
  updaterLifecycleCapability,
  updaterMainHostCapability,
} from './capabilities.js';
import { registerUpdaterIpc } from './ipc.js';
import { DesktopUpdater } from './updater.js';

const dependencies = defineMainDependencies({
  host: requiredCapability(updaterMainHostCapability),
});

const lifecycleProvider = declareCapabilityProvider(updaterLifecycleCapability);

export const updaterMainFeature = defineMainFeature({
  definition: updaterFeature,
  dependencies,
  provides: [lifecycleProvider],
  setup(context) {
    const { host } = context.dependencies;
    const updater = new DesktopUpdater({
      currentVersion: host.currentVersion,
      downloadsDir: host.downloadsDir,
      enabled: host.enabled,
      fetch: (input, init) => host.fetch(input, init),
      repository: host.repository,
      sourceConfigPath: host.sourceConfigPath,
    });

    context.scope.add(() => updater.stop());
    context.scope.add(registerUpdaterIpc(
      context.scope,
      updater,
      host.mainWindow,
      () => host.interfaceLanguage(),
    ));

    let initializePromise: Promise<void> | null = null;
    context.provide(lifecycleProvider, Object.freeze({
      initialize() {
        initializePromise ??= updater.initialize();
        return initializePromise;
      },
      start: () => updater.start(),
      stop: () => updater.stop(),
    }));
  },
});
