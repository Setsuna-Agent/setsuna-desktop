import type {
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
} from '@setsuna-desktop/contracts';

/**
 * MCP server 配置的持久化读写契约。
 *
 * 该接口只描述宿主已落盘的配置读写，不关心协议连接或 SDK 行为。由
 * desktop-runtime 的 `FileMcpStore` 实现；feature 只依赖此契约来改动配置。
 * `migrateLegacySecrets()` 属于文件适配器的启动迁移职责，不放在此契约里。
 */
export type McpStore = {
  listServers(): Promise<RuntimeMcpServerList>;
  listServerInputs(): Promise<RuntimeMcpServerInput[]>;
  upsertServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList>;
  updateServer(key: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList>;
  deleteServer(key: string): Promise<void>;
};
