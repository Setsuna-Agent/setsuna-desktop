import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { TerminalAction } from '../../contracts/index.js';

export type TerminalActionProject = Readonly<{ id: string; name: string; iconNode?: ReactNode }>;
export type TerminalActionsHost = Readonly<{
  projects: readonly TerminalActionProject[];
  platform: string;
  runAction?: (action: TerminalAction) => Promise<void>;
  openTerminal?: () => void;
  openSettings(): void;
}>;
type EditorSelection = { project: TerminalActionProject; draft?: TerminalAction };
type TerminalActionsContextValue = TerminalActionsHost & {
  selection: EditorSelection | null;
  openProjectSettings(project: TerminalActionProject, draft?: TerminalAction): void;
  selectProject(project: TerminalActionProject | null): void;
  consumeDraft(): void;
};
const TerminalActionsContext = createContext<TerminalActionsContextValue | null>(null);

export function TerminalActionsHostProvider({ host, children }: { host: TerminalActionsHost; children: ReactNode }) {
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const openProjectSettings = useCallback((project: TerminalActionProject, draft?: TerminalAction) => {
    setSelection({ project, draft });
    host.openSettings();
  }, [host.openSettings]);
  const selectProject = useCallback((project: TerminalActionProject | null) => {
    setSelection(project ? { project } : null);
  }, []);
  const consumeDraft = useCallback(() => {
    setSelection((current) => current?.draft ? { project: current.project } : current);
  }, []);
  const value = useMemo(() => ({ ...host, selection, openProjectSettings, selectProject, consumeDraft }),
    [host, selection, openProjectSettings, selectProject, consumeDraft]);
  return <TerminalActionsContext.Provider value={value}>{children}</TerminalActionsContext.Provider>;
}

export function useTerminalActionsHost() { return useContext(TerminalActionsContext); }
