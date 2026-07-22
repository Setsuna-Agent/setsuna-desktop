import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';

type StreamingScrollPinController = {
  getPinned: (stateKey: string) => boolean;
  setPinned: (stateKey: string, pinned: boolean) => void;
};

const StreamingScrollPinContext = createContext<StreamingScrollPinController>({
  getPinned: () => true,
  setPinned: () => undefined,
});

export function StreamingScrollPinProvider({ children }: { children: ReactNode }) {
  const pinnedByKeyRef = useRef(new Map<string, boolean>());
  const value = useMemo<StreamingScrollPinController>(() => ({
    getPinned: (stateKey) => pinnedByKeyRef.current.get(stateKey) ?? true,
    setPinned: (stateKey, pinned) => {
      pinnedByKeyRef.current.set(stateKey, pinned);
    },
  }), []);

  return (
    <StreamingScrollPinContext.Provider value={value}>
      {children}
    </StreamingScrollPinContext.Provider>
  );
}

export function useStreamingScrollPinController(): StreamingScrollPinController {
  return useContext(StreamingScrollPinContext);
}
