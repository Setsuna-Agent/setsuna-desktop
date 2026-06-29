import type { RuntimeMcpServerInput, RuntimeMcpServerList, RuntimeMcpServerPatch } from '@setsuna-desktop/contracts';

export type McpStore = {
  listServers(): Promise<RuntimeMcpServerList>;
  listServerInputs(): Promise<RuntimeMcpServerInput[]>;
  upsertServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList>;
  updateServer(key: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList>;
  deleteServer(key: string): Promise<void>;
};
