import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export type DesktopTerminalSession = Readonly<{
  sessionId: string;
  workspaceRoot: string;
  shell: string;
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
  open(workspaceRoot?: string | null, cols?: number, rows?: number): Promise<DesktopTerminalSession>;
  write(sessionId: string, input: string): Promise<boolean>;
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
  major: 1,
  description: 'Host-managed process environment for native terminal sessions',
});

export const terminalEventPublisherCapability: CapabilityToken<TerminalEventPublisher> = defineCapability({
  id: 'terminal.event-publisher',
  major: 1,
  description: 'Narrow host bridge for publishing native terminal events to the renderer',
});
