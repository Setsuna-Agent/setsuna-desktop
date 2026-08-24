# Repository Tree

> 此文件由 `pnpm docs:tree` 生成。不要手工维护逐文件清单；职责和设计约束写在 `docs/`。

## 分层方向

- Core 技术层：`contracts -> runtime -> Electron main/preload -> renderer`。
- 纵向业务层：`feature-core + packages/features/*/{contracts,runtime,renderer,main,preload} -> 各进程显式 composition root`。

- 生产代码只放在各模块的 `src/`。
- 测试只放在独立的 `test/`，并镜像生产目录。
- renderer 按 `app / features / services / shared` 组织；纵向 Feature presentation 由对应 package 拥有。
- runtime 的 Agent loop 按 `core / context / lifecycle / memory / tools` 组织，实现通过 ports/adapters 隔离。

## 常用入口

| 改动类型 | 入口 |
| --- | --- |
| Electron 启动与 IPC | `apps/desktop/main/src/index.ts`、`apps/desktop/main/src/ipc/` |
| preload 安全桥 | `apps/desktop/preload/src/index.ts` |
| renderer 顶层编排 | `apps/desktop/renderer/src/app/` |
| 聊天、设置、能力、工作区 | `apps/desktop/renderer/src/features/` |
| runtime client 与事件同步 | `apps/desktop/renderer/src/services/runtime-client/` |
| 共享 UI、样式与偏好 | `apps/desktop/renderer/src/shared/` |
| 共享 DTO 与事件 reducer | `packages/contracts/src/` |
| Feature composition kernel | `packages/feature-core/src/` |
| 纵向 Feature owner | `packages/features/*/src/{contracts,runtime,renderer,main,preload}/` |
| Agent turn 生命周期 | `packages/desktop-runtime/src/loop/{core,context,lifecycle,memory,tools}/` |
| runtime HTTP/SSE | `packages/desktop-runtime/src/server/` |
| 存储、模型、MCP、工具实现 | `packages/desktop-runtime/src/adapters/` |
| runtime 抽象边界 | `packages/desktop-runtime/src/ports/` |
| 单元与集成测试 | 各模块独立的 `test/`，目录镜像对应 `src/` |

## 目录索引

目录后的数字分别表示直属文件数和递归文件总数；生成物与依赖目录不会进入索引。

### `apps/desktop/main/`

```text
apps/desktop/main/ — 0 direct / 95 total files
├── src/ — 2 direct / 61 total files
│   ├── composition/ — 2 direct / 2 total files
│   ├── data-root/ — 14 direct / 14 total files
│   ├── i18n/ — 1 direct / 1 total files
│   ├── ipc/ — 10 direct / 10 total files
│   ├── network-proxy/ — 7 direct / 7 total files
│   ├── runtime/ — 8 direct / 8 total files
│   ├── security/ — 2 direct / 2 total files
│   ├── updater/ — 3 direct / 3 total files
│   ├── window/ — 6 direct / 8 total files
│   │   └── splash/ — 2 direct / 2 total files
│   ├── windows-sandbox/ — 1 direct / 1 total files
│   └── workspace/ — 3 direct / 3 total files
└── test/ — 34 files
    ├── support/ — 2 direct / 2 total files
    └── unit/ — 1 direct / 32 total files
        ├── data-root/ — 8 direct / 8 total files
        ├── network-proxy/ — 2 direct / 2 total files
        ├── runtime/ — 7 direct / 7 total files
        ├── security/ — 2 direct / 2 total files
        ├── updater/ — 2 direct / 2 total files
        ├── window/ — 4 direct / 6 total files
        │   └── splash/ — 2 direct / 2 total files
        ├── windows-sandbox/ — 1 direct / 1 total files
        └── workspace/ — 3 direct / 3 total files
```

### `apps/desktop/preload/`

```text
apps/desktop/preload/ — 0 direct / 2 total files
└── src/ — 1 direct / 2 total files
    └── composition/ — 1 direct / 1 total files
```

### `apps/desktop/renderer/`

```text
apps/desktop/renderer/ — 0 direct / 651 total files
├── src/ — 2 direct / 472 total files
│   ├── app/ — 2 direct / 39 total files
│   │   ├── controller/ — 7 direct / 7 total files
│   │   ├── layout/ — 15 direct / 15 total files
│   │   ├── providers/ — 2 direct / 2 total files
│   │   ├── sidebar/ — 8 direct / 8 total files
│   │   └── styles/ — 5 direct / 5 total files
│   ├── composition/ — 13 direct / 13 total files
│   ├── features/ — 329 files
│   │   ├── capabilities/ — 21 direct / 31 total files
│   │   │   ├── hooks/ — 2 direct / 2 total files
│   │   │   ├── mcp/ — 3 direct / 3 total files
│   │   │   └── styles/ — 5 direct / 5 total files
│   │   ├── chat/ — 8 direct / 137 total files
│   │   │   ├── artifacts/ — 6 direct / 6 total files
│   │   │   ├── composer/ — 31 direct / 31 total files
│   │   │   ├── conversation/ — 35 direct / 35 total files
│   │   │   ├── hooks/ — 10 direct / 10 total files
│   │   │   ├── markdown/ — 11 direct / 11 total files
│   │   │   ├── mentions/ — 4 direct / 4 total files
│   │   │   ├── references/ — 1 direct / 1 total files
│   │   │   ├── skills/ — 2 direct / 2 total files
│   │   │   ├── styles/ — 10 direct / 10 total files
│   │   │   ├── subagents/ — 1 files
│   │   │   │   └── avatars/ — 1 direct / 1 total files
│   │   │   └── tool-runs/ — 18 direct / 18 total files
│   │   ├── conversation-debug/ — 17 direct / 17 total files
│   │   ├── runtime-activity/ — 5 direct / 6 total files
│   │   │   └── styles/ — 1 direct / 1 total files
│   │   ├── settings/ — 12 direct / 65 total files
│   │   │   ├── components/ — 2 direct / 2 total files
│   │   │   ├── data-root/ — 12 direct / 12 total files
│   │   │   ├── network-proxy/ — 3 direct / 3 total files
│   │   │   ├── providers/ — 6 direct / 6 total files
│   │   │   ├── sections/ — 7 direct / 7 total files
│   │   │   ├── shortcuts/ — 1 direct / 1 total files
│   │   │   ├── styles/ — 11 direct / 11 total files
│   │   │   ├── usage/ — 9 direct / 9 total files
│   │   │   └── windows-sandbox/ — 2 direct / 2 total files
│   │   └── workspace/ — 24 direct / 73 total files
│   │       ├── assets/ — 21 direct / 21 total files
│   │       ├── editor/ — 3 direct / 3 total files
│   │       ├── git/ — 2 direct / 2 total files
│   │       ├── hooks/ — 12 direct / 12 total files
│   │       ├── model/ — 2 direct / 2 total files
│   │       └── styles/ — 9 direct / 9 total files
│   ├── services/ — 10 files
│   │   └── runtime-client/ — 10 direct / 10 total files
│   └── shared/ — 79 files
│       ├── assets/ — 1 direct / 21 total files
│       │   └── provider-logos/ — 20 direct / 20 total files
│       ├── branding/ — 2 direct / 2 total files
│       ├── code/ — 4 direct / 4 total files
│       ├── hooks/ — 3 direct / 3 total files
│       ├── i18n/ — 18 direct / 18 total files
│       ├── lib/ — 6 direct / 6 total files
│       ├── preferences/ — 6 direct / 6 total files
│       ├── shortcuts/ — 3 direct / 3 total files
│       ├── styles/ — 8 direct / 8 total files
│       └── ui/ — 8 direct / 8 total files
└── test/ — 179 files
    └── unit/ — 179 files
        ├── app/ — 1 direct / 15 total files
        │   ├── controller/ — 3 direct / 3 total files
        │   ├── layout/ — 6 direct / 6 total files
        │   ├── providers/ — 1 direct / 1 total files
        │   └── sidebar/ — 4 direct / 4 total files
        ├── composition/ — 3 direct / 3 total files
        ├── features/ — 135 files
        │   ├── capabilities/ — 11 direct / 12 total files
        │   │   └── hooks/ — 1 direct / 1 total files
        │   ├── chat/ — 3 direct / 75 total files
        │   │   ├── artifacts/ — 4 direct / 4 total files
        │   │   ├── composer/ — 21 direct / 21 total files
        │   │   ├── conversation/ — 25 direct / 25 total files
        │   │   ├── hooks/ — 5 direct / 5 total files
        │   │   ├── markdown/ — 6 direct / 6 total files
        │   │   ├── mentions/ — 3 direct / 3 total files
        │   │   ├── skills/ — 1 direct / 1 total files
        │   │   └── tool-runs/ — 7 direct / 7 total files
        │   ├── conversation-debug/ — 7 direct / 7 total files
        │   ├── runtime-activity/ — 3 direct / 3 total files
        │   ├── settings/ — 13 direct / 21 total files
        │   │   ├── data-root/ — 2 direct / 2 total files
        │   │   ├── usage/ — 5 direct / 5 total files
        │   │   └── windows-sandbox/ — 1 direct / 1 total files
        │   └── workspace/ — 8 direct / 17 total files
        │       ├── hooks/ — 8 direct / 8 total files
        │       └── model/ — 1 direct / 1 total files
        ├── services/ — 8 files
        │   └── runtime-client/ — 8 direct / 8 total files
        └── shared/ — 18 files
            ├── branding/ — 1 direct / 1 total files
            ├── code/ — 1 direct / 1 total files
            ├── hooks/ — 2 direct / 2 total files
            ├── i18n/ — 1 direct / 1 total files
            ├── lib/ — 3 direct / 3 total files
            ├── preferences/ — 5 direct / 5 total files
            ├── shortcuts/ — 2 direct / 2 total files
            └── ui/ — 3 direct / 3 total files
```

### `packages/contracts/`

```text
packages/contracts/ — 4 direct / 75 total files
├── src/ — 33 direct / 48 total files
│   ├── event-projections/ — 3 direct / 3 total files
│   ├── network-proxy/ — 1 direct / 1 total files
│   ├── review/ — 1 direct / 1 total files
│   └── swe/ — 10 direct / 10 total files
└── test/ — 14 direct / 23 total files
    ├── support/ — 1 direct / 1 total files
    ├── swe/ — 1 direct / 1 total files
    └── swe-events/ — 7 direct / 7 total files
```

### `packages/feature-core/`

```text
packages/feature-core/ — 4 direct / 30 total files
├── src/ — 8 direct / 22 total files
│   ├── internal/ — 3 direct / 3 total files
│   ├── main/ — 1 direct / 1 total files
│   ├── preload/ — 1 direct / 1 total files
│   ├── renderer/ — 5 direct / 5 total files
│   └── runtime/ — 4 direct / 4 total files
└── test/ — 4 files
    ├── composition/ — 1 direct / 1 total files
    ├── preload/ — 1 direct / 1 total files
    ├── renderer/ — 1 direct / 1 total files
    └── runtime/ — 1 direct / 1 total files
```

### `packages/features/`

```text
packages/features/ — 0 direct / 321 total files
├── browser/ — 2 direct / 70 total files
│   ├── src/ — 51 files
│   │   ├── contracts/ — 8 direct / 8 total files
│   │   ├── main/ — 13 direct / 16 total files
│   │   │   └── cdp/ — 3 direct / 3 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   ├── renderer/ — 21 direct / 21 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 17 files
│       ├── main/ — 6 direct / 8 total files
│       │   └── cdp/ — 2 direct / 2 total files
│       ├── renderer/ — 7 direct / 7 total files
│       └── runtime/ — 2 direct / 2 total files
├── collaboration/ — 2 direct / 48 total files
│   ├── src/ — 41 files
│   │   ├── contracts/ — 7 direct / 7 total files
│   │   ├── renderer/ — 13 direct / 29 total files
│   │   │   └── avatars/ — 16 direct / 16 total files
│   │   └── runtime/ — 5 direct / 5 total files
│   └── test/ — 5 files
│       ├── contracts/ — 1 direct / 1 total files
│       ├── renderer/ — 2 direct / 2 total files
│       └── runtime/ — 2 direct / 2 total files
├── goal/ — 2 direct / 30 total files
│   ├── src/ — 23 files
│   │   ├── contracts/ — 6 direct / 6 total files
│   │   ├── renderer/ — 8 direct / 8 total files
│   │   └── runtime/ — 9 direct / 9 total files
│   └── test/ — 5 files
│       ├── renderer/ — 2 direct / 2 total files
│       └── runtime/ — 3 direct / 3 total files
├── image-generation/ — 3 direct / 20 total files
│   ├── src/ — 15 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 7 direct / 7 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 2 files
│       └── runtime/ — 2 direct / 2 total files
├── memory/ — 2 direct / 29 total files
│   ├── src/ — 23 files
│   │   ├── contracts/ — 7 direct / 7 total files
│   │   ├── renderer/ — 6 direct / 6 total files
│   │   └── runtime/ — 10 direct / 10 total files
│   └── test/ — 4 files
│       └── runtime/ — 4 direct / 4 total files
├── review/ — 2 direct / 20 total files
│   ├── src/ — 14 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── main/ — 8 direct / 8 total files
│   │   └── preload/ — 2 direct / 2 total files
│   └── test/ — 4 files
│       ├── integration/ — 2 files
│       │   └── main/ — 2 direct / 2 total files
│       └── main/ — 2 direct / 2 total files
├── terminal/ — 2 direct / 24 total files
│   ├── src/ — 18 files
│   │   ├── contracts/ — 3 direct / 3 total files
│   │   ├── main/ — 5 direct / 5 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 8 direct / 8 total files
│   └── test/ — 4 files
│       ├── integration/ — 1 files
│       │   └── main/ — 1 direct / 1 total files
│       ├── main/ — 1 direct / 1 total files
│       └── renderer/ — 2 direct / 2 total files
├── vision-recognition/ — 2 direct / 18 total files
│   ├── src/ — 14 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 6 direct / 6 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 2 files
│       └── runtime/ — 2 direct / 2 total files
└── webdav-sync/ — 2 direct / 62 total files
    ├── src/ — 42 files
    │   ├── contracts/ — 4 direct / 4 total files
    │   ├── main/ — 21 direct / 21 total files
    │   ├── preload/ — 2 direct / 2 total files
    │   └── renderer/ — 15 direct / 15 total files
    └── test/ — 18 files
        ├── main/ — 12 direct / 12 total files
        ├── renderer/ — 3 direct / 3 total files
        └── support/ — 3 direct / 3 total files
```

### `packages/desktop-runtime/`

```text
packages/desktop-runtime/ — 4 direct / 563 total files
├── src/ — 2 direct / 330 total files
│   ├── adapters/ — 140 files
│   │   ├── approval/ — 1 direct / 1 total files
│   │   ├── debug/ — 1 direct / 1 total files
│   │   ├── event/ — 2 direct / 2 total files
│   │   ├── feature/ — 1 direct / 1 total files
│   │   ├── id/ — 1 direct / 1 total files
│   │   ├── mcp/ — 6 direct / 6 total files
│   │   ├── model/ — 30 direct / 30 total files
│   │   ├── native/ — 1 direct / 1 total files
│   │   ├── network/ — 1 direct / 1 total files
│   │   ├── plugin/ — 7 direct / 7 total files
│   │   ├── sandbox/ — 1 files
│   │   │   └── windows-native/ — 1 direct / 1 total files
│   │   ├── search/ — 5 direct / 5 total files
│   │   ├── skill/ — 4 direct / 4 total files
│   │   ├── store/ — 32 direct / 32 total files
│   │   ├── tool/ — 15 direct / 37 total files
│   │   │   └── pc-local/ — 22 direct / 22 total files
│   │   └── workspace/ — 10 direct / 10 total files
│   ├── composition/ — 2 direct / 2 total files
│   ├── extensions/ — 7 direct / 7 total files
│   ├── features/ — 5 files
│   │   ├── events/ — 1 direct / 1 total files
│   │   ├── management/ — 1 direct / 1 total files
│   │   ├── routes/ — 1 direct / 1 total files
│   │   └── settings/ — 2 direct / 2 total files
│   ├── hooks/ — 3 direct / 3 total files
│   ├── loop/ — 65 files
│   │   ├── approval-review/ — 5 direct / 5 total files
│   │   ├── context/ — 15 direct / 15 total files
│   │   ├── core/ — 21 direct / 21 total files
│   │   ├── lifecycle/ — 12 direct / 12 total files
│   │   └── tools/ — 12 direct / 12 total files
│   ├── ports/ — 33 direct / 33 total files
│   ├── runtime/ — 3 direct / 11 total files
│   │   └── use-cases/ — 8 direct / 8 total files
│   ├── security/ — 5 direct / 5 total files
│   ├── server/ — 25 direct / 48 total files
│   │   └── app-server/ — 23 direct / 23 total files
│   ├── shared/ — 3 direct / 3 total files
│   └── utils/ — 6 direct / 6 total files
└── test/ — 229 files
    ├── adapters/ — 67 files
    │   ├── approval/ — 1 direct / 1 total files
    │   ├── debug/ — 1 direct / 1 total files
    │   ├── feature/ — 1 direct / 1 total files
    │   ├── mcp/ — 5 direct / 5 total files
    │   ├── model/ — 10 direct / 10 total files
    │   ├── native/ — 1 direct / 1 total files
    │   ├── network/ — 1 direct / 1 total files
    │   ├── plugin/ — 5 direct / 5 total files
    │   ├── sandbox/ — 1 files
    │   │   └── windows-native/ — 1 direct / 1 total files
    │   ├── search/ — 4 direct / 4 total files
    │   ├── skill/ — 1 direct / 1 total files
    │   ├── store/ — 15 direct / 15 total files
    │   ├── tool/ — 10 direct / 15 total files
    │   │   └── pc-local/ — 5 direct / 5 total files
    │   └── workspace/ — 6 direct / 6 total files
    ├── extensions/ — 7 direct / 7 total files
    ├── features/ — 3 files
    │   ├── events/ — 1 direct / 1 total files
    │   ├── routes/ — 1 direct / 1 total files
    │   └── settings/ — 1 direct / 1 total files
    ├── fixtures/ — 7 files
    │   ├── history/ — 2 direct / 2 total files
    │   ├── legacy-thread-store/ — 3 files
    │   │   └── threads/ — 3 direct / 3 total files
    │   └── mcp/ — 2 direct / 2 total files
    ├── integration/ — 47 files
    │   ├── adapters/ — 8 files
    │   │   ├── skill/ — 1 direct / 1 total files
    │   │   ├── store/ — 1 direct / 1 total files
    │   │   └── tool/ — 6 direct / 6 total files
    │   ├── agent-loop/ — 24 direct / 24 total files
    │   └── runtime-server/ — 15 direct / 15 total files
    ├── loop/ — 30 files
    │   ├── approval-review/ — 1 direct / 1 total files
    │   ├── context/ — 12 direct / 12 total files
    │   ├── core/ — 6 direct / 6 total files
    │   ├── lifecycle/ — 6 direct / 6 total files
    │   └── tools/ — 5 direct / 5 total files
    ├── runtime/ — 2 direct / 7 total files
    │   └── use-cases/ — 5 direct / 5 total files
    ├── security/ — 3 direct / 3 total files
    ├── server/ — 6 direct / 11 total files
    │   └── app-server/ — 5 direct / 5 total files
    ├── shared/ — 2 direct / 2 total files
    ├── support/ — 3 direct / 42 total files
    │   ├── agent-loop/ — 22 direct / 22 total files
    │   └── runtime-server/ — 17 direct / 17 total files
    └── utils/ — 3 direct / 3 total files
```

### `scripts/`

```text
scripts/ — 22 direct / 35 total files
├── ripgrep/ — 3 direct / 3 total files
├── test/ — 4 direct / 6 total files
│   ├── ripgrep/ — 1 direct / 1 total files
│   └── windows-sandbox/ — 1 direct / 1 total files
└── windows-sandbox/ — 4 direct / 4 total files
```

### `skills/`

```text
skills/ — 0 direct / 6 total files
├── create-mcp-in-chat/ — 1 direct / 1 total files
├── create-plugin-in-chat/ — 1 direct / 2 total files
│   └── agents/ — 1 direct / 1 total files
├── create-skill-in-chat/ — 1 direct / 1 total files
└── goal-writer/ — 1 direct / 2 total files
    └── agents/ — 1 direct / 1 total files
```

### `plugins/`

```text
plugins/ — 1 direct / 61 total files
├── audit-file-mutations/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
├── claude-rules/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── extension/ — 1 direct / 1 total files
├── compact-warning/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
├── context7-docs/ — 3 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── skills/ — 2 files
│       └── context7-docs/ — 1 direct / 2 total files
│           └── agents/ — 1 direct / 1 total files
├── documents/ — 17 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── skills/ — 16 files
│       └── documents/ — 3 direct / 16 total files
│           ├── examples/ — 2 direct / 2 total files
│           ├── references/ — 2 direct / 2 total files
│           ├── scripts/ — 6 direct / 6 total files
│           └── tasks/ — 3 direct / 3 total files
├── guard-dangerous-shell/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
├── openai-docs/ — 3 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── skills/ — 2 files
│       └── openai-docs/ — 1 direct / 2 total files
│           └── agents/ — 1 direct / 1 total files
├── openai-image-generation/ — 4 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   ├── extension/ — 2 direct / 2 total files
│   └── skills/ — 1 files
│       └── image-generation/ — 1 direct / 1 total files
├── openai-vision-recognition/ — 4 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   ├── extension/ — 2 direct / 2 total files
│   └── skills/ — 1 files
│       └── vision-recognition/ — 1 direct / 1 total files
├── pdf/ — 3 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── skills/ — 2 files
│       └── pdf/ — 1 direct / 2 total files
│           └── agents/ — 1 direct / 1 total files
├── prompt-secret-detector/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
├── protect-generated-folders/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
├── protect-secret-paths/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
├── question/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── extension/ — 1 direct / 1 total files
├── session-start-project-guidance/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
├── stop-todo-continuation/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
├── todo/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── extension/ — 1 direct / 1 total files
└── web-search/ — 4 files
    ├── .setsuna-plugin/ — 1 direct / 1 total files
    └── extension/ — 3 direct / 3 total files
```

### `docs/`

```text
docs/ — 1 direct / 48 total files
├── apps/ — 13 files
│   └── desktop/ — 1 direct / 13 total files
│       ├── main/ — 5 direct / 5 total files
│       ├── preload/ — 1 direct / 1 total files
│       └── renderer/ — 6 direct / 6 total files
├── architecture/ — 6 direct / 6 total files
├── designs/ — 8 direct / 8 total files
├── development/ — 3 direct / 3 total files
├── packages/ — 12 files
│   ├── contracts/ — 4 direct / 4 total files
│   └── desktop-runtime/ — 8 direct / 8 total files
├── plugins/ — 3 direct / 3 total files
├── scripts/ — 1 direct / 1 total files
└── skills/ — 1 direct / 1 total files
```
