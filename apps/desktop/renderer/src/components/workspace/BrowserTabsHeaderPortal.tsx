import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from 'react';

type BrowserTabsHeaderPortalValue = {
  host: HTMLSpanElement | null;
  registerHost: (node: HTMLSpanElement | null) => void;
};

type BrowserTabCommandsValue = {
  registerNewTabHandler: (handler: () => void) => () => void;
  requestNewTab: () => boolean;
};

type BrowserTabsContextValue = BrowserTabsHeaderPortalValue & BrowserTabCommandsValue;

const browserTabsHeaderPortalFallback: BrowserTabsContextValue = {
  host: null,
  registerHost: () => undefined,
  registerNewTabHandler: () => () => undefined,
  requestNewTab: () => false,
};

const BrowserTabsHeaderPortalContext = createContext<BrowserTabsContextValue>(browserTabsHeaderPortalFallback);

export function BrowserTabsHeaderPortalProvider({ children }: PropsWithChildren) {
  const newTabHandlerRef = useRef<(() => void) | null>(null);
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  const registerHost = useCallback((node: HTMLSpanElement | null) => setHost(node), []);
  const registerNewTabHandler = useCallback((handler: () => void) => {
    newTabHandlerRef.current = handler;
    return () => {
      if (newTabHandlerRef.current === handler) newTabHandlerRef.current = null;
    };
  }, []);
  const requestNewTab = useCallback(() => {
    const handler = newTabHandlerRef.current;
    if (!handler) return false;
    handler();
    return true;
  }, []);
  const value = useMemo(
    () => ({ host, registerHost, registerNewTabHandler, requestNewTab }),
    [host, registerHost, registerNewTabHandler, requestNewTab],
  );

  return <BrowserTabsHeaderPortalContext.Provider value={value}>{children}</BrowserTabsHeaderPortalContext.Provider>;
}

export function useBrowserTabsHeaderPortal(): BrowserTabsHeaderPortalValue {
  return useContext(BrowserTabsHeaderPortalContext);
}

export function useBrowserTabCommands(): BrowserTabCommandsValue {
  return useContext(BrowserTabsHeaderPortalContext);
}
