import { createContext, useContext, type ReactNode } from 'react';
import {
  createNoopSideConversationRendererService,
  type SideConversationRendererService,
} from '../contracts/index.js';

const SideConversationContext = createContext<SideConversationRendererService>(
  createNoopSideConversationRendererService(),
);

export function SideConversationRendererProvider({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: SideConversationRendererService;
}>) {
  return (
    <SideConversationContext.Provider value={service}>
      {children}
    </SideConversationContext.Provider>
  );
}

export function useSideConversationRendererService(): SideConversationRendererService {
  return useContext(SideConversationContext);
}
