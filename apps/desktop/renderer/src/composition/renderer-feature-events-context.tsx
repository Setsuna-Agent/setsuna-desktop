import { createContext, useContext, type ReactNode } from 'react';
import { RendererFeatureEventHub } from './renderer-feature-event-hub.js';

const RendererFeatureEventsContext = createContext<RendererFeatureEventHub | null>(null);

export function RendererFeatureEventsProvider({
  children,
  events,
}: Readonly<{ children: ReactNode; events: RendererFeatureEventHub }>) {
  return (
    <RendererFeatureEventsContext.Provider value={events}>
      {children}
    </RendererFeatureEventsContext.Provider>
  );
}

export function useRendererFeatureEvents(): RendererFeatureEventHub {
  const events = useContext(RendererFeatureEventsContext);
  if (!events) throw new Error('RendererFeatureEventsProvider is missing.');
  return events;
}
