import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { windowsSandboxFeature } from '../contracts/index.js';
import {
  windowsSandboxMainHostCapability,
  windowsSandboxMainServiceCapability,
} from './capabilities.js';
import { registerWindowsSandboxIpc } from './ipc.js';
import { WindowsSandboxManager } from './manager.js';
import { SandboxEgressGateway } from './sandbox-egress-gateway.js';

const dependencies = defineMainDependencies({
  host: requiredCapability(windowsSandboxMainHostCapability),
});

const serviceProvider = declareCapabilityProvider(windowsSandboxMainServiceCapability);

export const windowsSandboxMainFeature = defineMainFeature({
  definition: windowsSandboxFeature,
  dependencies,
  provides: [serviceProvider],
  setup(context) {
    const { host } = context.dependencies;
    const manager = new WindowsSandboxManager({ executablePath: host.executablePath });
    const gateway = new SandboxEgressGateway({
      resolveUpstreamProxy: host.resolveUpstreamProxy,
    });
    context.scope.add(() => gateway.close());
    context.scope.add(registerWindowsSandboxIpc(
      context.scope,
      manager,
      host.isRendererSender,
    ));
    context.provide(serviceProvider, Object.freeze({
      resolveNetworkEnvironment: () => gateway.environment(),
    }));
  },
});
