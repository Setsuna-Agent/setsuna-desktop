/** Identifies the live editor command that owns a confirmed native file operation. */
export type DesignCommandKey = Readonly<{ sessionId: string; id: string }>;

export function readDesignCommandKey(value: unknown): DesignCommandKey | undefined {
  if (value === undefined) return;
  if (value && typeof value === 'object' && 'sessionId' in value && 'id' in value
    && typeof value.sessionId === 'string' && value.sessionId && typeof value.id === 'string' && value.id) return { sessionId: value.sessionId, id: value.id };
  throw new Error('Invalid design command identity.');
}

export function designCommandQuery(command?: DesignCommandKey): { sessionId?: string; commandId?: string } {
  return command ? { sessionId: command.sessionId, commandId: command.id } : {};
}

export function designCommandFromQuery(value: { sessionId?: unknown; commandId?: unknown; command?: unknown }) {
  if (value.command !== undefined) throw new Error('Expected separate sessionId and commandId query parameters.');
  if (value.sessionId === undefined && value.commandId === undefined) return undefined;
  return readDesignCommandKey({ sessionId: value.sessionId, id: value.commandId });
}
