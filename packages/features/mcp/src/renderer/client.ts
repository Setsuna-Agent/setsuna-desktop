import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import type {
  RuntimeMcpServerInput,
  RuntimeMcpServerPatch,
} from '@setsuna-desktop/contracts';
import {
  deleteMcpServer,
  discoverMcpServerTools,
  loginMcpServer,
  logoutMcpServer,
  readMcpServers,
  saveMcpServer,
  updateMcpServer,
} from '../contracts/index.js';

type OperationOptions = Readonly<{ signal?: AbortSignal }>;

export function createMcpRendererClient(transport: FeatureOperationTransport) {
  return Object.freeze({
    deleteServer: (serverKey: string, options?: OperationOptions) => (
      transport.call(deleteMcpServer, { serverKey }, options)
    ),
    discoverTools: (input: RuntimeMcpServerInput, options?: OperationOptions) => (
      transport.call(discoverMcpServerTools, input, options)
    ),
    login: (serverKey: string, options?: OperationOptions) => (
      transport.call(loginMcpServer, { serverKey }, options)
    ),
    logout: (serverKey: string, options?: OperationOptions) => (
      transport.call(logoutMcpServer, { serverKey }, options)
    ),
    readServers: (options?: OperationOptions) => (
      transport.call(readMcpServers, undefined, options)
    ),
    saveServer: (input: RuntimeMcpServerInput, options?: OperationOptions) => (
      transport.call(saveMcpServer, input, options)
    ),
    updateServer: (
      serverKey: string,
      patch: RuntimeMcpServerPatch,
      options?: OperationOptions,
    ) => transport.call(updateMcpServer, { patch, serverKey }, options),
  });
}

export type McpRendererClient = ReturnType<typeof createMcpRendererClient>;
