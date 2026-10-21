import { normalizeTerminalAction, type TerminalAction } from '../../contracts/index.js';

export const TERMINAL_ACTIONS_CHANGED = 'setsuna:terminal-actions-changed';
export type TerminalActionSettings = { actions: TerminalAction[]; selectedId: string | null };
type ActionStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function terminalActionsStorageKey(projectId: string): string {
  return `setsuna.desktop.terminal.actions.v1:${projectId}`;
}

export function readTerminalActions(projectId: string, storage: ActionStorage = window.localStorage): TerminalActionSettings {
  const raw = storage.getItem(terminalActionsStorageKey(projectId));
  if (!raw) return { actions: [], selectedId: null };
  const value = JSON.parse(raw) as Partial<TerminalActionSettings> | null;
  if (!value || !Array.isArray(value.actions)) throw new Error('Invalid terminal actions.');
  const ids = new Set<string>();
  const actions = value.actions.map((item) => {
    const command = normalizeTerminalAction(item);
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('Invalid terminal action identity.');
    ids.add(item.id);
    return { ...command, id: item.id };
  });
  return { actions, selectedId: actions.find((item) => item.id === value.selectedId)?.id ?? actions[0]?.id ?? null };
}

export function sameTerminalActions(left: readonly TerminalAction[], right: readonly TerminalAction[]): boolean {
  return left.length === right.length && left.every((action, index) => {
    const other = right[index]!;
    return action.id === other.id && action.name === other.name && action.command === other.command
      && action.icon === other.icon && action.platform === other.platform;
  });
}

export class TerminalActionsConflict extends Error {}

export function changeTerminalActions(
  projectId: string,
  change: (current: TerminalActionSettings) => TerminalActionSettings,
  storage: ActionStorage = window.localStorage,
): TerminalActionSettings {
  // Re-read at mutation time to preserve edits from other panels. Invalid saved
  // data fails closed instead of replacing a user's scripts with an empty list.
  const next = change(readTerminalActions(projectId, storage));
  storage.setItem(terminalActionsStorageKey(projectId), JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(TERMINAL_ACTIONS_CHANGED, { detail: projectId }));
  return next;
}
