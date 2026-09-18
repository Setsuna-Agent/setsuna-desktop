import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export type DesktopTerminalSession = Readonly<{
  sessionId: string;
  workspaceRoot: string;
  shell: string;
  cols: number;
  rows: number;
  windowsPty?: Readonly<{ backend: 'conpty' | 'winpty'; buildNumber: number }>;
}>;

export type DesktopTerminalEvent = Readonly<{
  seq: number;
  event: 'ready' | 'output' | 'exit' | 'closed' | 'error';
  data: Readonly<Record<string, unknown>>;
}>;

export type DesktopTerminalEventPayload = DesktopTerminalEvent & Readonly<{
  sessionId: string;
}>;

export interface TerminalDesktopBridge {
  /** Prepares a session; the shell starts after the renderer attaches at its actual size. */
  open(workspaceRoot?: string | null, cols?: number, rows?: number): Promise<DesktopTerminalSession>;
  attach(sessionId: string, cols: number, rows: number): Promise<boolean>;
  write(sessionId: string, input: string): Promise<boolean>;
  /** Returns a non-destructive snapshot of bounded history; consumers deduplicate by seq. */
  read(sessionId: string): Promise<DesktopTerminalEvent[]>;
  resize(sessionId: string, cols: number, rows: number): Promise<boolean>;
  restart(sessionId: string, cols?: number, rows?: number): Promise<boolean>;
  close(sessionId: string): Promise<boolean>;
  onEvent(sessionId: string, callback: (event: DesktopTerminalEvent) => void): () => void;
}

export type TerminalPreloadBridgeContribution = Readonly<{
  terminal: TerminalDesktopBridge;
}>;

export const TERMINAL_IPC_CHANNELS = Object.freeze({
  open: 'terminal:open',
  attach: 'terminal:attach',
  write: 'terminal:write',
  read: 'terminal:read',
  resize: 'terminal:resize',
  restart: 'terminal:restart',
  close: 'terminal:close',
  event: 'terminal:event',
} as const);

export type TerminalEnvironmentPatch = Readonly<Record<string, string | null>>;

export interface TerminalEnvironmentProvider {
  resolve(): Promise<TerminalEnvironmentPatch>;
}

export interface TerminalEventPublisher {
  publish(event: DesktopTerminalEventPayload): void;
}

export const terminalEnvironmentCapability: CapabilityToken<TerminalEnvironmentProvider> = defineCapability({
  id: 'terminal.environment',
  description: 'Host-managed process environment for native terminal sessions',
});

export const terminalEventPublisherCapability: CapabilityToken<TerminalEventPublisher> = defineCapability({
  id: 'terminal.event-publisher',
  description: 'Narrow host bridge for publishing native terminal events to the renderer',
});
