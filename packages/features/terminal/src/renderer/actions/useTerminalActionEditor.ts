import { useState } from 'react';
import type { TerminalAction } from '../../contracts/index.js';

type ActionEditor = {
  action: TerminalAction;
  base: readonly TerminalAction[];
  creating: boolean;
};

export function useTerminalActionEditor(
  saved: readonly TerminalAction[],
  persist: (actions: readonly TerminalAction[], base: readonly TerminalAction[]) => boolean,
  initialAction?: TerminalAction,
) {
  const [editing, setEditing] = useState<ActionEditor | null>(() => initialAction
    ? { action: initialAction, base: saved, creating: true } : null);
  const commit = (actions: TerminalAction[]) => {
    if (!editing || !persist(actions, editing.base)) return false;
    setEditing(null);
    return true;
  };

  return {
    editing,
    add() {
      setEditing({
        action: { id: crypto.randomUUID(), name: '', command: '', icon: 'settings', platform: 'all' },
        base: saved,
        creating: true,
      });
    },
    open(action: TerminalAction) {
      // Keep the snapshot from opening the editor so later external edits cannot
      // silently replace the user's script when Save or Delete is confirmed.
      setEditing({ action, base: saved, creating: false });
    },
    close() { setEditing(null); },
    save(value: Omit<TerminalAction, 'id'>) {
      if (!editing) return false;
      const action = { ...value, id: editing.action.id };
      return commit(editing.creating ? [...editing.base, action]
        : editing.base.map((item) => item.id === action.id ? action : item));
    },
    remove() {
      if (!editing || editing.creating) return false;
      return commit(editing.base.filter((item) => item.id !== editing.action.id));
    },
  };
}
