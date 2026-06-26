import type { RuntimeMcpServerInput, RuntimeMcpServerList, RuntimeMcpServerPatch } from '@setsuna-desktop/contracts';

export type McpStore = {
  listServers(): Promise<RuntimeMcpServerList>;
  upsertServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList>;
  updateServer(key: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList>;
  deleteServer(key: string): Promise<void>;
};
