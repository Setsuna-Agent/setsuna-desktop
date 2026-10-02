import type { ComputerAction, ComputerCommand } from './index.js';

/** Wire contract of the narrow Windows native helper (no paths or shell commands). */
export type WindowsInputRequest =
  | { kind: 'probe' | 'authorize' | 'end-session' | 'shutdown' }
  | { kind: 'start'; elevate: boolean }
  | { kind: 'action'; action: ComputerAction; frame: { width: number; height: number; screenWidth: number; screenHeight: number } };

// UAC can wait for human consent. The cancellation signal still stops admission
// immediately; observation freshness remains 30 seconds on both platforms.
export function computerCommandTimeout(kind: ComputerCommand['kind'], platform: string): number {
  return platform === 'win32' && (kind === 'start' || kind === 'action') ? 120_000 : 30_000;
}
