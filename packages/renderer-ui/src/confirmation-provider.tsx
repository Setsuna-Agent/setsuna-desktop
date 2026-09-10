import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmationOptions } from './confirm-dialog.js';

type ConfirmationRequest = {
  owner: string;
  options: ConfirmationOptions;
  resolve(confirmed: boolean): void;
};
type ConfirmationApi = {
  request(options: ConfirmationOptions, owner: string): Promise<boolean>;
  cancel(owner: string): void;
};
const ConfirmationContext = createContext<ConfirmationApi | null>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const current = useRef<ConfirmationRequest | null>(null);
  const settle = useCallback((confirmed: boolean) => {
    const pending = current.current;
    current.current = null;
    setRequest(null);
    pending?.resolve(confirmed);
  }, []);
  const api = useMemo<ConfirmationApi>(() => ({
    request(options, owner) {
      // A modal already owns the interaction; never queue another destructive action behind it.
      if (current.current) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        current.current = { options, owner, resolve };
        setRequest(current.current);
      });
    },
    cancel(owner) { if (current.current?.owner === owner) settle(false); },
  }), [settle]);

  useEffect(() => () => {
    current.current?.resolve(false);
    current.current = null;
  }, []);

  return <ConfirmationContext.Provider value={api}>
    {children}
    {request ? <ConfirmDialog {...request.options} open onClose={() => settle(false)} onConfirm={() => settle(true)} /> : null}
  </ConfirmationContext.Provider>;
}

/** Cancels a pending decision when the page or hook that requested it unmounts. */
export function useConfirm() {
  const api = useContext(ConfirmationContext);
  const owner = useId();
  useEffect(() => () => api?.cancel(owner), [api, owner]);
  return useCallback((options: ConfirmationOptions) => {
    if (!api) throw new Error('useConfirm requires ConfirmationProvider.');
    return api.request(options, owner);
  }, [api, owner]);
}
