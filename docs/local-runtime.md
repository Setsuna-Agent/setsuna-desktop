# Local Runtime Modules

`packages/desktop-runtime` 是本地 Agent runtime。它通过 HTTP/SSE 暴露给 Electron main，内部用 ports/adapters 组合模型、工具、存储、MCP、Skill、memory 和 usage。

## 入口与组装

### `src/cli.ts`

runtime CLI 读取端口、数据目录、token、内置 skills 目录，创建 runtime server 并监听 `127.0.0.1`。Electron dev 和 packaged 都通过这个入口启动 runtime。

### `src/runtime/runtime-factory.ts`

`createRuntimeFactory()` 是依赖组装点：

- `SqliteThreadStore`：线程 snapshot checkpoint + event log + runtime ownership lease。
- `FileConfigStore`：runtime 配置和 secrets。
- `FileUsageStore`：usage jsonl。
- `FileMcpStore`：MCP server 配置。
- `FileMemoryStore`：本地 memory。
- `FileSkillRegistry`：内置、Plugin 和用户 Skill。
- `FilePluginBundleStore`：校验、安装和可逆卸载本地 Plugin Bundle，并协调 Skill、MCP、Hook 和资源所有权。
- `FilePluginMarketplace`：扫描应用随包发布的精选目录，只向 renderer 投影无路径市场摘要，并按插件 ID 委托 Bundle Store 安装。
- `FileWorkspaceProjectStore`：workspace 项目、文件、搜索。
- `WorkspaceRuntimeEnvironmentResolver`：从选中的 workspace 生成一次规范化环境快照，并补充 Git root / workspace prefix。
- `InMemoryApprovalGate`：审批状态。
- `InMemoryEventBus`：SSE 广播。
- `ConfiguredModelClient`：按配置选择 provider。
- `CompositeToolHost`：组合 MCP 管理、MCP runtime、本地 PC 工具、Skill/Plugin 管理、Plugin 资源、memory 工具和工作区图片读取。
- `UserInputToolHost`：把模型发起的结构化选择/表单接入可审计的暂停与恢复流程，并处理可选自动超时。
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
- 默认插件市场列表、按插件 ID 安装、已安装插件列表和卸载；路径侧载不通过 renderer REST 暴露。

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
- `RuntimeSamplingContextBuilder`：使用 Builder 模式，在每个 sampling step 只解析一次环境，并重新捕获 provider config、压缩后的对话、memory、Skill、工具路由和 world-state snapshot。
- `RuntimeThreadTitleCoordinator`：管理首轮自动标题策略、模型生成、fallback 资格、usage 和手动改名竞争保护。
- `RuntimeTurnRunFactory`：使用 Factory 模式统一创建普通、review、mailbox-triggered 和 regenerate turn，把输入准备与任务登记移出主循环。
- `RuntimeTurnFinalizer`：按固定模板依次结算累计 usage、完成消息、提交标题、退出 review、保存显式 memory、发布 `turn.completed`，再排队被动 memory。
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
- 被动 memory 在串行、可取消的后台队列中运行，不占用 active turn；失败不能影响主回答完成，runtime shutdown 会中止仍在执行的抽取。
- usage 只在模型返回 usage 时记录，不伪造。
- 工具调用由模型驱动持续 sampling，不按调用次数截断；长链路在每次 sampling 前按上下文边界自动压缩，直到模型正常结束或取消、hook、provider/资源错误终止。
- 只读检查工具可以批处理，文件写入必须通过 mutation 工具的预览、审批和权限预检。

## Runtime Environment

`RuntimeEnvironment` 是 prompt、工具、sandbox、project workflow、project instructions 和 step snapshot 共享的位置 contract：

- 未绑定项目的对话使用独立工作区：`runtime/temporary-workspace/YYYY-MM-DD/<threadId>`。日期取对话创建时的本地日期，同一对话跨天继续时仍复用原目录；绑定项目的对话继续使用项目目录。
- workspace、shell、artifact 和内置图片生成都使用同一个对话环境。图片仍保留受管预览资产，同时在当前工作区的 `generated-images/` 下写入可见文件。
- `cwd` 是 shell 默认目录，`workspaceRoot` 是文件工具相对路径的基准；两者语义独立，即使当前通常相同也不要互相推断。
- `workspaceRoots` 描述工作区层级；`repository.root` 和 `repository.workspacePrefix` 只描述 Git worktree 与所选 workspace 的路径关系，不扩大访问权限。
- `environment_context` 只告诉模型“在哪里”；`runtimePermissionsPrompt` 单独描述“能访问哪里”。
- 内置 `git_status` / `read_diff` 检查工作树，`git_log` / `git_show` 检查已提交历史；四者都用 pathspec 限定在 workspace，路径统一为 workspace-relative。通过 shell 运行的其他 Git 命令仍可能输出 repository-relative path：从 cwd 复用时要去掉一次 `workspacePrefix`，或显式使用 Git 的 `:(top)` pathspec，不能把带前缀路径直接当作 cwd-relative path。
- project instructions 仍在每个 sampling step 按同一环境从 workspace root 加载到 cwd，避免线程创建时的旧 cwd 污染当前 turn。

## Project Workflow

`FileProjectWorkflowResolver` 在每个 sampling step 根据同一 `RuntimeEnvironment` 解析 workspace root 到 cwd 之间的 Node.js 工作流：

- 优先使用最近作用域的 `package.json#packageManager`，再看 lockfile、workspace 配置和 `engines`；同层证据冲突时保持 unresolved，不替模型猜测。
- 提取 build/test/lint/typecheck/check/verify/format 及其定向子脚本，生成带 cwd、source path 和原始 script definition 的标准调用。
- package manager、script 数量、单条 definition、ancestry、warning 和 cache 都有固定边界；manifest stat 变化时自动失效缓存。
- 解析结果以 `user` / `external` 的 `project_workflow` fragment 注入，并在更窄的 project instructions 之前出现。仓库脚本始终作为外部数据处理，不能提升为 runtime policy。

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

### `SqliteThreadStore`

- 主库：`threads.sqlite`，使用 WAL、外键和事务。
- `runtime_events` 以 `(thread_id, seq)` 为主键；事件提交成功后才向 SSE 发布。
- `threads` 保存可查询摘要、`last_seq` 和带 `snapshot_seq` 的投影 checkpoint。
- 高频 delta 延迟 checkpoint，恢复时只重放 `snapshot_seq` 后的短事件尾部。
- `runtime_owner` 使用租约和 fencing token，第二个 runtime 在恢复 stale turn 前就会被拒绝。
- 首次启动会只读校验并导入旧 `threads/*.json` 与 `threads/*.jsonl`，不截断、不双写。缺号、乱序等不可证明的损坏仍会停止迁移；对于有后续连续事件且最终 snapshot 能佐证最后写入者的重复 seq，迁移器采用 last-writer-wins，并把被替换事件记录在 `legacy_json_import` 元数据中。

`JsonThreadStore` 仍保留给旧数据格式测试和迁移读取，不再由 `runtime-factory` 作为主存储注入。

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
- `search_text` 默认把 query 作为正则表达式；需要搜索 `|`、`[]` 等字面字符时显式传 `regex: false`，避免 schema 与执行语义漂移。
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

### 结构化用户输入

`UserInputToolHost` 暴露 `request_user_input`，支持文本、多行文本、数字、布尔、单选和多选字段：

- 工具自己维护 `approval.requested -> 用户回答/超时 -> approval.resolved` 生命周期，`approvalMode: "selfManaged"` 避免严格模式额外生成一层通用审批。
- 60–240 秒的 `auto_resolution_ms` 只用于非阻塞问题；超时后只返回字段中显式声明的默认值。
- schema 和超时可以写入事件，表单值只在内存审批中短暂存在，消费后清理；正常工具结果再把用户答案传给模型。
- UI 和 `InMemoryApprovalGate` 都做字段校验，运行时提示禁止通过该工具索取密码、API Key 或 token。

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

显式 memory 会带 thread/turn 来源；被动 memory 由 AgentLoop 在 turn 完成后排队抽取。自定义 `storagePath` 是容器目录，实际数据位于其 `.setsuna-memory/` 专属子目录；清空操作要求有效所有权 marker。Phase 2 用内部 snapshot baseline 计算增量，不依赖或改动 Git 元数据。

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
