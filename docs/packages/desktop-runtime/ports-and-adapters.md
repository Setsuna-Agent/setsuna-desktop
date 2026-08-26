# Ports 与 Adapters

源码：

- `packages/desktop-runtime/src/ports/`
- `packages/desktop-runtime/src/adapters/`
- `packages/desktop-runtime/src/runtime/`

Runtime 的核心业务依赖 port；文件、网络、模型、MCP 和平台实现放 adapter。`runtime-factory.ts` 负责把两者接起来。

## Port 分类

### 状态与持久化

- `ThreadStore`
- `ConfigStore`
- `AttachmentStore`
- `GeneratedImageStore`
- `UsageRecorder`（Core 只需要 append 能力，查询/存储归 Usage Feature）
- Memory Feature contracts 中的 `MemoryStore`（由 desktop runtime 提供文件 adapter）
- `McpStore`
- `SkillRegistry`
- `PluginBundleStore`
- `PluginMarketplace`
- `PersistentToolApprovalStore`
- `PolicyAmendmentStore`

### 执行能力

- `ModelClient`
- `ToolHost`
- `ApprovalGate`
- `McpClientRuntime`
- `BackgroundShellProcessManager`
- `WorkspaceDependencyManager`

### Workspace/context

- `WorkspaceProjectStore`
- `WorkspaceSearchEngine`
- `RuntimeEnvironmentResolver`
- `ProjectInstructionLoader`
- `ProjectWorkflowResolver`

### 基础设施

- `EventBus`
- `AppServerNotificationBus`
- `RuntimeDebugTraceSink`（由 Conversation Debug Feature control 绑定）
- `Clock`
- `IdGenerator`
- `SecretStore` / `DesktopNativeBridge`
- `SandboxExecutionPlan`

## Port 设计规则

- 描述 runtime 需要的最小能力，不复制 adapter API。
- 使用 contracts 或 runtime 内部稳定 DTO。
- 明确 timeout/cancel/stream/cleanup。
- 不泄漏具体 JSON path、SQLite row 或 SDK client。
- Read/write 边界要能测试。
- 高频聚合读取使用窄 projection；不得为了少量状态反复克隆完整 thread snapshot。
- Optional capability 用明确 optional method/dependency，不靠捕获 `MODULE_NOT_FOUND`。

## Runtime factory

`src/runtime/runtime-factory.ts` 组装顺序大致为：

1. Clock、IDs、event/debug/notification buses、approval gate。
2. Thread/attachment/image/config/MCP/policy stores，Usage recorder proxy，以及提供给 Memory Feature 的 store adapter。
3. Event writer 与 `EventCoordinatedThreadStore`。
4. MCP connection 与 elicitation。
5. Skill registry 和 MCP dependency wrapper。
6. Plugin store 与 marketplace。
7. Workspace search/project/dependency/environment/instruction/workflow。
8. Browser/native bridge。
9. Tool hosts 与 `CompositeToolHost`。
10. Configured model client + image asset resolver。
11. AgentLoop 与 Runtime Feature composition；Feature control 激活后绑定到 Core facade/tool adapter。

Factory 接受 data root、builtin Skill/Plugin 和 bundled ripgrep 等 options。测试可以替换端口，生产路径不使用全局 singleton。

## Event-coordinated thread store

`runtime/event-coordinated-thread-store.ts` 包装持久化 ThreadStore：

- 把 event writer 与 generated image cleanup 等跨 store 副作用收敛。
- 保持 AgentLoop 只依赖一个 thread facade。
- 透传 active turn 的有界 activity projection，供 Runtime Activity Feature 轮询而不复制消息历史。
- 删除/截断时协调相关 managed asset。

它不是第二个持久化 store。

## Adapter 目录

| 目录 | 实现 |
| --- | --- |
| `adapters/store/` | SQLite、JSON、attachments、images、config、MCP、memory、policy |
| `adapters/feature/` | Feature host adapter 与激活后绑定 proxy，包括 `BindableUsageRecorder` |
| `adapters/model/` | AI SDK/provider clients、stream/replay/discovery |
| `adapters/tool/` | ToolHost implementations |
| `adapters/mcp/` | SDK connection、OAuth、elicitation、result normalize |
| `adapters/skill/` | File Skill registry 与 MCP dependency |
| `adapters/plugin/` | Bundle store、manifest model、marketplace |
| `adapters/workspace/` | Project store、environment、instructions、workflow、dependencies |
| `adapters/search/` | Ripgrep/JS search、policy、supersession |
| `adapters/browser/` | Main browser control HTTP client |
| `adapters/native/` | Main native bridge HTTP client |
| `adapters/approval/` | In-memory approval gate |
| `adapters/event/` | In-memory buses |
| `adapters/debug/` | In-memory trace store |
| `adapters/id/` | Random ID |

## In-memory 不等于不重要

以下状态进程重启后消失是设计的一部分：

- Pending approval waiters。
- Live event subscribers。
- App-server notification subscribers。
- Debug traces。
- Active MCP connections。

但对应的用户可见长期状态必须通过 thread/config/store 持久化。比如 approval request event 可以恢复 UI，而等待中的 Promise 不能跨进程恢复。

## Search adapter

`createWorkspaceSearchEngine()`：

- Packaged 优先要求 main 注入的 bundled ripgrep。
- 测试/受限环境可使用 JavaScript fallback。
- Policy 统一排除 VCS/generated、secret 文件和 sandbox deny path。
- Ripgrep 使用固定参数，不读取机器全局 config。
- Supersession 只取消相同 workspace + `supersedeKey` 的旧搜索。

Project panel 可以 latest-wins；Agent 并行 `search_text` 不应互相取消。

## Native adapter

Runtime 不能 import Electron：

- Browser Feature 在自身 contracts 中定义 `BrowserControlPort`，并在 runtime 入口使用 `HttpBrowserControlClient`。
- Credential/open external 使用 `HttpDesktopNativeBridge`。
- 地址和 token 从 main 注入环境。
- Port 只暴露固定动作。

如果新增 Browser 动作，在 `packages/features/browser` 内同步扩展窄 loopback protocol 和 port；其他必须由 main 持有的能力仍按其 owner 建立窄 bridge，不要把 Electron 放进 runtime。

## 新增 port/adapter

1. 在 `src/ports/` 定义最小 contract。
2. 在 core/coordinator 注入 port。
3. 在 `src/adapters/<domain>/` 实现。
4. 在 factory 唯一组装。
5. 定义 shutdown/recovery。
6. Adapter 单元测试覆盖边界和 I/O。
7. Core 测试用 fake port 验证业务，不依赖真实文件/网络。
8. 必要时增加 integration 验证 wiring。

如果只有一个纯函数且没有外部边界，不需要为了形式创建 port。

## 反模式

- Route 直接 `readFile(config.json)`。
- AgentLoop 直接 new provider SDK。
- Adapter import renderer/main。
- Port 暴露 `Database`/`Response`/SDK raw object。
- 多个模块各自创建 ThreadStore。
- 测试通过修改生产全局 singleton 注入依赖。
- Adapter 把未经清洗的外部 payload直接写 event。

## 测试

- `test/runtime/runtime-factory.test.ts` 验证 wiring。
- `test/runtime/event-coordinated-thread-store.test.ts`。
- `test/adapters/<domain>/`。
- `test/integration/adapters/`。
- Core/loop tests 使用 support fake/harness。
