export type TerminalGrid = Readonly<{ cols: number; rows: number }>;
export type TerminalRestoreEntry =
  | Readonly<{ type: 'output'; text: string }>
  | Readonly<{ type: 'resize'; cols: number; rows: number }>;
export type TerminalRestoreBuffer = Readonly<{
  initialGrid: TerminalGrid;
  entries: readonly TerminalRestoreEntry[];
  /** Acknowledged PTY events that have not yet been consumed by xterm. */
  pendingEntries: readonly TerminalRestoreEntry[];
}>;

type RestoreState = {
  initialGrid: TerminalGrid;
  currentGrid: TerminalGrid;
  entries: TerminalRestoreEntry[];
  pendingEntries: TerminalRestoreEntry[];
  textLength: number;
};

const terminalRestoreBuffers = new Map<string, RestoreState>();
const terminalLastEventSeqs = new Map<string, number>();
const exitedTerminalSessionIds = new Set<string>();
const MAX_TERMINAL_RESTORE_BUFFER = 1_000_000;
const MAX_TERMINAL_RESTORE_ENTRIES = 4_096;

export function initializeTerminalRestoreBuffer(sessionId: string, grid: TerminalGrid): void {
  if (terminalRestoreBuffers.has(sessionId)) return;
  terminalRestoreBuffers.set(sessionId, { initialGrid: grid, currentGrid: grid, entries: [], pendingEntries: [], textLength: 0 });
}

export function clearTerminalRestoreBuffer(sessionId: string): void {
  terminalRestoreBuffers.delete(sessionId);
  terminalLastEventSeqs.delete(sessionId);
  exitedTerminalSessionIds.delete(sessionId);
}

export function appendTerminalRestoreBuffer(sessionId: string, entry: TerminalRestoreEntry): void {
  const state = terminalRestoreBuffers.get(sessionId);
  // Closing a panel explicitly clears the cache before React runs cleanup.
  if (!state) return;
  const last = state.entries.at(-1);
  if (entry.type === 'output') {
    if (!entry.text) return;
    state.textLength += entry.text.length;
    if (last?.type === 'output' && last.text.length + entry.text.length <= 32_768) {
      state.entries[state.entries.length - 1] = { type: 'output', text: last.text + entry.text };
    } else state.entries.push(entry);
  } else {
    if (state.currentGrid.cols === entry.cols && state.currentGrid.rows === entry.rows) return;
    state.currentGrid = { cols: entry.cols, rows: entry.rows };
    state.entries.push(entry);
  }
  trimRestoreBuffer(state);
}

export function terminalRestoreBuffer(sessionId: string): TerminalRestoreBuffer | undefined {
  const state = terminalRestoreBuffers.get(sessionId);
  return state ? {
    initialGrid: state.initialGrid,
    entries: state.entries.slice(),
    pendingEntries: state.pendingEntries.slice(),
  } : undefined;
}

export function retainTerminalPendingEntries(sessionId: string, entries: readonly TerminalRestoreEntry[]): void {
  const state = terminalRestoreBuffers.get(sessionId);
  // Unlike parsed scrollback, these events cannot be discarded: sequence
  // deduplication prevents Main from delivering their unanswered queries again.
  if (state) state.pendingEntries = entries.slice();
}

function trimRestoreBuffer(state: RestoreState): void {
  while (state.textLength > MAX_TERMINAL_RESTORE_BUFFER || state.entries.length > MAX_TERMINAL_RESTORE_ENTRIES) {
    const first = state.entries[0];
    if (first.type === 'resize') {
      // Retained bytes must start on the grid active at the truncation boundary.
      state.initialGrid = { cols: first.cols, rows: first.rows };
      state.entries.shift();
    } else {
      const remove = state.entries.length > MAX_TERMINAL_RESTORE_ENTRIES
        ? first.text.length
        : Math.min(first.text.length, state.textLength - MAX_TERMINAL_RESTORE_BUFFER);
      state.textLength -= remove;
      if (remove === first.text.length) state.entries.shift();
      else state.entries[0] = { type: 'output', text: first.text.slice(remove) };
    }
  }
  let first = state.entries[0];
  while (first?.type === 'resize') {
    state.initialGrid = { cols: first.cols, rows: first.rows };
    state.entries.shift();
    first = state.entries[0];
  }
}

export function terminalLastEventSeq(sessionId: string): number {
  return terminalLastEventSeqs.get(sessionId) ?? 0;
}

export function recordTerminalEventSeq(sessionId: string, seq: number): void {
  terminalLastEventSeqs.set(sessionId, seq);
}

export function terminalSessionExited(sessionId: string): boolean {
  return exitedTerminalSessionIds.has(sessionId);
}

export function markTerminalSessionExited(sessionId: string, exited: boolean): void {
  if (exited) exitedTerminalSessionIds.add(sessionId);
  else exitedTerminalSessionIds.delete(sessionId);
}
