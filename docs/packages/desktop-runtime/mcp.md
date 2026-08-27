# MCP Feature

MCP 的协议实现与 Agent 工具业务位于 `packages/features/mcp/`。Desktop runtime 只保留持久化、本机能力、审批事件以及与现有 REST/App Server/ToolHost 的兼容适配。

## 所有权

```text
desktop-runtime composition
  ├── FileMcpStore
  ├── credential store / proxy fetch / openExternal
  ├── McpElicitationCoordinator
  └── bindable control + ToolHost adapter
         ↓
feature-mcp/runtime
  ├── SDK connection / stdio / streamable HTTP
  ├── OAuth / callback
  ├── tools / resources / result normalization
  └── McpControl + McpRuntimeToolService
```

`@modelcontextprotocol/sdk` 只能由 `packages/features/mcp` 依赖。Feature 的公共 runtime export 只有 `mcpRuntimeFeature`；SDK manager、OAuth coordinator 和协议适配器都是包内实现。

## Contracts 与 Capability

`packages/features/mcp/src/contracts/` 定义：

- `McpRuntimeHost`：store、凭据、代理网络环境、外部 URL 与 elicitation 的窄宿主输入。
- `McpControl`：server 配置事务、OAuth、tools/resources、snapshot、thread release。
- `McpRuntimeToolService`：Agent ToolHost 需要的工具目录、prompt、preview、执行与进度。

配置写入由 `McpControlService` 收口：写 store 后只失效一次对应连接。调用方只传 `serverKey` 或线程上下文，不传 SDK connection scope；discovery、status、resource 与 thread scope 由 feature 内部生成。

## Runtime 组合与生命周期

`runtime-factory.ts` 创建 `FileMcpStore`、`McpElicitationCoordinator`、`BindableMcpControl` 和 `McpToolHostAdapter`。`runtime-feature-composition.ts` 向 required `mcpRuntimeFeature` 提供宿主 capability，并在激活后绑定 control/tool service。

Feature setup 只创建 manager 和 idle cleanup timer，不主动连接 server。连接由 discover/list/call/snapshot/login 首次触发；manager shutdown 登记在 `FeatureScope`，所以 server 关闭只 dispose feature composition，不直接持有 SDK manager。

同一个 `ToolExecutionContext` 会映射为稳定的 feature context，保证模型看到的 `mcp__server__tool` 在 preview/run 阶段仍指向同一工具。SDK progress 经 `onProgress` 转换为常规 tool output delta。

## 宿主兼容面

- `/v1/mcp/*` 路径和 response DTO 不变，由 route 调用 `McpControl`。
- App Server 的 reload/login/logout 调用同一 control。
- Skill/Plugin coordinator 依赖 feature contracts，并继续使用宿主 store 完成原有安装事务。
- renderer 的 Capabilities MCP 页面、client 和 `mcp.json` 格式/位置不变。
- elicitation 仍由 desktop runtime 接入 approval/event；URL elicitation 由 feature 打开系统 URL 后等待完成通知。

MCP server 的启用状态和 allow/deny 工具范围是执行边界。工具结果、resource 和 server instructions 始终按外部不可信上下文处理。

## 验证

- `packages/features/mcp/test/`：SDK transport、OAuth、elicitation、control 事务、Tool service 与 Feature lifecycle。
- `packages/desktop-runtime/test/adapters/mcp/`：宿主 bindable/control 与 elicitation 适配。
- `packages/desktop-runtime/test/integration/runtime-server/mcp.test.ts`：REST、headers/env、resources、tools 与配置兼容。

静态验收要求 `packages/desktop-runtime` 中没有 `@modelcontextprotocol/sdk` import，Feature 实现只由 runtime composition root 通过公开 runtime 入口装配。
