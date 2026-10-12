import { useEffect, useState, type ReactNode } from 'react';
import { shellRouteSlot, type RendererAppRouteId } from '@setsuna-desktop/renderer-contracts/shell';
import { useRendererOwnedSlots } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { PluginRouteAdapter, type PluginRouteAdapterProps } from './PluginRouteAdapter.js';

export function AppRouteSurface({ activeView, pluginProps, renderDefault }: Readonly<{
  activeView: RendererAppRouteId;
  pluginProps: Omit<PluginRouteAdapterProps, 'active'>;
  renderDefault(routeId: Exclude<RendererAppRouteId, 'plugin'>): ReactNode;
}>) {
  const slots = useRendererOwnedSlots();
  const active = activeView === 'plugin';
  const [opened, setOpened] = useState(active);
  useEffect(() => { if (active) setOpened(true); }, [active]);
  return <>
    {activeView === 'plugin' ? null : slots.keyed(shellRouteSlot, activeView, {
      routeId: activeView, renderDefault: () => renderDefault(activeView),
    })}
    {/* Keep the route owner and its DOM in place after the first visit. Reparenting
        an iframe would reload it even if React retained the component state. */}
    {active || opened ? <div className="plugin-route-layer" hidden={!active}>
      {slots.keyed(shellRouteSlot, 'plugin', {
        routeId: 'plugin',
        renderDefault: () => <PluginRouteAdapter {...pluginProps} active={active} />,
      })}
    </div> : null}
  </>;
}
