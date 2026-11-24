import { useEffect, useState, type ReactNode } from 'react';
import { shellRouteSlot, type RendererAppRouteId } from '@setsuna-desktop/renderer-contracts/shell';
import { DesignRouteBusyContext } from '../../composition/design/DesignChatHost.js';
import { useRendererOwnedSlots } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { PluginRouteAdapter, type PluginRouteAdapterProps } from './PluginRouteAdapter.js';
import { PageSessionProvider } from '@setsuna-desktop/renderer-ui';

export function AppRouteSurface({ activeView, pluginProps, renderDefault }: Readonly<{
  activeView: RendererAppRouteId;
  pluginProps: Omit<PluginRouteAdapterProps, 'active'>;
  renderDefault(routeId: Exclude<RendererAppRouteId, 'plugin'>): ReactNode;
}>) {
  const slots = useRendererOwnedSlots();
  const pluginActive = activeView === 'plugin';
  const designActive = activeView === 'design';
  const [designBusy, setDesignBusy] = useState(false);
  const [pluginOpened, setPluginOpened] = useState(pluginActive);
  useEffect(() => { if (pluginActive) setPluginOpened(true); }, [pluginActive]);
  const renderRoute = (routeId: Exclude<RendererAppRouteId, 'plugin'>) => slots.keyed(shellRouteSlot, routeId, {
    routeId, renderDefault: () => renderDefault(routeId),
  });
  return <PageSessionProvider>
    {pluginActive || designActive ? null : renderRoute(activeView)}
    {designActive || designBusy ? <div className="app-design-route-layer" aria-hidden={!designActive || undefined}
      {...{ inert: designActive ? undefined : '' }}>
      <DesignRouteBusyContext.Provider value={setDesignBusy}>
        {renderRoute('design')}
      </DesignRouteBusyContext.Provider>
    </div> : null}
    {/* Keep the route owner and its DOM in place after the first visit. Reparenting
        an iframe would reload it even if React retained the component state. */}
    {pluginActive || pluginOpened ? <div className="plugin-route-layer" hidden={!pluginActive}>
      {slots.keyed(shellRouteSlot, 'plugin', {
        routeId: 'plugin',
        renderDefault: () => <PluginRouteAdapter {...pluginProps} active={pluginActive} />,
      })}
    </div> : null}
  </PageSessionProvider>;
}
