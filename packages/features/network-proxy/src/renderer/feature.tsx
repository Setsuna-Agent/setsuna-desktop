import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  type RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import {
  registerSettingsPage,
  type SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { Network } from 'lucide-react';
import { networkProxyFeature } from '../contracts/index.js';
import {
  networkProxyRendererHostCapability,
  networkProxyRendererStateCapability,
} from './capabilities.js';
import { useNetworkProxyServiceView } from './context.js';
import { networkProxyMessages } from './messages.js';
import { NetworkProxySettings } from './NetworkProxySettings.js';
import { NetworkProxyRendererStateService } from './service.js';
import './network-proxy.css';

const dependencies = defineRendererDependencies({
  host: requiredCapability(networkProxyRendererHostCapability),
});

const stateProvider = declareCapabilityProvider(networkProxyRendererStateCapability);

export const networkProxyRendererFeature = defineRendererFeature({
  definition: networkProxyFeature,
  dependencies,
  provides: [stateProvider],
  messages: [networkProxyMessages],
  setup(context) {
    const service = new NetworkProxyRendererStateService(context.dependencies.host.bridge);
    service.start();
    context.scope.add(() => service.dispose());
    context.provide(stateProvider, service);
    registerSettingsPage(context.ui, {
        entryId: 'network-proxy.settings-page',
        descriptionKey: 'feature.networkProxy.settings.description',
        icon: Network,
        sectionId: 'network-proxy',
        location: 'settings',
        navigationGroupId: 'models-and-services',
        order: 250,
        titleKey: 'feature.networkProxy.settings.title',
        render: ({ translate, ui }) => (
          <NetworkProxySettingsView service={service} translate={translate} ui={ui} />
        ),
    });
  },
});

function NetworkProxySettingsView({ service, translate, ui }: Readonly<{
  service: NetworkProxyRendererStateService;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>) {
  const proxy = useNetworkProxyServiceView(service);
  return <NetworkProxySettings proxy={proxy} translate={translate} ui={ui} />;
}
