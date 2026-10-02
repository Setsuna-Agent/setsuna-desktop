import type { ComputerAction, ComputerCommand, ComputerIdentity, ComputerStopReason } from './index.js';
import { parseComputerKeystroke } from './keyboard.js';

export function record(value: unknown, allowedKeys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  if (allowedKeys && Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error(`Unsupported computer-use field. Allowed fields: ${allowedKeys.join(', ')}.`);
  return value as Record<string, unknown>;
}
export function string(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid computer-use string.');
  return value;
}
function number(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) throw new Error('Invalid computer-use number.');
  return value;
}
export function parseComputerAction(value: unknown): ComputerAction {
  const input = record(value);
  switch (input.kind) {
    case 'click': return { kind: 'click', x: number(input.x, 32768), y: number(input.y, 32768) };
    case 'type': return { kind: 'type', text: string(input.text, 2000) };
    case 'key': return { kind: 'key', ...parseComputerKeystroke(input.key, input.modifiers) };
    case 'scroll': {
      if (input.direction !== 'up' && input.direction !== 'down') throw new Error('Invalid scroll direction.');
      const amount = number(input.amount, 10);
      if (!amount) throw new Error('Scroll amount must be positive.');
      return { kind: 'scroll', x: number(input.x, 32768), y: number(input.y, 32768), direction: input.direction, amount };
    }
    default: throw new Error('Unsupported desktop action.');
  }
}
export function parseComputerCommand(value: unknown): ComputerCommand {
  const input = record(value);
  const source = record(input.identity);
  if ([source.unattended, source.readOnly, source.supportsImages].some((item) => typeof item !== 'boolean')) throw new Error('Trusted execution context is required.');
  const identity: ComputerIdentity = {
    threadId: string(source.threadId), turnId: string(source.turnId),
    unattended: source.unattended as boolean, readOnly: source.readOnly as boolean, supportsImages: source.supportsImages as boolean,
  };
  switch (input.kind) {
    case 'windows': return { kind: 'windows', identity };
    case 'start': return { kind: 'start', identity, ...(input.windowId === undefined ? {} : { windowId: string(input.windowId) }) };
    case 'stop': {
      const reason = input.reason ?? 'requested';
      if (!['requested', 'turn-cleanup', 'tool-failed', 'image-invalid', 'image-delivery-failed'].includes(reason as string)) throw new Error('Unsupported desktop stop reason.');
      return { kind: 'stop', identity, reason: reason as ComputerStopReason };
    }
    case 'screenshot': return { kind: 'screenshot', identity, sessionId: string(input.sessionId) };
    case 'action': {
      record(input, ['kind', 'identity', 'sessionId', 'observationId', 'action']);
      return { kind: 'action', identity, sessionId: string(input.sessionId), observationId: string(input.observationId), action: parseComputerAction(input.action) };
    }
    default: throw new Error('Unsupported desktop command.');
  }
}
