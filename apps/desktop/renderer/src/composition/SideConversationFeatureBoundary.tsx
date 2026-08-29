import type { SideConversationRendererService } from '@setsuna-desktop/feature-side-conversation/contracts';
import {
  SideConversationRendererProvider,
  useSideConversationRendererService,
} from '@setsuna-desktop/feature-side-conversation/renderer';
import type { ReactNode } from 'react';

/** Keeps the side conversation service behind the renderer composition boundary. */
export function SideConversationFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: SideConversationRendererService;
}>) {
  return (
    <SideConversationRendererProvider service={service}>
      {children}
    </SideConversationRendererProvider>
  );
}

export function useSideConversationFeatureService(): SideConversationRendererService {
  return useSideConversationRendererService();
}
