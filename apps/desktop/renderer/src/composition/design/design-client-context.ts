import type { DesignClient } from '@setsuna-desktop/feature-design/renderer';
import { createContext, useContext } from 'react';

// Keep the context instance shared when the renderer refreshes the provider component.
export const DesignClientContext = createContext<DesignClient | null>(null);

export function useDesignClient(): DesignClient | null {
  return useContext(DesignClientContext);
}
