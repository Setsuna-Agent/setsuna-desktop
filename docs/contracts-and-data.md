# Contracts And Data

`packages/contracts` 是桌面主进程、preload、renderer 和 runtime 的共享契约层。任何跨边界数据都应该先在这里定义，再由各层实现。

## 模块

- `config.ts`：provider、model、runtime preferences、permission profile、feature flags。
- `environment.ts`：每次 runtime 操作共享的 cwd、workspace roots、shell 与 Git 仓库路径关系；不承载权限。
- `provider.ts`：模型请求、工具定义、工具调用、流式模型事件。
- `threads.ts`：线程、消息、附件、toolRun、context compaction、goal、git info。
- `events.ts`：runtime event union 和 SSE envelope。
- `thread-events.ts`：runtime event -> thread snapshot reducer。
- `swe-events.ts`：Codex/SWE app-server 映射类型。
- `http.ts`：runtime health、request input、`DesktopRuntimeClient` 方法面。
- `workspace.ts`：项目、文件树、文件读写、搜索。
- `mcp.ts`：MCP server、transport、tool、审批策略。
- `skills.ts`：Skill summary/detail/input/patch。
- `memory.ts`：memory record、query、preview。
- `usage.ts`：usage record、summary、bucket。
- `approvals.ts`：审批 request、decision、list。

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
- `JsonThreadStore` 行为或调用点。
- SSE/REST 发布点。
- renderer event apply helper。
- 测试。

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
- `/v1/skills`
- `/v1/projects`
- `/v1/projects/:id/files`
- `/v1/projects/:id/read`
- `/v1/mcp/servers`
- `/v1/memories`
- `/v1/usage`
- `/v1/approvals`

## 本地数据布局

runtime 数据根：Electron `userData/runtime`。

Electron main 自身的更新源配置保存在 `userData/update-download-sources.json`，不进入 runtime，也不直接暴露文件系统给 renderer。

```text
runtime/
├── config.json
├── secrets.json
├── projects.json
├── mcp.json
├── skills.json
├── user-skills/
├── memories/
│   ├── .setsuna-memory-root.json
│   ├── memories.json
│   ├── MEMORY.md
│   ├── memory_summary.md
│   └── rollout_summaries/
├── usage.jsonl
└── threads/
    ├── index.json
    ├── <threadId>.json
    └── <threadId>.events.jsonl
```

用户配置 `storagePath` 后，memory 的 active root 是 `<storagePath>/.setsuna-memory/`，不会把所选目录本身视为 runtime 所有。清空记忆只删除带有效所有权 marker 的专属 root 内容；runtime data dir 下的默认 root 仍作为回退读取来源。Phase 2 使用内部 snapshot baseline 生成增量 diff，不初始化、读取或删除用户目录中的 Git 仓库。

## 数据安全

- API key 不在 `RuntimeConfigState.providers` 中明文返回，只暴露 `apiKeySet` 和 `apiKeyPreview`。
- `secrets.json` 写入后尝试 `chmod 0600`。
- workspace 文件访问都要防止路径逃逸。
- MCP list 只暴露 env/header key，不返回值。
- renderer 不能拿到 runtime token。

## 变更扩散范例

新增一个 runtime preference：

1. `config.ts` 加字段。
2. `FileConfigStore` normalize、default、toState、save。
3. `SettingsPage.tsx` 增加 UI。
4. `useRuntimeClientState.saveRuntimePreferences()` 类型允许该字段。
5. 如果影响 AgentLoop，在 `agent-loop.ts` 读取 runtimeConfig。
6. 加 store 或 UI 测试。

新增一个 toolRun 展示字段：

1. `threads.ts` 更新 `RuntimeToolRun`。
2. 工具执行处写入 event payload 或 toolRun data。
3. `thread-events.ts` 投影字段。
4. `RuntimeToolRuns.tsx` 展示。
5. 添加 projection 和 renderer 测试。

新增一个 provider：

1. `provider.ts` 扩展 `ModelProviderKind`。
2. 新增 model client adapter。
3. `ConfiguredModelClient` 选择 adapter。
4. `model-discovery.ts` 支持模型列表。
5. `SettingsPage.tsx` 加 provider 表单逻辑。
6. provider adapter tests。

## 测试真源

contracts 层测试特别重要：

- `thread-events.test.ts`：线程投影是否稳定。
- `swe-events.test.ts`：app-server 映射是否兼容。

只要 runtime event 或 thread message 结构变化，都应优先补这里的测试，再补上层测试。
