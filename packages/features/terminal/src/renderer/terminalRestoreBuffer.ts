const terminalRestoreBuffers = new Map<string, string>();
const terminalLastEventSeqs = new Map<string, number>();
const exitedTerminalSessionIds = new Set<string>();
const MAX_TERMINAL_RESTORE_BUFFER = 1_000_000;

export function clearTerminalRestoreBuffer(sessionId: string): void {
  terminalRestoreBuffers.delete(sessionId);
  terminalLastEventSeqs.delete(sessionId);
  exitedTerminalSessionIds.delete(sessionId);
}

export function appendTerminalRestoreBuffer(sessionId: string, text: string): void {
  if (!text) return;
  const next = `${terminalRestoreBuffers.get(sessionId) ?? ''}${text}`;
  terminalRestoreBuffers.set(
    sessionId,
    next.length > MAX_TERMINAL_RESTORE_BUFFER ? next.slice(-MAX_TERMINAL_RESTORE_BUFFER) : next,
  );
}

export function terminalRestoreBuffer(sessionId: string): string | undefined {
  return terminalRestoreBuffers.get(sessionId);
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
