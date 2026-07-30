# 工具、审批与扩展能力

源码：

- `packages/desktop-runtime/src/loop/tools/`
- `packages/desktop-runtime/src/adapters/tool/`
- `packages/desktop-runtime/src/adapters/{mcp,skill,plugin}/`
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
6. `OpenAiImageGenerationToolHost`
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
- List/terminate API。
- Turn cleanup 决定保留或终止。
- Runtime shutdown 终止全部。

Renderer 通过 runtime REST 查看后台进程，不直接连接 pty。

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

MCP 默认审批，除非 server 明确 `requireApproval: "never"`。Result/resource 都是外部不可信上下文。

## Skills

`FileSkillRegistry`：

- 读取 packaged builtins。
- 读取 Plugin Skills。
- 管理 `runtime/user-skills/<id>/SKILL.md`。
- `skills.json` 保存 enabled/selected。
- Builtin/Plugin 只读，user 可 CRUD。
- 显式 Skill 优先；否则 default/auto-activation。

`SkillMcpDependencyCoordinator` 管理 Skill 声明的 MCP dependency 安装、状态和认证。

`SkillManagementToolHost` 提供 Agent 创建/更新用户 Skill 的工具。

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

`PluginBundleToolHost` 提供内部侧载/卸载/resource 工具，模型发起 mutation 需要审批。普通 renderer 只按 marketplace plugin ID 安装。

详情见 [Plugin Bundle](../../plugins/bundles.md)。

## First-party Plugin tools

普通 Bundle 不能注入任意 TypeScript 工具。需要凭据/本机实现的第一方能力由：

- 已安装 Plugin ID 作为 enable gate。
- Bundle Skill 说明用法。
- Runtime 内置 ToolHost 执行。

例如 `OpenAiImageGenerationToolHost`：

- 读取 Plugin/config/secret。
- 调用 OpenAI-compatible Images API。
- 支持 `b64_json` 和 URL 响应。
- 保存 managed image 和 workspace 可见文件。
- 卸载/停用后不再出现在工具面。

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
