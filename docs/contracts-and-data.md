# Contracts And Data

`packages/contracts` 是桌面主进程、preload、renderer 和 runtime 的共享契约层。任何跨边界数据都应该先在这里定义，再由各层实现。

## 模块

- `config.ts`：runtime preferences 与 feature flags；provider、permission 等叶子类型位于 `model-provider.ts`、`model-request.ts`、`permissions.ts`，由兼容门面重导出。
- `environment.ts`：每次 runtime 操作共享的 cwd、workspace roots、shell 与 Git 仓库路径关系；不承载权限。
- `provider.ts`：模型请求、工具定义、工具调用、流式模型事件。
- `message-metadata.ts`：跨协议消息角色、JSON-safe provider metadata、版本化原生回放 envelope。
- `threads.ts`：线程、消息、附件、toolRun、context compaction、goal、git info。
- `events.ts`：runtime event union 和 SSE envelope。
- `debug-traces.ts`：开发者模式专用的非持久化诊断 kind、payload 和增量 list contract。
- `thread-events.ts`：runtime event -> thread snapshot reducer；复用的 projection helper 位于 `thread-event-projection.ts`。
- `swe-events.ts`：Codex/SWE app-server 公共门面；类型与 mapper 实现位于 `swe/`。
- `http.ts`：runtime health、request input、`DesktopRuntimeClient` 方法面。
- `data-root.ts`：桌面数据根、迁移清单/分类/进度、恢复状态和 runtime 准入结果。
- `workspace.ts`：项目、文件树、文件读写、搜索。
- `mcp.ts`：MCP server、transport、tool、审批策略。
- `skills.ts`：Skill summary/detail/input/patch。
- `memory.ts`：memory record、query、preview。
- `usage.ts`：usage record、summary、bucket。
- `approvals.ts`：审批 request、decision、MCP elicitation、结构化用户输入和 list。

## Contract 变更规则

新增或修改跨层能力时按这个顺序：

1. 修改 `packages/contracts/src/*` 类型。
2. 如果是 HTTP 能力，更新 `DesktopRuntimeClient`。
3. 更新 runtime server route 或 app-server protocol。
4. 更新 renderer `desktop-runtime-client.ts`。
5. 更新 `useRuntimeClientState.ts` 或调用方 hook/page。
6. 补投影、store、server、renderer 相关测试。

不要在 renderer 和 runtime 分别定义相似类型。类型重复会让 IPC/REST 协议漂移。

## Runtime Event

`RuntimeEvent` 是线程状态的真源。

事件类别：

- thread：created、updated、deleted、metadata、goal、context clear/compact。
- turn：started、completed、cancelled。
- message：created、delta、updated、completed、deleted、truncated。
- tool：started、output_delta、completed。
- approval：requested、resolved。
- runtime：error。

事件要求：

- 每条事件有 `id`、`seq`、`threadId`、可选 `turnId`、`createdAt`、`payload`。
- `seq` 由 `ThreadStore.appendEvent()` 分配。
- reducer 必须能从任意 snapshot + event 得到下一状态。
- renderer 只应用 `seq > lastSeq` 的事件。

新增事件时必须更新：

- `events.ts` union。
- `thread-events.ts` reducer。
- `SqliteThreadStore` 行为或调用点。
- SSE/REST 发布点。
- renderer event apply helper。
- 测试。

`RuntimeDebugTraceEvent` 不属于上述事件模型。它没有 reducer，不进入 `ThreadStore`，也不通过聊天 SSE 发布；独立的 `D#` sequence 只用于调试窗口增量读取。每条 trace 还携带 `afterEventSeq`，表示它发生在最近哪个正式 `E#` 事件之后；跨流展示必须按这个锚点排序，不能直接比较两个独立命名空间的 `seq`。需要观察内部选择但不应改变持久化聊天协议时，优先增加受控 debug trace kind，而不是增加 `RuntimeEvent`。

## Thread Snapshot

`RuntimeThread` 是 `RuntimeThreadSummary + messages + lastSeq + contextCompaction`。

消息关键字段：

- `role`：system/user/assistant/tool。
- `visibility`：默认模型可见；`transcript` 只给 UI 历史展示。
- `status`：streaming/complete/error。
- `turnId`：把用户消息、assistant 段、toolRun、review marker 关联成一轮。
- `toolCalls`：模型请求执行工具。
- `toolRuns`：UI 展示工具执行状态。
- `contextCompaction` / `reviewMode`：transcript 特殊展示。

设计注意：

- assistant 一轮可以有多段 assistant message。
- tool result 是模型上下文的一部分，toolRun 是 UI 投影的一部分。
- 删除和重生成要按 message id 操作，而不是按 UI display item id。
- context compaction 后，旧消息保留给用户看，但 visibility 降为 transcript。

## Protocol-aware Model History

线程状态仍以 append-only `RuntimeEvent` 为持久化真源；投影得到的 `RuntimeMessage[]` 是模型请求使用的跨协议 semantic history。`item.started` / `item.delta` / `item.completed` 只描述流式 UI 与 turn item，不参与重建模型历史，也不构成第二套可变真源。

`RuntimeMessage.providerMetadata` 是 semantic message 上的可选增强：

- 新 metadata 写入 `schemaVersion: 2` 和 `source`。`source` 包含 provider ID、provider kind、model，以及规范化 base URL 的 SHA-256 fingerprint；不会保存 endpoint 明文副本。
- 只有 provider ID、协议、模型和 endpoint fingerprint 全部匹配时，adapter 才会原生回放 envelope。任一不匹配都静默回退到当前 `RuntimeMessage` 的文本、tool calls 和 tool results。
- OpenAI-compatible Chat 是 `semantic_only`：不保存或回放未知厂商字段、`reasoning_content` 或任意原始响应 payload。
- Anthropic envelope 保存签名 thinking/content blocks。没有 V2 source 的 legacy Anthropic blocks 仍只在 Anthropic adapter 中按旧规则回放。
- OpenAI Responses envelope 只保存白名单内且嵌套结构也通过校验的 message、reasoning、function call、function call output（仅 native compaction replacement list）、compaction item，以及 response ID；合法 assistant message `phase` 会随 response/compact item 保留，非法值使整条 envelope 降级；encrypted reasoning 不进入普通 assistant 文本。任一原生 item 无法完整保存时，整条 envelope 省略。
- V2 metadata 的 semantic fingerprint 绑定最终 portable message；后续 runtime 追加文本、修改 tool name/arguments 或 compact summary 变化时，同 provider 也会降级为 semantic replay。
- Responses compaction 是双产物：`/responses/compact` 返回的完整 replacement items 只服务同协议续接，portable summary 由独立摘要请求生成并始终作为跨协议 fallback。
- 单条消息 metadata 的 JSON 上限是 2 MiB。超限时整个原生 envelope 被省略，semantic message 正常完成，并记录 `provider_metadata_omitted_too_large` verification warning。

读取使用 lazy compatibility：不会为旧消息猜测原生状态，也不会后台重写事件。无 metadata 的旧 Chat/Responses 消息走 semantic replay；旧 compaction 继续使用 portable summary。Chat 厂商跨轮复用的 tool-call ID 只在 model-facing 副本上按事务改写为稳定 wire ID；旧压缩边界留下的 orphan result 不再发送给模型，并产生 verification warning。新字段只追加在现有 JSON payload 中，不新增 event type 或 SQLite 字段，`PRAGMA user_version` 保持 `1`，因此旧版本忽略 metadata 后仍可显示并继续基础 transcript。

snapshot normalization 只做 JSON-safe 深拷贝、已知 envelope 形状校验和非法 envelope 降级。合法未知 additive 字段保留，用于前向兼容。

## HTTP Client Contract

`RuntimeRequestInput` 只有：

- `path`
- `method`
- `body`

renderer 的 `DesktopRuntimeClient` 是方法级 contract。它不应该暴露任意 URL、headers 或 token。

常见 path：

- `/v1/config`
- `/v1/config/models`
- `/v1/threads`
- `/v1/threads/:id`
- `/v1/threads/:id/turns`
- `/v1/threads/:id/events`
- `/v1/threads/:id/debug-traces`（仅全局开发者功能开启时）
- `/v1/skills`
- `/v1/projects`
- `/v1/projects/:id/files`
- `/v1/projects/:id/read`
- `/v1/mcp/servers`
- `/v1/memories`
- `/v1/usage`
- `/v1/approvals`
- `/v1/plugins`
- `/v1/plugin-marketplace`
- `/v1/plugin-marketplace/:id/install`

## 本地数据布局

所选 Setsuna 数据根就是 Electron `userData` 与 `sessionData`。Electron main 自身的窗口状态、凭据和更新源配置位于根目录，runtime 位于其 `runtime/` 子目录。

```text
<dataRoot>/
├── .setsuna-data-root.json  # 自定义根所有权 marker
├── window-state.json
├── secure-credentials.json
├── update-download-sources.json
├── Chromium/Electron 持久化状态
└── runtime/
    ├── config.json
    ├── secrets.json
    ├── projects.json
    ├── mcp.json
    ├── skills.json
    ├── user-skills/
    ├── pc-local-policies/
    │   ├── legacy-exec-policy.json
    │   └── legacy-shell-policy.json
    ├── memories/
    │   ├── .setsuna-memory-root.json
    │   ├── memories.json
    │   ├── MEMORY.md
    │   ├── memory_summary.md
    │   └── rollout_summaries/
    ├── usage.jsonl
    ├── threads.sqlite
    └── threads/              # 仅旧格式迁移源/备份
        ├── index.json
        ├── <threadId>.json
        └── <threadId>.jsonl
```

系统 `appData` 中另有 `Setsuna Desktop Bootstrap/`，保存位置指针、迁移 pending、稳定实例锁和旧数据根清理登记表，只负责在 Electron profile 初始化前定位数据根、串行化启动/维护进程并安全完成用户确认的旧数据删除。登记表只含路径、目录身份和事务状态，不复制业务数据。

memory 的 active root 固定为 `<dataRoot>/runtime/memories/`。旧配置的 `storagePath` 只作为启动前维护导入源：扫描与空间预检完成后，按 ID/去重键合并到带事务 receipt 的 staging，再由 pending 阶段保护备份/正式目录 rename；成功后从 schema v3 配置中删除，旧目录不删除。PC Local Tools 的旧用户级 exec/shell 文件同批复制到 `<dataRoot>/runtime/pc-local-policies/`，之后 runtime 不再读取旧 home 路径。Phase 2 使用内部 snapshot baseline 生成增量 diff，不初始化、读取或删除用户目录中的 Git 仓库。

## 数据安全

- API key 不在 `RuntimeConfigState.providers` 中明文返回，只暴露 `apiKeySet` 和 `apiKeyPreview`。
- 自定义 provider/model 图标仅接受 PNG/JPEG/WebP data URL，并在 contract 与 runtime store 两侧限制为 512 KB；不接受可执行 SVG 内容。
- `secrets.json` 写入后尝试 `chmod 0600`。
- workspace 文件访问都要防止路径逃逸。
- MCP list 只暴露 env/header key，不返回值。
- 结构化用户输入的待处理 schema 可以进入事件；答案不写入 approval request/resolved 事件，只随正常 tool result 进入本地线程上下文。
- renderer 不能拿到 runtime token。
- provider metadata 不保存完整 HTTP response、headers、API key、request metadata 或未经过白名单过滤的 provider payload。
- debug traces 只在内存中有界保存，renderer 也必须按 `droppedBeforeSeq` 清理本地缓存。详情渲染前会归一化凭据键名，并递归隐藏对象或 JSON 字符串中的 secret/token、data URL 和超大字段；它们不写入线程数据库。

## 变更扩散范例

新增一个 runtime preference：

1. `config.ts` 加字段。
2. `FileConfigStore` normalize、default、toState、save。
3. `features/settings/sections/` 或 `features/settings/providers/` 增加 UI。
4. `useRuntimeClientState.saveRuntimePreferences()` 类型允许该字段。
5. 如果影响 AgentLoop，在 `loop/core/agent-loop.ts` 或对应 coordinator 读取 runtimeConfig。
6. 加 store 或 UI 测试。

新增一个 toolRun 展示字段：

1. `threads.ts` 更新 `RuntimeToolRun`。
2. 工具执行处写入 event payload 或 toolRun data。
3. `thread-events.ts` 投影字段。
4. `features/chat/tool-runs/` 展示。
5. 添加 projection 和 renderer 测试。

新增一个 provider：

1. `provider.ts` 扩展 `ModelProviderKind`。
2. 新增 model client adapter。
3. `ConfiguredModelClient` 选择 adapter。
4. `model-discovery.ts` 支持模型列表。
5. `features/settings/providers/` 加 provider 表单逻辑。
6. provider adapter tests。

## 测试真源

contracts 层测试特别重要，并统一位于 `packages/contracts/test/`：

- `thread-events.test.ts`：线程投影是否稳定。
- `swe-events/`：按 notification、turn、stream、capability 等职责拆分的 app-server 映射兼容测试。
- `support/`：SWE fixture 与共用断言。

只要 runtime event 或 thread message 结构变化，都应优先补这里的测试，再补上层测试。
