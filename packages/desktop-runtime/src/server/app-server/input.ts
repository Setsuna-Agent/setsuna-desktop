import { AppServerRpcError } from './errors.js';

export function requiredString(value: unknown, name: string): string {
  const text = stringInput(value);
  if (!text) throw new AppServerRpcError(-32602, `Missing required parameter: ${name}`);
  return text;
}

export function requiredPositiveInteger(value: unknown, name: string): number {
  const numeric = numericInput(value);
  if (numeric === undefined || numeric < 1 || !Number.isInteger(numeric)) {
    throw new AppServerRpcError(-32602, `${name} must be >= 1`);
  }
  return numeric;
}

export function requiredArray(value: unknown, name: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new AppServerRpcError(-32602, `${name} must be an array`);
}

export function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function requiredRawString(value: unknown, name: string): string {
  if (typeof value === 'string') return value;
  throw new AppServerRpcError(-32602, `Missing required parameter: ${name}`);
}

export function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function numericInput(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function stringInput(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
