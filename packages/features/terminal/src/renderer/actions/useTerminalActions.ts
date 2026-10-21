import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { useToast } from '@setsuna-desktop/renderer-ui';
import { useCallback, useEffect, useState } from 'react';
import { normalizeTerminalAction, type TerminalAction, type TerminalActionInput } from '../../contracts/index.js';
import { changeTerminalActions, readTerminalActions, sameTerminalActions, TerminalActionsConflict,
  TERMINAL_ACTIONS_CHANGED, terminalActionsStorageKey,
  type TerminalActionSettings } from './storage.js';

export function useTerminalActions(projectId: string, translate: RendererTranslate) {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<{ projectId: string; settings: TerminalActionSettings } | null>(null);
  const reportError = useCallback((error: unknown) => {
    toast.error(translate(error instanceof TerminalActionsConflict
      ? 'feature.terminal.actions.changedElsewhere' : 'feature.terminal.actions.saveFailed'));
  }, [toast, translate]);

  useEffect(() => {
    const refresh = () => {
      try { setSnapshot({ projectId, settings: readTerminalActions(projectId) }); }
      catch { toast.error(translate('feature.terminal.actions.loadFailed')); }
    };
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === terminalActionsStorageKey(projectId)) refresh();
    };
    const local = (event: Event) => {
      if ((event as CustomEvent<string>).detail === projectId) refresh();
    };
    refresh();
    window.addEventListener('storage', storage);
    window.addEventListener(TERMINAL_ACTIONS_CHANGED, local);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(TERMINAL_ACTIONS_CHANGED, local);
    };
  }, [projectId, toast, translate]);

  const mutate = (change: (current: TerminalActionSettings) => TerminalActionSettings): boolean => {
    try {
      setSnapshot({ projectId, settings: changeTerminalActions(projectId, change) });
      return true;
    } catch (error) { reportError(error); return false; }
  };
  const settings = snapshot?.projectId === projectId ? snapshot.settings : null;

  return {
    actions: settings?.actions ?? [],
    selected: settings?.actions.find((action) => action.id === settings.selectedId) ?? null,
    ready: settings !== null,
    add(input: TerminalActionInput) {
      return mutate((current) => {
        const action: TerminalAction = { ...normalizeTerminalAction(input), id: crypto.randomUUID() };
        return {
          actions: [...current.actions, action],
          selectedId: current.selectedId ?? action.id,
        };
      });
    },
    replace(input: readonly TerminalAction[], base: readonly TerminalAction[]) {
      return mutate((current) => {
        // A settings form may remain open while another window edits the same
        // project. Keep the draft instead of silently replacing those edits.
        if (!sameTerminalActions(current.actions, base)) throw new TerminalActionsConflict();
        const ids = new Set<string>();
        const actions = input.map((item) => {
          if (!item.id || ids.has(item.id)) throw new Error('Invalid terminal action identity.');
          ids.add(item.id);
          return { ...normalizeTerminalAction(item), id: item.id };
        });
        return { actions, selectedId: actions.find((action) => action.id === current.selectedId)?.id ?? actions[0]?.id ?? null };
      });
    },
    select(id: string) {
      return mutate((current) => {
        if (!current.actions.some((item) => item.id === id)) throw new Error('Action was removed.');
        return { ...current, selectedId: id };
      });
    },
  };
}
