import type { ConversationDebugRendererService } from '@setsuna-desktop/feature-conversation-debug/renderer';
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const ConversationDebugFeatureContext = createContext<ConversationDebugRendererService | null>(null);

export function ConversationDebugFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: ConversationDebugRendererService;
}>) {
  return (
    <ConversationDebugFeatureContext.Provider value={service}>
      {children}
    </ConversationDebugFeatureContext.Provider>
  );
}

export function useConversationDebugFeatureService(): ConversationDebugRendererService {
  const service = useContext(ConversationDebugFeatureContext);
  if (!service) throw new Error('ConversationDebugFeatureServiceBoundary is missing.');
  return service;
}

export function useConversationDebugFeatureEnabled(): boolean {
  const service = useConversationDebugFeatureService();
  return useSyncExternalStore(service.subscribe, service.snapshot, service.snapshot).enabled;
}
