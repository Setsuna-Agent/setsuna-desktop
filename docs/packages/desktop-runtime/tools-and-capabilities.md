# 工具、审批与扩展能力

源码：

- `packages/desktop-runtime/src/loop/tools/`
- `packages/desktop-runtime/src/adapters/tool/`
- `packages/desktop-runtime/src/adapters/{mcp,skill,plugin,search}/`
- `packages/desktop-runtime/src/hooks/`
- `packages/desktop-runtime/src/security/`

工具层把模型 tool call 转成受控本地能力。Schema、路由、预览、审批、权限、执行、输出和事件必须在一条链路中完成。

## ToolHost port

`ports/tool-host.ts` 定义：

- Tool definitions。
- System prompt。
- Runtime profile。
- Preview。
- Approval requirement。
- Execute。
- Output delta。
- External context。
- Turn cleanup。
- Sandbox attempt。

ToolHost 不直接发布 React UI；它返回结构化结果，由 tool executor 写 toolRun events。

## CompositeToolHost

Factory 当前按顺序组合：

1. `UserInputToolHost`
2. `BrowserToolHost`
3. `McpManagementToolHost`
4. `McpRuntimeToolHost`
5. `PluginBundleToolHost`
6. `ExtensionToolHost`
7. `WorkspaceImageToolHost`
8. `ArtifactToolHost`
9. `PcLocalToolHost`
10. `SkillManagementToolHost`
11. `MemoryToolHost`

顺序影响模型看到的定义和 system prompt。新增 host 时检查：

- Tool name 冲突。
- 定义顺序。
- Approval mode。
- Preview。
- Cleanup。
- Plugin/Skill 归因。

## Loop tool pipeline

### `tool-router.ts`

根据名称选择 ToolHost，处理 alias 和不存在的 tool。

### `tool-orchestrator-policy.ts`

保存不依赖事件发布或审批等待的纯策略与参数转换：

- Runtime approval policy。
- Permission profile。
- File mutation。
- Network access。
- Shell risk。
- Persistent approval。
- External context。

### `tool-approval-lifecycle.ts`

统一执行 `create → approval.requested → wait → approval.resolved`。轮次在等待期间取消时，由这一层解析 pending approval，并且只发布一次 cancellation resolution。

普通工具审批、`request_permissions`、network retry 和 sandbox retry 不再各自维护一套 wait/cancel/publish 流程。

### `tool-approval-coordinator.ts`

集中处理：

- Approval requirement 与 PermissionRequest hook。
- Session、turn 和 persistent grant 复用。
- Exec/network policy amendment 持久化。
- Network 与 sandbox retry 的授权决策。

它不执行工具，也不发布工具终态。

### `tool-retry-strategy.ts`

处理 network、sandbox readable-root 和 sandbox bypass 的决策及二次执行。它只接收 output delta 发布能力，并返回 `success/error/rejected` outcome，不能发布工具 terminal event。

窄 readable-root 重试只有再次收到 `sandbox_denied` 时才能升级为 bypass；持久 network deny 不会再次审批或执行。

### `tool-orchestrator.ts`

按统一顺序执行 preview → hook → approval coordinator → tool，并把可重试错误交给 retry strategy。它是 post-process、PostToolUse、output delta flush 和唯一 terminal event 的 owner。

所有 fallible success-side work 与 output delta publish 都必须先完成，之后才能发布 terminal event；strategy 返回成功后发生的后处理错误，也从同一个 terminal 出口结束。

只读工具可以在安全条件下批处理；mutation 不能与依赖相同 workspace 状态的操作无序并行。

### `runtime-tool-call-executor.ts`

连接 AgentLoop 和 orchestrator：

- 发布 tool run events。
- 处理 image asset。
- 收集 result。
- 写模型可见 tool message。
- 触发 hooks。
- 协调 collaboration/goal tools。

### `runtime-user-shell-runner.ts`

处理用户显式 shell action，与模型 tool call 共享环境和 policy，但有独立调用入口。

## PC Local Tools

目录：`adapters/tool/pc-local/`

稳定 facade：`pc-local-tool-host.ts` / `pc-local-tools.ts`。

职责拆分：

| 文件组 | 内容 |
| --- | --- |
| `*-definitions.ts` / `*-arguments.ts` | Schema 与参数 normalize |
| `*-paths.ts` / `*-secure-read.ts` | Workspace 路径与读取 |
| `*-files.ts` | List/read/write/edit/append/delete |
| `*-file-transaction.ts` | Staging、backup、rename、rollback |
| `*-patch.ts` / `*-diff.ts` | Apply patch 与 diff |
| `*-git.ts` | Workspace-scoped Git |
| `*-shell-policy.ts` | Shell risk/allow policy |
| `*-shell-process.ts` | Foreground/background process |
| `*-mcp.ts` / `*-memory.ts` | 兼容工具入口 |
| `*-prompt.ts` | Tool system instructions |
| `*-constants.ts` / `*-utils.ts` | 共享边界 |

文件写入：

- Resolve/canonical path。
- Workspace confinement。
- Preview。
- Approval/permission。
- 同目录 staging。
- 原子 rename。
- 失败回滚。
- 写后再次校验。

允许 workspace 内 symlink，但真实目标越界时拒绝。

## Shell 与 network

`security/shell-command-analysis.ts`：

- 解析 command structure。
- 识别可复用允许规则。
- 避免把复杂 pipeline/subshell 错当简单 command。

`security/network-approval-policy.ts`：

- 识别 HTTP/HTTPS/SOCKS/TCP 等网络意图。
- 从 shell/tool 参数提取目标。
- 生成与 environment 绑定的 approval key。

`file-system-policy.ts`：

- 识别 mutation tool。
- 保护 workspace metadata。
- 生成 path/permission/project 维度 approval key。

Policy 评估失败应保守，不因解析器“不认识”就默认安全。

## Background shell

`PcLocalToolHost` 同时实现 `BackgroundShellProcessManager`：

- 按 thread/project 记录进程。
- 有界输出与 sequence。
- Thread-scoped 与全局 list、按 thread/process 归属 terminate API。
- Turn cleanup 决定保留或终止。
- Runtime shutdown 终止全部。

Renderer 通过 runtime REST 查看后台进程；运行中心只读取生命周期元数据，不直接连接 pty，也不暴露原始 shell 输出。

## Structured user input

`UserInputToolHost` 暴露 `request_user_input`：

- Text、multiline、number、boolean、single/multi-select。
- 自管理 approval lifecycle，避免 strict policy 再套一层 generic approval。
- 可选 60–240 秒 auto resolution。
- 超时只使用字段显式 default。
- Schema 可写事件，用户答案不写 approval event。
- 答案只随 normal tool result 进入线程。
- UI 与 runtime 双重字段校验。
- 禁止索取密码、API key 或 token。

## Browser

`BrowserToolHost` 通过 `BrowserControlPort`：

- Tabs/snapshot/click/type/scroll/key/navigate/wait。
- Snapshot/result 标记 external context。
- Click/type/危险 key 返回 approval requirement。
- Runtime 不接触 Electron/CDP。

详见 [main 浏览器](../../apps/desktop/main/browser.md)。

## Web search

`plugins/web-search` 可执行 Bundle 提供 `web_search`：

- 工具 schema、输入校验、Tavily keyless 协议、结果归一化和格式化都位于 Bundle 的 `extension/` 内，runtime 不再包含搜索专用 ToolHost 或 client。
- `ExtensionToolHost` 根据受控 marketplace manifest 保留稳定的 `web_search` 名称；卸载后 worker 和工具立即从模型能力面消失。
- Bundle 通过通用 `ctx.network.request` 访问精确 allowlist origin，不读取或保存 API key；匿名额度由外部服务限流，不保证无限调用。
- host-managed HTTP 请求复用 runtime 的系统代理链路，并支持 turn cancel、30 秒超时和 512 KiB 响应上限。
- 只接收有界的 HTTP(S) 标题、URL、摘要和发布时间，去重后最多返回 10 条。
- 查询和结果都会发送或来自外部搜索服务；返回内容统一标记为 external context，模型必须把标题和摘要视为不可信输入，并引用来源 URL。

## MCP

### Connection

`adapters/mcp/`：

- `sdk-mcp-connection-manager.ts`：stdio/HTTP connection、tools/resources。
- `mcp-oauth-coordinator.ts` / callback server：OAuth。
- `mcp-elicitation-coordinator.ts`：MCP elicitation 接入 approval/event。
- `mcp-tool-result.ts`：外部结果 normalize/truncate。

### Tool hosts

- `McpManagementToolHost`：让 Agent 管理 server。
- `McpRuntimeToolHost`：把启用 server tools 暴露为 `mcp__server__tool`。

MCP server 只维护启用状态和工具可用范围，不再提供必需、调用确认或信任级别配置。Result/resource 仍统一作为外部不可信上下文处理。

## Skills

`FileSkillRegistry`：

- 读取 packaged builtins。
- 读取 Plugin Skills。
- 管理 `runtime/user-skills/<id>/SKILL.md`。
- `skills.json` 保存 enabled。
- Builtin 只读；Plugin 和 user Skill 可编辑、删除。删除 Plugin Skill 后保留插件声明，重新安装插件时恢复其文件。
- 每轮从同一 registry 快照暴露所有 enabled Skill 的 `id/name/description/path/contentVersion` 路由元数据；`contentVersion` 由当前 SKILL.md 正文摘要生成。
- 显式 Skill 优先；显式选择和 auto-activation 只决定哪些 Skill 额外注入完整正文。

`SkillMcpDependencyCoordinator` 管理 Skill 声明的 MCP dependency 安装、状态和认证。

`SkillManagementToolHost` 提供只读 `read_skill`，按 `contentVersion` 分页加载当前轮未注入 Skill 的正文，并将单次结果限制在 16 KiB；版本变化时必须从 offset 0 重读，防止线程历史继续使用旧正文或混合两个版本。它也提供 Agent 创建/更新用户 Skill 的工具。Host system prompt 只描述当前采样实际暴露的工具。元数据目录受模型上下文预算约束，会先公平缩短 description，再在必要时省略条目并明确报告数量。

仓库内置 Skill 见 [Skills 文档](../../skills/README.md)。

## Plugins

`FilePluginBundleStore`：

- 校验 manifest、文件数量/大小/path/symlink。
- 复制到 runtime 私有目录。
- 安装 Skill/MCP/Hook/resource。
- 维护所有权。
- 失败回滚。
- 卸载时只删除仍归 Plugin 所有且未被用户修改的资源。

`FilePluginMarketplace` 扫描应用内置只读 `plugins/`，只返回无路径摘要。

`PluginBundleToolHost` 提供 `configure_plugin`、内部目录侧载、卸载和 resource 工具，模型发起 mutation 需要审批。`configure_plugin` 接收完整 Bundle v2 manifest 与 UTF-8 文本文件快照，由 `FilePluginDraftStore` 原子写入 runtime 受管草稿，再复用标准安装事务。审批预览与完整性 token 绑定本次内容；批准后当前版本直接安装并启用，后续修改需要重新审批。普通 renderer 只按 marketplace plugin ID 安装，开发者目录导入通过 Electron 窄桥接完成。

详情见 [Plugin Bundle](../../plugins/bundles.md)。

## First-party Plugin tools

所有 Plugin 工具都由受信 Node worker 从 Bundle 注册，runtime 不再按 Plugin ID 注册专用 ToolHost。工具 schema、输入校验和面向模型的结果语义必须位于 Bundle；卸载后 worker 与工具一起消失。

宿主只提供无法安全放进 worker 的窄能力：

- `web-search` 使用通用 allowlist network bridge，Bundle 自己实现 Tavily 协议和结果格式。
- `openai-image-generation` 使用 marketplace 专用 image-generation bridge；Bundle 实现 `generate_image`，host 只处理私有配置、代理、二进制校验、受管 asset 和 workspace 写入。
- `openai-vision-recognition` 使用 marketplace 专用 vision-recognition bridge；Bundle 实现 `analyze_image`，host 只处理 provider 凭据、模型调用、usage 和 thread 附件归属。

私有 bridge 能力在安装阶段限制为应用内置 marketplace 来源，worker 只收到调用结果，不会获得 API key、provider 配置、本地附件路径或原始运行环境。

## Memory 与 artifacts

- `MemoryToolHost`：`remember_memory` / `recall_memory`。
- `WorkspaceImageToolHost`：读取 workspace 内受支持图片。
- `ArtifactToolHost`：发布成品文件。

Memory 写入带 thread/turn 来源。图片/artifact 路径必须基于当前 `RuntimeEnvironment`。

## Hooks

`src/hooks/` 支持事件：

- SessionStart。
- UserPromptSubmit。
- PreToolUse / PostToolUse。
- PermissionRequest。
- PreCompact / PostCompact。
- Stop。
- Subagent start/stop 等兼容事件。

`runtime-hooks.ts`：

- 从 config/project/plugin 发现 hooks。
- 匹配 event/tool/cwd。
- 计算 command hash 和 trust status。
- 运行受限 command。

`runtime-hook-output.ts`：

- 解析 JSON/legacy 输出。
- 截断 stdout/stderr。
- 拒绝不支持的 universal/specific 字段。
- 生成 canonical hash。

Plugin Hook 默认不可信；用户信任绑定当前 command hash，命令变化后需要重新确认。

Hook output 是外部输入，不能直接修改任意 runtime state。Coordinator 只接受对应事件允许的结构化 outcome。

## 修改/新增工具

1. 选择现有 host 或定义新窄 host。
2. 定义 schema 和稳定 tool name。
3. 说明 system prompt 与 external context。
4. 实现 preview。
5. 定义 approval/permission/network/sandbox。
6. 支持 cancel、timeout、output limit 和 cleanup。
7. 通过 factory 组装。
8. 添加 host 单元测试。
9. 添加 AgentLoop integration 的 tool event/result 顺序。
10. 涉及 UI 时更新 toolRun contract/projection/renderer。

## 测试

- `test/loop/tools/`
- `test/adapters/tool/`
- `test/adapters/mcp/`
- `test/adapters/skill/`
- `test/adapters/plugin/`
- `test/security/`
- `test/integration/agent-loop/tool-execution.test.ts`
- Approval、hook、policy、sandbox integration。
- `test/integration/adapters/tool/pc-local-tool-host.test.ts`
