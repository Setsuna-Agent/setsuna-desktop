import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  updateToolRunDisclosurePreference,
  type ToolRunDisclosurePreferences,
} from './toolRunDisclosureState.js';

export type ToolRunDisclosureController = {
  preferences: ToolRunDisclosurePreferences;
  setPreference: (disclosureId: string, anchorRunId: string, open: boolean) => void;
};

const emptyPreferences: ToolRunDisclosurePreferences = new Map();
const ToolRunDisclosureContext = createContext<ToolRunDisclosureController>({
  preferences: emptyPreferences,
  setPreference: () => undefined,
});

export function ToolRunDisclosureProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<ToolRunDisclosurePreferences>(() => new Map());
  const setPreference = useCallback((disclosureId: string, anchorRunId: string, open: boolean) => {
    setPreferences((current) => updateToolRunDisclosurePreference(current, disclosureId, anchorRunId, open));
  }, []);
  const value = useMemo<ToolRunDisclosureController>(() => ({ preferences, setPreference }), [preferences, setPreference]);

  return (
    <ToolRunDisclosureContext.Provider value={value}>
      {children}
    </ToolRunDisclosureContext.Provider>
  );
}

export function useToolRunDisclosureController(): ToolRunDisclosureController {
  return useContext(ToolRunDisclosureContext);
}
