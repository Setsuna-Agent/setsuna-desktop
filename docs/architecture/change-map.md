# 变更扩散图

Setsuna Desktop 的关键功能通常跨越多个模块。这篇文档列出常见改动的最短完整链路，用来避免只改一层后留下协议漂移。

## 新增 Runtime REST API

按下面的顺序：

1. 在 `packages/contracts/src/` 定义输入、输出和错误所需类型。
2. 在 `packages/contracts/src/http.ts` 扩展 `DesktopRuntimeClient`。
3. 在 `packages/desktop-runtime/src/server/runtime-rest-routes.ts` 增加 route。
4. 把业务逻辑落到已有 store、AgentLoop facade、port 或 adapter；route 只做协议解析。
5. 在 `apps/desktop/renderer/src/services/runtime-client/client.ts` 实现方法。
6. 在 hook/feature 中调用方法，不直接拼 path。
7. 添加 server integration、client 和 feature 测试。

如果 API 是 SWE 客户端专用，优先走 `server/app-server/*`，不要同时增加相同语义的 renderer REST，除非两个调用方都确实需要。

## 新增 Runtime event

1. 在 `packages/contracts/src/events.ts` 扩展 event union。
2. 在 `thread-events.ts` 或 `thread-event-projection.ts` 定义可重放投影。
3. 在 runtime 通过 `RuntimeEventWriter` 写事件，保证先落盘后广播。
4. 检查 SQLite checkpoint 和 legacy normalization 是否需要兼容。
5. 检查 renderer `runtimeEvents.ts` 与相关 display helper。
6. 如果 app-server 需要感知，再更新 `packages/contracts/src/swe/` mapper。
7. 先补 contracts reducer 测试，再补 runtime 与 renderer 测试。

不要为了 debug 信息新增持久化事件；只读内部诊断优先使用 `RuntimeDebugTraceSink`。

## 新增 Electron / preload 能力

1. 在 contracts 的 `desktop.ts` 或对应领域文件定义 bridge 类型。
2. 在 `apps/desktop/main/src/ipc/` 增加或扩展注册模块。
3. 使用 `ipc/sender.ts` 校验可信 sender。
4. 在 `apps/desktop/preload/src/index.ts` 暴露固定方法。
5. 在 renderer 通过 bridge 调用。
6. 补 main 单元/集成测试和 renderer helper 测试。

涉及路径、外链、凭据、clipboard 或 guest `WebContents` 时，必须写清输入边界和失败语义。

## 新增线程字段

先判断字段属于哪一种：

- 持久化真源：需要 event payload + reducer。
- Snapshot 派生值：只改 projection，不应被多处直接写。
- UI 临时状态：留在 renderer hook，不进 contract。
- Provider 原生回放：进入经过校验的 `providerMetadata`，不能污染 portable semantic message。

持久化字段的典型链路：

```text
threads.ts / events.ts
  → thread-events reducer
  → runtime writer/store
  → REST/SSE
  → renderer projection/display
  → contracts + runtime + renderer tests
```

## 新增模型供应商或协议能力

1. 扩展 `model-provider.ts`、`model-request.ts` 或 `provider.ts` 的能力 contract。
2. 在 `ConfiguredModelClient` 注册 adapter。
3. 分开处理 prompt conversion、HTTP/SDK transport、stream bridge、usage 和 replay metadata。
4. 在 `model-discovery.ts` 支持模型列表与能力发现。
5. 检查 context compaction 和跨 provider semantic fallback。
6. 在 renderer provider 设置模型中增加配置，不把厂商私有 payload 泄漏到 UI。
7. 添加 adapter、replay、stream ordering、settings 和 integration 测试。

详细边界见 [模型适配器](../packages/desktop-runtime/model-providers.md)。

## 新增工具

1. 判断工具属于本地文件/进程、MCP、浏览器、管理能力还是第一方 Plugin 能力。
2. 复用或新增窄 `ToolHost`；外部依赖先定义 port。
3. 定义工具 schema、system prompt、审批、preview、取消和结果截断。
4. 在 `CompositeToolHost` 的合适位置组装，检查名称冲突。
5. 确认工具结果是否包含外部不可信上下文。
6. 如果产生用户可见状态，通过 event/toolRun 投影表达。
7. 添加 host 单元测试和 AgentLoop 工具链 integration 测试。

不要把新工具直接塞进 `AgentLoop`，也不要绕过 tool orchestrator 执行 mutation。

## 新增 Store 或持久化字段

1. 先定义 port 能力和数据所有权。
2. 决定是现有 JSON、JSONL、SQLite JSON payload，还是新文件。
3. 在 adapter 中统一 default、normalize、save、权限和原子写入。
4. 定义旧版本读取与迁移策略；不要靠调用方猜测缺省值。
5. 更新数据根 manifest/迁移分类，如果新文件必须随数据根搬迁。
6. 更新脱敏、备份、删除和 recovery 行为。
7. 添加 round-trip、损坏输入、并发/崩溃边界测试。

线程数据通常不应新增独立可变 store，而应继续通过 event log 和 snapshot checkpoint。

## 新增 Renderer feature

1. 在 `features/<name>/` 建立业务闭环。
2. 页面编排留在 feature 根；复杂状态下沉到 `hooks/`。
3. 纯转换放同 feature 的 `.ts` helper。
4. 跨 feature runtime 状态仍由 `services/runtime-client` 持有。
5. 真正无业务归属的 primitive 才进入 `shared/`。
6. 样式建立 `styles/<feature>.css` 稳定入口，再按职责拆分。
7. 测试镜像到 `test/unit/features/<name>/`。

如果 feature 需要 main 能力，先完成 contract → IPC → preload 链路。

## 修改聊天行为

至少同时检查：

- `RuntimeMessage` / `RuntimeToolRun` 数据结构。
- Runtime event 与 reducer。
- AgentLoop 的 turn、cancel、queue、steer、regenerate 或 compaction 语义。
- Renderer 的 display item、assistant timeline、tool-run 和 scroll。
- 删除/截断后的历史回放。
- SSE 丢帧后的 snapshot 收敛。
- Contract projection、AgentLoop integration 和 renderer pure helper 测试。

Active turn 队列的完整设计见 [queued turn inputs](../designs/queued-turn-inputs.md)。

## 修改数据根或启动流程

同时检查：

- `data-root/bootstrap.ts` 的早期判定。
- main `index.ts` 是否在正确阶段创建服务。
- `data-root/coordinator.ts` 的 pending 阶段和恢复。
- `layout.ts` 的所有受管路径。
- runtime graceful shutdown 与迁移准入。
- renderer `DesktopDataRootGate` 和维护页面。
- macOS、Windows、Linux 的 volume/path 行为。
- source 永不提前删除和 custom root 不可用的恢复测试。

## 修改构建或发布

同时检查：

- `package.json` scripts 和 electron-builder `build` 配置。
- `scripts/build-electron.ts` 与 Vite/TypeScript 输出。
- `before-pack.cjs`、`after-pack.cjs` 和 native dependency。
- bundled ripgrep 的平台/架构映射。
- `.github/workflows/ci.yml`、`release.yml`。
- updater 的 asset 选择、命名和 checksum。
- `release-manifest.json`、`SHA256SUMS` 与 dry-run。
- [构建与发布文档](../development/build-and-release.md)。

## 最低验证

文档或目录变更：

```bash
pnpm docs:tree
git diff --check
```

代码变更先跑最相关的定向测试，再按影响面运行：

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

详细策略见 [测试与验证](../development/testing.md)。
