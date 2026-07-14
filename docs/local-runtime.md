# Local Runtime Modules

`packages/desktop-runtime` 是本地 Agent runtime。它通过 HTTP/SSE 暴露给 Electron main，内部用 ports/adapters 组合模型、工具、存储、MCP、Skill、memory 和 usage。

## 入口与组装

### `src/cli.ts`

runtime CLI 读取端口、数据目录、token、内置 skills 目录，创建 runtime server 并监听 `127.0.0.1`。Electron dev 和 packaged 都通过这个入口启动 runtime。

### `src/runtime/runtime-factory.ts`

`createRuntimeFactory()` 是依赖组装点：

- `JsonThreadStore`：线程 snapshot + event log。
- `FileConfigStore`：runtime 配置和 secrets。
- `FileUsageStore`：usage jsonl。
- `FileMcpStore`：MCP server 配置。
- `FileMemoryStore`：本地 memory。
- `FileSkillRegistry`：内置和用户 Skill。
- `FileWorkspaceProjectStore`：workspace 项目、文件、搜索。
- `InMemoryApprovalGate`：审批状态。
- `InMemoryEventBus`：SSE 广播。
- `ConfiguredModelClient`：按配置选择 provider。
- `CompositeToolHost`：组合 MCP 管理、MCP runtime、本地 PC 工具、Skill 管理、memory 工具。
- `BrowserToolHost`：通过 main 所拥有的 browser control adapter 暴露 tabs/snapshot/click/type/scroll/key/navigate/wait。
- `AgentLoop`：执行对话和工具循环。

ToolHost 顺序会影响模型看到的能力面。新增能力时先判断是管理工具、运行工具还是本地工具，再放入合适位置。

浏览器工具不直接访问 Electron 或 CDP。`HttpBrowserControlClient` 实现 `BrowserControlPort`，只连接 main 通过环境变量注入的 `127.0.0.1` 地址并携带独立 token。页面快照结果设置 `containsExternalContext`；click/type 和具有提交或删除语义的 key 返回 ToolHost approval requirement。

## Server

### `src/server/runtime-server.ts`

职责：

- 创建 runtime container。
- 结算上次异常退出残留的 streaming turn。
- 处理 `/health`。
- 校验 bearer token。
- 分发 `/v1/swe/app-server` JSON-RPC。
- 分发普通 runtime REST route。
- 关闭时终止 command exec manager。

### `src/server/runtime-rest-routes.ts`

REST 路由覆盖：

- config 和模型列表。
- threads、messages、turns、context clear/compact、events SSE。
- skills。
- projects、workspace status、files、search。
- usage。
- approvals。
- memories。
- MCP servers/tools。

新增路由时保持这条扩散路径：

1. contract 类型。
2. renderer runtime client。
3. server route。
4. store/agent loop/adapter。
5. 测试。

### `src/server/sse.ts`

负责 SSE 连接、历史事件回放和 event bus 订阅。SSE 的核心约束是按 `seq` 续订并保持线程内顺序。

### `src/server/app-server/*`

承载 Codex/SWE bridge JSON-RPC：

- dispatcher 和 rpc：协议分发。
- thread/config/approval protocol：把 runtime 线程和配置映射到 app-server 语义。
- command-exec：管理命令执行生命周期。
- errors/input/platform：协议工具。

这个分支和普通 renderer REST 是两个入口，修改时不要混淆。

## Agent Loop

`src/loop/agent-loop.ts` 是 turn 生命周期的薄编排器。它决定阶段顺序和分支，但不再负责构造每个阶段的内部细节：memory、hooks、context compaction、sampling context、模型采样/流事件、工具执行、标题、终态写入和用户 shell 分别下沉到同目录的 coordinator、builder、sampler、publisher、executor 和 runner。

内部协作者按职责划分：

- `RuntimeAgentTurnRunner`：执行单个 turn 的多轮 sampling/tool loop，处理 steer drain、Stop hook、最终回答与错误/取消分支。
- `RuntimeTurnInputCoordinator`：管理 steer、active/idle mailbox 队列、持久化和模型消息转换。
- `RuntimeCompactionTurnCoordinator`：管理显式 compact turn 的任务登记、hooks、事件与取消生命周期。
- `RuntimeModelInputGuard`：统一校验当前模型的附件能力。
- `RuntimeHookCoordinator`：维护 SessionStart source，并统一运行 SessionStart、UserPromptSubmit、Stop、Pre/PostCompact hooks。
- `RuntimeSamplingContextBuilder`：使用 Builder 模式，在每个 sampling step 重新捕获 provider config、压缩后的对话、memory、Skill、工具路由和 world-state snapshot。
- `RuntimeThreadTitleCoordinator`：管理首轮自动标题策略、模型生成、fallback 资格、usage 和手动改名竞争保护。
- `RuntimeTurnRunFactory`：使用 Factory 模式统一创建普通、review、mailbox-triggered 和 regenerate turn，把输入准备与任务登记移出主循环。
- `RuntimeTurnFinalizer`：按固定模板依次结算 usage、完成消息、提交标题、退出 review、保存 memory、发布 `turn.completed`。
- `RuntimeTurnTerminationCoordinator`：串行化取消终态和 aborted marker，确保一个 turn 最多只有一个 terminal event。

`AgentLoop` 本身只保留依赖装配、公开 Facade 和窄事件桥接。新增横切能力时优先判断属于哪个协作者；只有需要暴露新的顶层 runtime 动作时才应修改 `AgentLoop`。

主要阶段：

1. 校验输入和附件能力。
2. 创建 `turn.started`。
3. 写入用户消息。
4. 自动或手动 context compaction。
5. 组装模型上下文：
   - Setsuna style 和 global prompt。
   - memory context。
   - ToolHost system prompt。
   - selected/default Skill。
   - 对话历史。
6. 流式调用模型。
7. 发布 assistant delta、reasoning、tool call preview。
8. 执行工具并把 tool result 写回模型上下文。
9. 处理审批、取消、usage、review mode、memory。
10. 发布 `turn.completed` 或 `runtime.error` / `turn.cancelled`。

关键能力：

- `startTurn()` 异步返回 turnId，后台执行。
- `sendTurn()` 用于测试或命令式等待完整结果。
- `regenerateFromMessage()` 先截断历史再重跑。
- `steerTurn()` 允许向活跃普通 turn 追加用户输入。
- `startReview()` 支持 UI 展示文本和模型 prompt 分离。
- `compactThreadContext()` 通过事件链写入压缩生命周期。

约束：

- 所有用户可见状态通过 runtime event 发布。
- 事件必须先落盘再广播。
- 被动 memory 失败不能影响主回答完成。
- usage 只在模型返回 usage 时记录，不伪造。
- 工具调用由模型驱动持续 sampling，不按调用次数截断；长链路在每次 sampling 前按上下文边界自动压缩，直到模型正常结束或取消、hook、provider/资源错误终止。
- 只读检查工具可以批处理，文件写入必须通过 mutation 工具的预览、审批和权限预检。

## Context Compaction

`src/loop/context-compaction.ts` 用字符数估算 token，默认上限 `256K` tokens。

规则：

- transcript-only 消息不进入 token 统计。
- 普通 system prompt 不压缩，历史压缩摘要可以再次合并。
- 保留最近若干模型可见消息原文。
- 旧消息降级为 `visibility: "transcript"`，新增一条 system summary。
- notice 同步记录原始 token、压缩 token、保留消息数、触发范围等。

## Ports

`src/ports` 是 runtime 内部契约：

- `ThreadStore`：线程、消息、事件。
- `ConfigStore`：配置和 active provider。
- `ModelClient`：流式模型输出。
- `ToolHost`：工具列表、系统提示、审批、预览、执行。
- `ApprovalGate`：创建、等待和回复审批。
- `SkillRegistry`：Skill 列表、CRUD、注入。
- `McpStore`：MCP server 列表和配置。
- `MemoryStore`：memory CRUD 和 preview。
- `UsageStore`：usage 记录和聚合。
- `WorkspaceProjectStore`：项目、文件、搜索、写入。
- `EventBus`、`Clock`、`IdGenerator`：基础设施。

新增业务能力优先定义 port 或复用现有 port，再写 adapter。

## Stores

### `FileConfigStore`

- `config.json` 保存非 secret 配置。
- `secrets.json` 保存 provider API key，写入 `0600`。
- 默认 provider 是 `local-test`，用于 smoke fallback。
- 归一化 approval policy、permission profile、setsuna style、feature flags、desktop settings。
- global prompt 限制 8000 字符。

### `JsonThreadStore`

- snapshot：`threads/<threadId>.json`。
- event log：`threads/<threadId>.events.jsonl`。
- index：`threads/index.json`。
- 用 per-thread queue 和 index queue 避免并发写乱序。
- 所有事件通过 `applyRuntimeEventToThread()` 投影。

### `FileMcpStore`

- `mcp.json` 支持 `mcpServers` 和 legacy `servers`。
- stdio 和 streamableHttp 两种 transport。
- 支持 timeout、required、requireApproval、enabled、allowed/disabled tools、env、headers。
- list 视图隐藏 secret 值，只暴露 env/header key。

### `FileMemoryStore`

- 默认写 runtime data dir，也可以读取/写入用户配置的 storage root。
- 支持 global/project、active/passive origin、source thread/turn、title、tags。
- list 会合并多个 root 并按 updatedAt 排序。
- preview 供设置页展示存储位置和摘要。

### `FileUsageStore`

- append-only `usage.jsonl`。
- 支持按 thread 过滤、limit、provider/model bucket 汇总。

### `FileWorkspaceProjectStore`

- `projects.json` 保存项目列表和 gitRoot。
- 文件浏览、搜索和读取都限制在项目根下。
- 忽略 `.git`、`node_modules`、`dist`、`build`、`coverage`、`target`、`release-artifacts`。
- 读取、搜索和列表都有大小/数量上限。

### `FileSkillRegistry`

- 内置 Skill 从 packaged `skills/` 读取。
- 用户 Skill 写入 `runtime/user-skills/<id>/SKILL.md`。
- `skills.json` 保存 enabled/selected 状态。
- 内置 Skill 只读；用户 Skill 可创建、更新、删除。
- selected Skill 会默认注入，显式 skillIds 也会注入。

## Model Adapters

`ConfiguredModelClient` 根据 active provider 选择具体客户端：

- `openai-compatible`：默认走 AI SDK adapter，可用环境变量切回 legacy OpenAI chat adapter。
- `openai-responses`：Responses API adapter。
- `anthropic`：Messages API adapter。
- 没有可用 provider 或只使用 smoke 模型时走 `TestModelClient`。

`provider-utils.ts` 负责：

- endpoint 拼接。
- auth header。
- SSE 解析。
- message/tool 格式转换。
- usage 归一化。
- 图片附件转换。

`model-discovery.ts` 负责 provider 模型列表拉取和能力解析，包括 thinking efforts、max output tokens、vision。

## Tool Hosts

### `CompositeToolHost`

把多个 ToolHost 合并为一个工具面。新增工具时要考虑名称冲突、system prompt 顺序、审批和 preview。

### MCP 管理和运行

- `McpManagementToolHost`：让模型配置 MCP server。
- `McpRuntimeToolHost`：把已启用 MCP server 的 tools 映射为模型工具。
- MCP runtime 工具名形如 `mcp__server_key__tool_name`，避免与本地工具冲突。
- MCP 默认需要审批，除非 server 配置 `requireApproval: "never"`。

### Skill 管理

`SkillManagementToolHost` 提供创建/更新 Skill 的工具能力，最终落到 `FileSkillRegistry`。

### Memory

`MemoryToolHost` 暴露：

- `remember_memory`
- `recall_memory`

显式 memory 会带 thread/turn 来源；被动 memory 由 AgentLoop 在 turn 完成后抽取。

### PC Local Tools

`PcLocalToolHost` 适配 `pc-local-tools.ts`：

- 暴露 list/read/search/diff/shell/apply/write/edit 等本地工具。
- 维护每个项目独立 tool state，shell process store 可复用。
- 支持 `workspace_*` 别名。
- 文件变更通过 `apply_patch` 或单文件 write/edit/append/delete 工具直接执行，审批和预览由 tool orchestrator 统一处理。
- shell 风险由 `shellCommandRisk()` 决定是否审批。
- `previewPartialToolCall()` 支持流式文件变更预览。

## 测试重点

runtime 改动通常要覆盖：

- `runtime-server.test.ts`
- `runtime-factory.test.ts`
- `agent-loop-tools.test.ts`
- `context-compaction.test.ts`
- 对应 adapter/store/tool 的 `*.test.ts`
- contracts 里的 event projection test

如果改动穿透到 renderer，还要补 renderer 纯函数或 hook 测试。
