import { useState } from 'react';
import type { TerminalAction } from '../../contracts/index.js';
import { sameTerminalActions } from './storage.js';

type Draft = { base: readonly TerminalAction[]; actions: TerminalAction[] };

function createEmptyAction(): TerminalAction {
  return { id: crypto.randomUUID(), name: '', command: '', icon: 'settings', platform: 'all' };
}

export function useTerminalActionDraft(
  saved: readonly TerminalAction[],
  persist: (actions: readonly TerminalAction[], base: readonly TerminalAction[]) => boolean,
  initialAction?: TerminalAction,
) {
  const [edit, setEdit] = useState<Draft | null>(() => {
    // Seed only when entering an empty project; deleting a card must not recreate it.
    const action = initialAction ?? (saved.length === 0 ? createEmptyAction() : null);
    return action ? { base: saved, actions: [...saved, action] } : null;
  });
  const [focusId, setFocusId] = useState<string | null>(() => edit?.actions.at(-1)?.id ?? null);
  const actions = edit?.actions ?? saved;
  const change = (update: (current: readonly TerminalAction[]) => TerminalAction[]) => {
    setEdit((current) => ({ base: current?.base ?? saved, actions: update(current?.actions ?? saved) }));
  };

  return {
    actions,
    focusId,
    dirty: edit !== null && !sameTerminalActions(actions, edit.base),
    valid: actions.every((action) => action.name.trim() && action.command.trim()),
    add() {
      const action = createEmptyAction();
      change((current) => [...current, action]);
      setFocusId(action.id);
    },
    update(action: TerminalAction) {
      change((current) => current.map((item) => item.id === action.id ? action : item));
    },
    remove(id: string) {
      change((current) => current.filter((item) => item.id !== id));
    },
    save() {
      if (!persist(actions, edit?.base ?? saved)) return false;
      setEdit(null);
      return true;
    },
  };
}
