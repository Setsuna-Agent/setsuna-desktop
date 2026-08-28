import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  deleteMcpServer,
  discoverMcpServerTools,
  loginMcpServer,
  logoutMcpServer,
  mcpControlCapability,
  mcpFeature,
  mcpRuntimeHostCapability,
  mcpRuntimeToolServiceCapability,
  readMcpServers,
  saveMcpServer,
  updateMcpServer,
} from '../contracts/index.js';
import { McpControlService } from './mcp-control-service.js';
import { McpRuntimeToolServiceImpl } from './mcp-runtime-tool-service.js';
import { McpOAuthCoordinator } from './adapters/sdk/mcp-oauth-coordinator.js';
import { SdkMcpConnectionManager } from './adapters/sdk/sdk-mcp-connection-manager.js';
import { SdkMcpProtocolAdapter } from './adapters/sdk/sdk-mcp-protocol-adapter.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(mcpRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

/**
 * MCP Feature：持有 SDK client、连接缓存、配置事务与 Agent MCP 工具。
 *
 * setup 只启动 idle cleanup timer，不建立任何 MCP 连接；只有 discover/list/
 * call/snapshot/login 等操作才会触碰连接。SDK manager 的 shutdown 通过
 * `context.scope.add()` 注册，使 FeatureScope 成为唯一的关闭 owner。
 */
export const mcpRuntimeFeature = defineRuntimeFeature({
  definition: mcpFeature,
  dependencies,
  provides: [
    declareCapabilityProvider(mcpControlCapability),
    declareCapabilityProvider(mcpRuntimeToolServiceCapability),
  ],
  setup(context) {
    const { host, routes } = context.dependencies;
    const oauth = new McpOAuthCoordinator(
      host.credentials,
      host.openExternal,
      undefined,
      host.fetch,
    );
    const manager = new SdkMcpConnectionManager({
      credentials: host.credentials,
      openExternal: host.openExternal,
      oauthCoordinator: oauth,
      elicitation: host.elicitation,
      fetchImpl: host.fetch,
      resolveNetworkEnvironment: async () => {
        const env = await host.resolveNetworkEnvironment();
        return env;
      },
    });
    context.scope.add(() => manager.shutdown());

    const protocol = new SdkMcpProtocolAdapter(manager);
    const control = new McpControlService(host.store, protocol);
    const toolService = new McpRuntimeToolServiceImpl(control, host.store);

    routes.register(context.scope, readMcpServers, () => (
      preserveMcpOperationError(() => control.listServers({ includeAuthStatus: true }))
    ));
    routes.register(context.scope, discoverMcpServerTools, (input, { signal }) => (
      preserveMcpOperationError(() => control.discoverTools(input, { signal }))
    ));
    routes.register(context.scope, saveMcpServer, (input) => (
      preserveMcpOperationError(async () => {
        await control.upsertServer(input);
        return control.listServers({ includeAuthStatus: true });
      })
    ));
    routes.register(context.scope, updateMcpServer, (input) => (
      preserveMcpOperationError(async () => {
        await control.updateServer(input.serverKey, input.patch);
        return control.listServers({ includeAuthStatus: true });
      })
    ));
    routes.register(context.scope, deleteMcpServer, (input) => (
      preserveMcpOperationError(async () => {
        await control.deleteServer(input.serverKey);
        return control.listServers({ includeAuthStatus: true });
      })
    ));
    routes.register(context.scope, loginMcpServer, (input, { signal }) => (
      preserveMcpOperationError(async () => {
        await control.login(input.serverKey, { signal });
        return control.listServers({ includeAuthStatus: true });
      })
    ));
    routes.register(context.scope, logoutMcpServer, (input) => (
      preserveMcpOperationError(async () => {
        await control.logout(input.serverKey);
        return control.listServers({ includeAuthStatus: true });
      })
    ));

    context.provide(declareCapabilityProvider(mcpControlCapability), control);
    context.provide(declareCapabilityProvider(mcpRuntimeToolServiceCapability), toolService);
  },
});

async function preserveMcpOperationError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FeatureOperationFailure) throw error;
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : 'MCP operation failed.';
    throw new FeatureOperationFailure({
      code: message.startsWith('MCP server not found:')
        ? 'MCP_SERVER_NOT_FOUND'
        : 'MCP_OPERATION_FAILED',
      message,
      retryable: false,
    });
  }
}
