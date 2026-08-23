# 测试与验证

测试按模块放在独立 `test/`，镜像生产 `src/`。生产目录不放 `*.test.*`，构建 tsconfig 不包含测试。

## 测试层

### Unit / lightweight

```bash
pnpm test:unit
```

覆盖：

- Contracts reducer/mapper。
- Runtime 协作者和 adapter。
- Main 纯逻辑/service。
- Renderer pure helper、hook 和组件。
- Scripts。

### Integration

```bash
pnpm test:integration
```

覆盖较重链路：

- Agent loop。
- Runtime server。
- SQLite/文件 watcher。
- MCP fixtures。
- Git/review。
- Shell/PTY。

集成测试串行执行以减少共享进程、端口和 filesystem 的竞态。

### Release

```bash
pnpm test:release
```

先准备固定版本 bundled ripgrep，再运行必须在各打包平台验证的 Main、Git、路径、Shell、Store、workspace 和构建脚本门禁。完整 unit 套件由 release workflow 的单独 quality-gate job 运行一次，不在四个平台重复执行纯 Contract/Renderer 测试。

### All

```bash
pnpm test
```

依次运行 unit 和 integration。`test:all` 使用默认全量 Vitest 配置，日常优先使用分层 script。

## 定向测试

先确认 package script 和 Vitest config，再从已有命令派生：

```bash
pnpm test:unit -- packages/contracts/test/thread-events.test.ts
pnpm test:unit -- apps/desktop/renderer/test/unit/services/runtime-client/client.test.ts
pnpm test:integration -- packages/desktop-runtime/test/integration/agent-loop/queued-turn-inputs.test.ts
```

保留 pnpm、runner 和 config，不直接用 `npx vitest`。

## 模块对应

| 改动 | 优先测试 |
| --- | --- |
| Contract/event | `packages/contracts/test/` |
| Runtime loop | `packages/desktop-runtime/test/loop/` + `integration/agent-loop/` |
| Runtime route | `test/server/` + `integration/runtime-server/` |
| Store | `test/adapters/store/` + legacy/recovery fixture |
| Provider | `test/adapters/model/` + history/compaction |
| Tool/MCP/Skill/Plugin | 对应 adapter + AgentLoop integration |
| Main | `apps/desktop/main/test/unit/<domain>/` |
| Review/terminal | Review 使用 app main integration；Terminal 使用 `packages/features/terminal/test/integration/main/` |
| Renderer | `apps/desktop/renderer/test/unit/` 镜像 feature |
| Build/release script | `scripts/test/` + `test:release` |

## Typecheck 与 architecture

```bash
pnpm typecheck
```

会先执行：

- Layer dependency 检查。
- Contracts cycle。
- `src/` 测试隔离。
- Build artifact 测试隔离。
- 单文件/目录密度。
- `Tree.md` 同步。

然后运行 TypeScript project references。

## Lint 与 build

```bash
pnpm lint
pnpm build
```

Lint 检查源码规范。Build 验证：

- Contracts/runtime 编译。
- Main/preload/runtime bundle。
- Renderer Vite build。
- 跨包产物引用。

文档-only 不需要跑全 build。

## 文档验证

最低：

```bash
pnpm docs:tree
git diff --check
```

还应检查：

- Markdown 相对链接存在。
- 源码路径仍存在。
- 没有旧文档路径引用。
- `Tree.md` 展示新的 docs 目录。

大规模文档重组建议再运行 `pnpm typecheck`，确认 generated tree 和 AGENTS 导航一致。

## 测试编写规则

- Production 与 test 严格分离。
- Test 路径镜像 source path。
- 共享大型 setup 放 `test/support/`。
- Integration fixture 放 `test/fixtures/`。
- 使用临时目录和随机 loopback port。
- Cleanup 放 `finally/afterEach`。
- 不依赖用户 home、全局 Git config、系统 rg 或现有数据根。
- 时间、ID、provider、port 尽量注入 fake。
- 同时测试失败/取消/recovery，不只 happy path。

## 文档-only 交付

通常运行：

```bash
pnpm docs:tree
git diff --check
```

如果还修改 `AGENTS.md`、生成器、package script 或构建说明，追加 `pnpm typecheck`。

