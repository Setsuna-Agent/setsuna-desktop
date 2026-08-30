import type {
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import type {
  SettingsViewUi,
} from '@setsuna-desktop/renderer-contracts/settings';
import { createContext, useContext, type ReactNode } from 'react';
import type { UsageRendererHost } from '../capabilities.js';

type UsageViewContextValue = Readonly<{
  host: UsageRendererHost;
  locale: string;
  translate: RendererTranslate;
  ui: SettingsViewUi;
}>;

const UsageViewContext = createContext<UsageViewContextValue | null>(null);

export function UsageViewProvider({
  children,
  host,
  translate,
  ui,
}: Readonly<Omit<UsageViewContextValue, 'locale'> & { children: ReactNode }>) {
  return (
    <UsageViewContext.Provider value={{
      host,
      locale: translate('feature.usage.locale'),
      translate,
      ui,
    }}>
      {children}
    </UsageViewContext.Provider>
  );
}

export function useUsageView(): UsageViewContextValue {
  const value = useContext(UsageViewContext);
  if (!value) throw new Error('UsageViewProvider is missing.');
  return value;
}
