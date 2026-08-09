import type { RuntimeExtensionEventName } from '@setsuna-desktop/contracts';

export type ExtensionWorkerTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type HostToExtensionWorkerMessage =
  | { type: 'request'; id: string; method: 'tool.execute' | 'event.dispatch'; params: unknown }
  | { type: 'cancel'; requestId: string }
  | { type: 'host.cancel'; parentId: string }
  | { type: 'host.response'; id: string; ok: true; result: unknown }
  | { type: 'host.response'; id: string; ok: false; error: string }
  | { type: 'shutdown' };

export type ExtensionWorkerToHostMessage =
  | { type: 'ready'; tools: ExtensionWorkerTool[]; events: RuntimeExtensionEventName[] }
  | { type: 'response'; id: string; ok: true; result: unknown }
  | { type: 'response'; id: string; ok: false; error: string }
  | { type: 'host.request'; id: string; parentId: string; method: string; params: unknown }
  | { type: 'fatal'; error: string };

export function protocolRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
