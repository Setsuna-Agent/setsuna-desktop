import { createContext, useContext, type ReactNode } from 'react';
import type { UpdaterRendererStateService } from './service.js';
import './topbar.css';

const UpdaterRendererContext = createContext<UpdaterRendererStateService | null>(null);

export function UpdaterRendererProvider({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: UpdaterRendererStateService;
}>) {
  return (
    <UpdaterRendererContext.Provider value={service}>
      {children}
    </UpdaterRendererContext.Provider>
  );
}

export function useUpdaterRendererService(): UpdaterRendererStateService {
  const service = useContext(UpdaterRendererContext);
  if (!service) throw new Error('Updater renderer service is unavailable outside its Feature boundary.');
  return service;
}
