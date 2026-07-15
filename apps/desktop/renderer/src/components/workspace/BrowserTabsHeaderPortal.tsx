import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

type BrowserTabsHeaderPortalValue = {
  host: HTMLSpanElement | null;
  registerHost: (node: HTMLSpanElement | null) => void;
};

const browserTabsHeaderPortalFallback: BrowserTabsHeaderPortalValue = {
  host: null,
  registerHost: () => undefined,
};

const BrowserTabsHeaderPortalContext = createContext<BrowserTabsHeaderPortalValue>(browserTabsHeaderPortalFallback);

export function BrowserTabsHeaderPortalProvider({ children }: PropsWithChildren) {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  const registerHost = useCallback((node: HTMLSpanElement | null) => setHost(node), []);
  const value = useMemo(() => ({ host, registerHost }), [host, registerHost]);

  return <BrowserTabsHeaderPortalContext.Provider value={value}>{children}</BrowserTabsHeaderPortalContext.Provider>;
}

export function useBrowserTabsHeaderPortal(): BrowserTabsHeaderPortalValue {
  return useContext(BrowserTabsHeaderPortalContext);
}
