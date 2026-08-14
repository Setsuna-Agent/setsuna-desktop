# Runtime 存储

源码目录：`packages/desktop-runtime/src/adapters/store/`

Runtime 把不同数据域分开持久化，使迁移、恢复和排障可以按领域进行。Thread event log 是线程状态真源，其他 store 不应暗中修改 thread snapshot。

## 数据布局

`runtime-factory.ts` 把选定 data root 的 `runtime/` 作为 store 根：

```text
runtime/
├── config.json
├── secrets.json
├── projects.json
├── mcp.json
├── skills.json
├── plugins.json
├── user-skills/
├── plugin-skill-overrides/
├── plugins/
├── attachments/
├── generated-images/
├── pc-local-policies/
├── memories/
├── usage.jsonl
├── threads.sqlite
├── threads/                 # legacy import source
└── temporary-workspace/
```

准确受管文件名以 `storage-file-name.ts`、各 store 和 main data-root manifest 为准。

## JSON 基础

### `json-file.ts`

为小型 store 提供：

- JSON 读取。
- 缺失/default。
- 临时文件 + rename 原子写入。
- 错误保留上下文。

Store 自己负责 schema normalize，不能把任意 parsed object 直接当 contract state。

### `file-state-coordinator.ts`

串行化同一文件的状态读写，避免多个 async mutation 基于旧 snapshot 互相覆盖。

### `storage-file-name.ts` / `security/runtime-id.ts`

把 runtime ID 规范化为安全文件名，拒绝路径分隔符和逃逸。用户/模型给出的 ID 不能直接拼路径。

## Config 与 secrets

### `file-config-store.ts`

负责：

- Config defaults/normalize/save。
- Provider、models、task models。
- Approval、permission、style、global prompt、feature flags。
- Hooks 与 desktop/runtime settings。
- 对外 state 脱敏。
- Global prompt 等字段长度限制。

`config.json` 不保存明文 provider key；`secrets.json` 保存 runtime secret，写入后尝试 `chmod 0600`，并可通过 main native bridge 管理 OS-backed secret。

Input 中未提供 key 表示不覆盖；不能把 UI 空输入误解释为删除已有 key。

## SQLite thread store

### `sqlite-thread-store.ts`

主线程数据库：

- WAL。
- Foreign keys。
- Transactions。
- Runtime owner lease/fencing。
- Thread summary。
- Snapshot checkpoint。
- Durable lifecycle events + bounded transient `runtime_events` tail。
- 独立 `thread_messages` 顺序索引，用于游标分页。

关键字段/约束：

- `(thread_id, seq)` 唯一。
- Event ID 唯一。
- `threads.last_seq`。
- Snapshot JSON + `snapshot_seq`。
- `events_archived_through_seq` 与 `message_index_seq`。
- `runtime_owner` lease。

### Append

一次 event append 在事务中：

1. 校验 owner/fencing。
2. 分配 next seq。
3. 写 event。
4. 用 reducer 更新 snapshot。
5. Copy-on-write 同步受影响的 message index row。
6. 按策略写 checkpoint/summary，并把已被 checkpoint 覆盖的旧 streaming delta 压缩归档。
7. Commit。

只有 commit 成功后 `RuntimeEventWriter` 才发布 SSE。

高频 delta 可以延迟完整 checkpoint；恢复时重放 `snapshot_seq` 之后的短 tail。
`message.delta`、reasoning/item/plan delta、tool preview/output delta 可以在检查点后从热表移入
gzip archive；完整事件仍可无损重放，turn、approval、error、completion 等生命周期/审计事件
持续留在热表。请求序号早于归档边界时，store 返回 retention gap，由 Thread SSE 发送
canonical snapshot resync。

消息分页使用稳定的 `message_index < before` 游标。追加消息只插入一行，普通 delta
只更新 copy-on-write 改变的行；删除、截断和清空才重建索引。

### Recovery

- 取得/续租 runtime owner。
- 拒绝第二个有效 runtime。
- 读取 snapshot checkpoint。
- 重放 event tail。
- v1 → v2 原地增加 retention marker 和 message index；首次读取旧 thread 时回填索引。
- 结算 stale streaming turn 由 server lifecycle 完成。

### Legacy JSON import

`legacy-json-thread-reader.ts` 支持旧 `threads/*.json/.jsonl`：

- 首次 SQLite 启动只读导入。
- 不截断旧文件。
- 不双写。
- 缺号/乱序等无法证明的损坏停止迁移。
- 有连续后续事件且最终 snapshot 可佐证时，特定重复 seq 可 last-writer-wins，并记录被替换信息。

Legacy import 测试使用冻结的历史 JSON/JSONL fixture，避免由当前实现动态生成旧格式而掩盖兼容性回归。

## Attachments

`file-attachment-store.ts`：

- 本地文件只保存原路径引用和 metadata，不复制源文件；只有无本地路径的图片保存受管字节。
- 本地引用解析为精确文件只读 root；删除引用或 thread 不会删除用户的原文件。
- 受管图片验证名称、MIME 以及 PNG/JPEG/GIF/WebP 的真实文件签名；本地链接不设大小上限，无路径图片的单次托管请求保留独立的内存安全边界。
- 临时 asset 在 turn/thread 认领后转为持久化归属。
- Recovery 清理无主或不完整 staging。
- Thread 删除/消息截断时由协调层清理不再引用 asset。

本地路径不是 attachment ID，也不会进入 renderer 状态或线程事件。

## Generated images

`file-generated-image-store.ts`：

- 保存图片 generation 的 managed asset。
- 校验受支持格式和大小。
- 提供 renderer preview / model attachment 读取。
- Recovery 根据 thread store 中仍被引用的 asset ID 保留，清理孤儿。

`memory-phase2-workspace.ts` 与 generated image 不属于同一生命周期。

## MCP

`file-mcp-store.ts`：

- `mcp.json` 兼容 `mcpServers` 和 legacy `servers`。
- `stdio` / `streamable_http`。
- Enabled、required、timeout、approval、tool allow/deny。
- Env/header secret 通过 native bridge/store 分离。
- List 只返回 key，不返回 value。
- 启动时迁移 legacy secrets。

MCP connection 是内存 adapter，不持久化 socket/session。

## Memory

### `file-memory-store.ts`

Active root 固定为：

```text
runtime/memories/
```

支持：

- Global / project scope。
- Active / passive origin。
- Source thread/turn。
- Title、tags、summary。
- Query、create/delete/clear。
- Preview。

旧外部 `storagePath` 由 Electron main 的维护模式导入；正常 runtime 不再读取外部旧目录。

### 相关 helper

- `file-memory-store-model.ts`：数据 normalize/merge。
- `memory-storage-root.ts`：active root ownership marker。
- `memory-phase2-workspace.ts`：增量 consolidation 的内部 workspace/baseline。

清空 memory 要验证 active root marker，不能接受任意路径。

## Usage

`file-usage-store.ts`：

- Append-only `usage.jsonl`。
- 按 thread/provider/model/time 查询。
- Summary/bucket 聚合。
- 只有模型返回 usage 时写记录。
- Config provider metadata 用于安全展示，不保存 API key。

部分写入/坏尾行需要有明确读取策略，不能让一条坏记录抹掉全部历史。

## Policy stores

### `file-persistent-tool-approval-store.ts`

保存用户选择的持久化工具批准规则，与 MCP 配置协调 key。

### `file-policy-amendment-store.ts`

保存 runtime permission/policy amendment。

旧 PC local exec/shell policy 只从 `runtime/pc-local-policies/` 加载；main 负责从旧 home 路径维护导入。

## Workspace project

`FileWorkspaceProjectStore` 位于 `adapters/workspace/`，但持久化 `projects.json`：

- Project ID/path/name/git root。
- List/add/archive/remove。
- 文件 list/read/search 限制在 project root。
- Temporary workspace 也通过 port 统一管理。

Search 实现独立为 `WorkspaceSearchEngine`，不把 ripgrep process 状态写入 project JSON。

## Skill 与 Plugin

它们不位于 `adapters/store/`，但属于 runtime 数据：

- `skills.json` 保存 enable 状态。
- `user-skills/<id>/SKILL.md` 保存用户 Skill。
- `plugin-skill-overrides/<plugin>/<skill>/` 保存 Plugin Skill 的可编辑副本或删除标记，并按 Plugin 安装实例隔离。
- `plugins.json` 保存安装所有权和 manifest 摘要。
- `plugins/<id>/` 是 runtime 私有副本。

内置 `skills/` 和默认 `plugins/` 是应用只读资源，不在 runtime root 原地修改。

## Debug trace

`InMemoryRuntimeDebugTraceStore` 故意不落盘：

- 每 thread 最多 10,000 条。
- LRU 最多跟踪 50 个 thread。
- 返回 `droppedBeforeSeq`。
- Runtime 重启自然清空。

不要把它加入数据根备份或 thread recovery。

## 修改持久化格式

1. 明确 owner store。
2. 加 normalize/default。
3. 决定 lazy compatibility 还是显式 migration。
4. 更新 main data-root manifest/validation。
5. 保持原子写入或事务。
6. 定义损坏输入、半写、并发和 recovery。
7. 避免把 secret/private path 暴露到 state。
8. 添加旧 fixture round-trip。

## 测试

- `test/adapters/store/`
- `test/integration/adapters/store/file-memory-store.test.ts`
- `test/runtime/event-coordinated-thread-store.test.ts`
- `test/integration/runtime-server/rest-runtime-state.test.ts`
- Contracts `thread-events.test.ts`

SQLite 修改还要覆盖 owner fencing、checkpoint tail、legacy import 和 close/WAL。
