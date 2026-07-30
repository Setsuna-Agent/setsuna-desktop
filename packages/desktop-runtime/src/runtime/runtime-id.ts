import { randomUUID } from 'node:crypto';

export function randomRuntimeId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
}
