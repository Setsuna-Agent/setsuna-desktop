import { useSyncExternalStore } from 'react';

export type AppContext = Readonly<{
  pluginId: string;
  contributionId: string;
  surface: 'renderer.plugin.page';
  projectId?: string;
  threadId?: string;
  cwd?: string;
}>;
export type AppSnapshot<Data = Record<string, unknown>> = Readonly<{ data: Data; context: AppContext }>;
export type AppRuntimeRequest = Readonly<{
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  body?: unknown;
}>;
export type AppRuntimeResponse<Data = unknown> = Readonly<{ ok: boolean; status: number; data: Data }>;

/** This is the existing document bridge; SDK helpers never grant additional host capabilities. */
type DocumentBridge = {
  ready: Promise<unknown>;
  getSnapshot(): AppSnapshot;
  subscribe(listener: () => void): () => void;
  invoke(actionId: string, payload: unknown): Promise<unknown>;
  runtime: { request(input: unknown): Promise<unknown> };
};

function documentBridge(): DocumentBridge {
  const bridge = (window as unknown as { setsunaUI?: DocumentBridge }).setsunaUI;
  if (!bridge) throw new Error('This application requires the Setsuna page bridge.');
  return bridge;
}

const subscribe = (listener: () => void) => documentBridge().subscribe(listener);
const snapshot = () => documentBridge().getSnapshot();

export function useAppSnapshot<Data = Record<string, unknown>>(): AppSnapshot<Data> {
  return useSyncExternalStore(subscribe, snapshot) as AppSnapshot<Data>;
}

export function useAppData<Data = Record<string, unknown>>(): Data { return useAppSnapshot<Data>().data; }
export function useAppContext(): AppContext { return useAppSnapshot().context; }
export async function invokeAction(actionId: string, payload: unknown = {}): Promise<void> {
  await documentBridge().invoke(actionId, payload);
}
export function requestRuntime<Data = unknown>(input: AppRuntimeRequest): Promise<AppRuntimeResponse<Data>> {
  return documentBridge().runtime.request(input) as Promise<AppRuntimeResponse<Data>>;
}
