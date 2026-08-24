import {
  NetworkProxyRendererProvider,
  useNetworkProxyView,
  type NetworkProxyRendererStateService,
  type NetworkProxyRendererView,
} from '@setsuna-desktop/feature-network-proxy/renderer';
import type { ReactNode } from 'react';

export function NetworkProxyFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: NetworkProxyRendererStateService;
}>) {
  return (
    <NetworkProxyRendererProvider service={service}>
      {children}
    </NetworkProxyRendererProvider>
  );
}

export function useNetworkProxyFeatureView(): NetworkProxyRendererView {
  return useNetworkProxyView();
}

export type NetworkProxyFeatureView = NetworkProxyRendererView;
