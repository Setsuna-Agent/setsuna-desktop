import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { networkProxyFeature } from '../contracts/index.js';
import {
  networkProxyMainHostCapability,
  networkProxyMainServiceCapability,
  type NetworkProxyMainService,
} from './capabilities.js';
import { DesktopBrowserProxyController } from './browser.js';
import { DesktopNetworkProxyFetch } from './fetch.js';
import { registerNetworkProxyIpc } from './ipc.js';
import { DesktopNetworkProxyService } from './service.js';
import { DesktopNetworkProxyStore } from './store.js';

const dependencies = defineMainDependencies({
  host: requiredCapability(networkProxyMainHostCapability),
});

const serviceProvider = declareCapabilityProvider(networkProxyMainServiceCapability);

export const networkProxyMainFeature = defineMainFeature({
  definition: networkProxyFeature,
  dependencies,
  provides: [serviceProvider],
  async setup(context) {
    const { host } = context.dependencies;
    const service = new DesktopNetworkProxyService(new DesktopNetworkProxyStore(
      host.configPath,
      host.credentialVault,
      { writeConfig: host.writeJsonAtomically },
    ));
    const fetch = new DesktopNetworkProxyFetch(service, { systemFetch: host.systemFetch });
    const browser = new DesktopBrowserProxyController(service);

    // Register in ownership order so scope disposal first stops new IPC/browser
    // work, then closes fetch dispatchers and the credential-protecting relays.
    context.scope.add(() => service.close());
    context.scope.add(() => fetch.close());
    context.scope.add(() => browser.stop());
    await browser.start();
    context.scope.add(registerNetworkProxyIpc(
      context.scope,
      service,
      host.mainWindow,
      (proxyServerId) => host.deleteServerThroughRuntime(proxyServerId),
    ));

    const publicService = Object.freeze<NetworkProxyMainService>({
      deleteServer: (proxyServerId) => service.deleteServer(proxyServerId),
      environmentFor: (scope) => service.environmentFor(scope),
      fetch: (scope, input, init) => fetch.fetch(scope, input, init),
      resolve: (input) => service.resolve(input),
      validateServerReferences: (proxyServerIds) => service.validateServerReferences(proxyServerIds),
    });
    context.provide(serviceProvider, publicService);
  },
});
