import { APP_SERVER_DEFAULT_CONNECTION_ID } from './command-exec.js';
import { recordInput } from './input.js';

export type AppServerConnectionRegistry = {
  initialize(connectionId: string | undefined, params: unknown): void;
  experimentalApi(connectionId: string | undefined): boolean;
  terminateConnection(connectionId: string | undefined): void;
};

export function createAppServerConnectionRegistry(): AppServerConnectionRegistry {
  const capabilitiesByConnection = new Map<string, { experimentalApi: boolean }>();
  return {
    initialize(connectionId, params) {
      const input = recordInput(params);
      const capabilities = recordInput(input.capabilities);
      capabilitiesByConnection.set(normalizeAppServerConnectionId(connectionId), {
        experimentalApi: capabilities.experimentalApi === true || capabilities.experimental_api === true,
      });
    },
    experimentalApi(connectionId) {
      return capabilitiesByConnection.get(normalizeAppServerConnectionId(connectionId))?.experimentalApi === true;
    },
    terminateConnection(connectionId) {
      capabilitiesByConnection.delete(normalizeAppServerConnectionId(connectionId));
    },
  };
}

export function normalizeAppServerConnectionId(connectionId: string | undefined): string {
  const normalized = connectionId?.trim();
  return normalized || APP_SERVER_DEFAULT_CONNECTION_ID;
}
