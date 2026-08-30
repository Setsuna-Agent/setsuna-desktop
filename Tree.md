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
apps/desktop/main/ — 0 direct / 71 total files
├── src/ — 2 direct / 44 total files
│   ├── composition/ — 3 direct / 3 total files
│   ├── data-root/ — 14 direct / 14 total files
│   ├── i18n/ — 1 direct / 1 total files
│   ├── ipc/ — 5 direct / 5 total files
│   ├── runtime/ — 7 direct / 7 total files
│   ├── security/ — 2 direct / 2 total files
│   ├── window/ — 6 direct / 8 total files
│   │   └── splash/ — 2 direct / 2 total files
│   └── workspace/ — 2 direct / 2 total files
└── test/ — 27 files
    ├── support/ — 2 direct / 2 total files
    └── unit/ — 1 direct / 25 total files
        ├── data-root/ — 8 direct / 8 total files
        ├── runtime/ — 6 direct / 6 total files
        ├── security/ — 2 direct / 2 total files
        ├── window/ — 4 direct / 6 total files
        │   └── splash/ — 2 direct / 2 total files
        └── workspace/ — 2 direct / 2 total files
```

### `apps/desktop/preload/`

```text
apps/desktop/preload/ — 0 direct / 2 total files
└── src/ — 1 direct / 2 total files
    └── composition/ — 1 direct / 1 total files
```

### `apps/desktop/renderer/`

```text
apps/desktop/renderer/ — 0 direct / 576 total files
├── src/ — 2 direct / 413 total files
│   ├── app/ — 3 direct / 41 total files
│   │   ├── controller/ — 6 direct / 6 total files
│   │   ├── layout/ — 17 direct / 17 total files
│   │   ├── providers/ — 2 direct / 2 total files
│   │   ├── sidebar/ — 8 direct / 8 total files
│   │   └── styles/ — 5 direct / 5 total files
│   ├── composition/ — 35 direct / 36 total files
│   │   └── renderer-plugins/ — 1 direct / 1 total files
│   ├── features/ — 234 files
│   │   ├── capabilities/ — 23 direct / 31 total files
│   │   │   ├── mcp/ — 3 direct / 3 total files
│   │   │   └── styles/ — 5 direct / 5 total files
│   │   ├── chat/ — 8 direct / 136 total files
│   │   │   ├── composer/ — 31 direct / 31 total files
│   │   │   ├── conversation/ — 32 direct / 32 total files
│   │   │   ├── hooks/ — 11 direct / 11 total files
│   │   │   ├── markdown/ — 13 direct / 13 total files
│   │   │   ├── mentions/ — 4 direct / 4 total files
│   │   │   ├── plugin-usage/ — 3 direct / 3 total files
│   │   │   ├── references/ — 1 direct / 1 total files
│   │   │   ├── skills/ — 2 direct / 2 total files
│   │   │   ├── styles/ — 10 direct / 10 total files
│   │   │   ├── subagents/ — 1 files
│   │   │   │   └── avatars/ — 1 direct / 1 total files
│   │   │   └── tool-runs/ — 20 direct / 20 total files
│   │   ├── settings/ — 5 direct / 36 total files
│   │   │   ├── components/ — 2 direct / 2 total files
│   │   │   ├── data-root/ — 12 direct / 12 total files
│   │   │   ├── sections/ — 7 direct / 7 total files
│   │   │   ├── shortcuts/ — 1 direct / 1 total files
│   │   │   └── styles/ — 9 direct / 9 total files
│   │   └── workspace/ — 13 direct / 31 total files
│   │       ├── editor/ — 3 direct / 3 total files
│   │       ├── hooks/ — 9 direct / 9 total files
│   │       └── styles/ — 6 direct / 6 total files
│   ├── kernel/ — 10 files
│   │   ├── declarative-plugin-ui/ — 3 direct / 3 total files
│   │   └── renderer-plugins/ — 7 direct / 7 total files
│   ├── services/ — 8 files
│   │   └── runtime-client/ — 8 direct / 8 total files
│   └── shared/ — 82 files
│       ├── assets/ — 1 direct / 21 total files
│       │   └── provider-logos/ — 20 direct / 20 total files
│       ├── branding/ — 4 direct / 4 total files
│       ├── code/ — 4 direct / 4 total files
│       ├── hooks/ — 4 direct / 4 total files
│       ├── i18n/ — 15 direct / 15 total files
│       ├── lib/ — 6 direct / 6 total files
│       ├── preferences/ — 6 direct / 6 total files
│       ├── shortcuts/ — 3 direct / 3 total files
│       ├── styles/ — 9 direct / 9 total files
│       └── ui/ — 10 direct / 10 total files
└── test/ — 163 files
    └── unit/ — 163 files
        ├── app/ — 2 direct / 18 total files
        │   ├── controller/ — 4 direct / 4 total files
        │   ├── layout/ — 7 direct / 7 total files
        │   ├── providers/ — 1 direct / 1 total files
        │   └── sidebar/ — 4 direct / 4 total files
        ├── composition/ — 4 direct / 5 total files
        │   └── renderer-plugins/ — 1 direct / 1 total files
        ├── features/ — 108 files
        │   ├── capabilities/ — 12 direct / 12 total files
        │   ├── chat/ — 3 direct / 77 total files
        │   │   ├── composer/ — 21 direct / 21 total files
        │   │   ├── conversation/ — 26 direct / 26 total files
        │   │   ├── hooks/ — 5 direct / 5 total files
        │   │   ├── markdown/ — 8 direct / 8 total files
        │   │   ├── mentions/ — 3 direct / 3 total files
        │   │   ├── plugin-usage/ — 2 direct / 2 total files
        │   │   ├── skills/ — 1 direct / 1 total files
        │   │   └── tool-runs/ — 8 direct / 8 total files
        │   ├── settings/ — 6 direct / 8 total files
        │   │   └── data-root/ — 2 direct / 2 total files
        │   └── workspace/ — 4 direct / 11 total files
        │       └── hooks/ — 7 direct / 7 total files
        ├── kernel/ — 5 files
        │   └── renderer-plugins/ — 5 direct / 5 total files
        ├── services/ — 6 files
        │   └── runtime-client/ — 6 direct / 6 total files
        ├── shared/ — 20 files
        │   ├── branding/ — 2 direct / 2 total files
        │   ├── code/ — 1 direct / 1 total files
        │   ├── hooks/ — 2 direct / 2 total files
        │   ├── i18n/ — 1 direct / 1 total files
        │   ├── lib/ — 3 direct / 3 total files
        │   ├── preferences/ — 5 direct / 5 total files
        │   ├── shortcuts/ — 2 direct / 2 total files
        │   └── ui/ — 4 direct / 4 total files
        └── support/ — 1 direct / 1 total files
```

### `packages/contracts/`

```text
packages/contracts/ — 4 direct / 75 total files
├── src/ — 32 direct / 47 total files
│   ├── event-projections/ — 3 direct / 3 total files
│   ├── network-proxy/ — 1 direct / 1 total files
│   ├── review/ — 1 direct / 1 total files
│   └── swe/ — 10 direct / 10 total files
└── test/ — 15 direct / 24 total files
    ├── support/ — 1 direct / 1 total files
    ├── swe/ — 1 direct / 1 total files
    └── swe-events/ — 7 direct / 7 total files
```

### `packages/feature-core/`

```text
packages/feature-core/ — 4 direct / 31 total files
├── src/ — 8 direct / 22 total files
│   ├── internal/ — 3 direct / 3 total files
│   ├── main/ — 1 direct / 1 total files
│   ├── preload/ — 1 direct / 1 total files
│   ├── renderer/ — 5 direct / 5 total files
│   └── runtime/ — 4 direct / 4 total files
└── test/ — 5 files
    ├── composition/ — 1 direct / 1 total files
    ├── preload/ — 1 direct / 1 total files
    ├── renderer/ — 2 direct / 2 total files
    └── runtime/ — 1 direct / 1 total files
```

### `packages/features/`

```text
packages/features/ — 0 direct / 865 total files
├── approval-review/ — 2 direct / 20 total files
│   ├── src/ — 17 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 5 direct / 5 total files
│   │   └── runtime/ — 7 direct / 7 total files
│   └── test/ — 1 files
│       └── runtime/ — 1 direct / 1 total files
├── artifact/ — 2 direct / 22 total files
│   ├── src/ — 16 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── renderer/ — 9 direct / 9 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 4 files
│       ├── contracts/ — 1 direct / 1 total files
│       ├── renderer/ — 2 direct / 2 total files
│       └── runtime/ — 1 direct / 1 total files
├── browser/ — 2 direct / 71 total files
│   ├── src/ — 52 files
│   │   ├── contracts/ — 8 direct / 8 total files
│   │   ├── main/ — 13 direct / 16 total files
│   │   │   └── cdp/ — 3 direct / 3 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   ├── renderer/ — 22 direct / 22 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 17 files
│       ├── main/ — 6 direct / 8 total files
│       │   └── cdp/ — 2 direct / 2 total files
│       ├── renderer/ — 7 direct / 7 total files
│       └── runtime/ — 2 direct / 2 total files
├── collaboration/ — 2 direct / 32 total files
│   ├── src/ — 25 files
│   │   ├── contracts/ — 7 direct / 7 total files
│   │   ├── renderer/ — 13 direct / 13 total files
│   │   └── runtime/ — 5 direct / 5 total files
│   └── test/ — 5 files
│       ├── contracts/ — 1 direct / 1 total files
│       ├── renderer/ — 2 direct / 2 total files
│       └── runtime/ — 2 direct / 2 total files
├── conversation-debug/ — 2 direct / 56 total files
│   ├── src/ — 42 files
│   │   ├── contracts/ — 7 direct / 7 total files
│   │   ├── renderer/ — 31 direct / 31 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 12 files
│       ├── renderer/ — 11 direct / 11 total files
│       └── runtime/ — 1 direct / 1 total files
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
├── mcp/ — 4 direct / 42 total files
│   ├── src/ — 26 files
│   │   ├── contracts/ — 8 direct / 8 total files
│   │   ├── renderer/ — 4 direct / 4 total files
│   │   └── runtime/ — 6 direct / 14 total files
│   │       ├── adapters/ — 5 files
│   │       │   └── sdk/ — 5 direct / 5 total files
│   │       └── tools/ — 3 direct / 3 total files
│   └── test/ — 7 direct / 12 total files
│       ├── contracts/ — 1 direct / 1 total files
│       ├── fixtures/ — 2 direct / 2 total files
│       ├── renderer/ — 1 direct / 1 total files
│       └── support/ — 1 direct / 1 total files
├── memory/ — 2 direct / 29 total files
│   ├── src/ — 23 files
│   │   ├── contracts/ — 7 direct / 7 total files
│   │   ├── renderer/ — 6 direct / 6 total files
│   │   └── runtime/ — 10 direct / 10 total files
│   └── test/ — 4 files
│       └── runtime/ — 4 direct / 4 total files
├── model-provider/ — 2 direct / 46 total files
│   ├── src/ — 35 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── renderer/ — 19 direct / 19 total files
│   │   └── runtime/ — 12 direct / 12 total files
│   └── test/ — 9 files
│       ├── renderer/ — 3 direct / 3 total files
│       └── runtime/ — 6 direct / 6 total files
├── network-proxy/ — 2 direct / 31 total files
│   ├── src/ — 24 files
│   │   ├── contracts/ — 3 direct / 3 total files
│   │   ├── main/ — 9 direct / 9 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 10 direct / 10 total files
│   └── test/ — 5 files
│       ├── main/ — 2 direct / 2 total files
│       ├── renderer/ — 2 direct / 2 total files
│       └── support/ — 1 direct / 1 total files
├── plugin-management/ — 2 direct / 24 total files
│   ├── src/ — 19 files
│   │   ├── contracts/ — 6 direct / 6 total files
│   │   ├── main/ — 5 direct / 5 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   ├── renderer/ — 4 direct / 4 total files
│   │   └── runtime/ — 2 direct / 2 total files
│   └── test/ — 3 files
│       ├── main/ — 1 direct / 1 total files
│       ├── renderer/ — 1 direct / 1 total files
│       └── runtime/ — 1 direct / 1 total files
├── review/ — 2 direct / 75 total files
│   ├── src/ — 61 files
│   │   ├── contracts/ — 10 direct / 10 total files
│   │   ├── main/ — 8 direct / 8 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   ├── renderer/ — 27 direct / 36 total files
│   │   │   ├── git/ — 2 direct / 2 total files
│   │   │   ├── hooks/ — 2 direct / 2 total files
│   │   │   ├── model/ — 1 direct / 1 total files
│   │   │   └── styles/ — 4 direct / 4 total files
│   │   └── runtime/ — 5 direct / 5 total files
│   └── test/ — 12 files
│       ├── integration/ — 2 files
│       │   └── main/ — 2 direct / 2 total files
│       ├── main/ — 2 direct / 2 total files
│       ├── renderer/ — 4 direct / 5 total files
│       │   └── hooks/ — 1 direct / 1 total files
│       └── runtime/ — 3 direct / 3 total files
├── runtime-activity/ — 2 direct / 30 total files
│   ├── src/ — 22 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 14 direct / 14 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 6 files
│       ├── renderer/ — 5 direct / 5 total files
│       └── runtime/ — 1 direct / 1 total files
├── side-conversation/ — 2 direct / 18 total files
│   ├── src/ — 14 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── renderer/ — 6 direct / 6 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 2 files
│       ├── renderer/ — 1 direct / 1 total files
│       └── runtime/ — 1 direct / 1 total files
├── skills/ — 4 direct / 17 total files
│   ├── src/ — 10 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── renderer/ — 4 direct / 4 total files
│   │   └── runtime/ — 2 direct / 2 total files
│   └── test/ — 3 files
│       ├── contracts/ — 1 direct / 1 total files
│       ├── renderer/ — 1 direct / 1 total files
│       └── runtime/ — 1 direct / 1 total files
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
├── thread-title-generation/ — 2 direct / 18 total files
│   ├── src/ — 14 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 5 direct / 5 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 2 files
│       └── runtime/ — 2 direct / 2 total files
├── updater/ — 2 direct / 30 total files
│   ├── src/ — 24 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── main/ — 8 direct / 8 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 10 direct / 10 total files
│   └── test/ — 4 files
│       ├── main/ — 3 direct / 3 total files
│       └── renderer/ — 1 direct / 1 total files
├── usage/ — 2 direct / 45 total files
│   ├── src/ — 33 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 15 direct / 25 total files
│   │   │   └── usage/ — 10 direct / 10 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 10 files
│       ├── renderer/ — 8 direct / 8 total files
│       └── runtime/ — 2 direct / 2 total files
├── vision-recognition/ — 2 direct / 18 total files
│   ├── src/ — 14 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 6 direct / 6 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 2 files
│       └── runtime/ — 2 direct / 2 total files
├── webdav-sync/ — 2 direct / 62 total files
│   ├── src/ — 42 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── main/ — 21 direct / 21 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 15 direct / 15 total files
│   └── test/ — 18 files
│       ├── main/ — 12 direct / 12 total files
│       ├── renderer/ — 3 direct / 3 total files
│       └── support/ — 3 direct / 3 total files
├── windows-sandbox/ — 2 direct / 34 total files
│   ├── src/ — 26 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── main/ — 9 direct / 9 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   ├── renderer/ — 7 direct / 7 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 6 files
│       ├── main/ — 4 direct / 4 total files
│       ├── renderer/ — 1 direct / 1 total files
│       └── runtime/ — 1 direct / 1 total files
├── workspace-apps/ — 2 direct / 45 total files
│   ├── src/ — 39 files
│   │   ├── contracts/ — 3 direct / 3 total files
│   │   ├── main/ — 4 direct / 4 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 9 direct / 30 total files
│   │       └── assets/ — 21 direct / 21 total files
│   └── test/ — 4 files
│       ├── main/ — 2 direct / 2 total files
│       └── renderer/ — 2 direct / 2 total files
└── workspace-dependencies/ — 2 direct / 26 total files
    ├── src/ — 21 files
    │   ├── contracts/ — 6 direct / 6 total files
    │   ├── renderer/ — 8 direct / 8 total files
    │   └── runtime/ — 7 direct / 7 total files
    └── test/ — 3 files
        ├── renderer/ — 1 direct / 1 total files
        └── runtime/ — 2 direct / 2 total files
```

### `packages/desktop-runtime/`

```text
packages/desktop-runtime/ — 4 direct / 504 total files
├── src/ — 2 direct / 292 total files
│   ├── adapters/ — 109 files
│   │   ├── approval/ — 1 direct / 1 total files
│   │   ├── event/ — 2 direct / 2 total files
│   │   ├── feature/ — 6 direct / 6 total files
│   │   ├── id/ — 1 direct / 1 total files
│   │   ├── mcp/ — 4 direct / 4 total files
│   │   ├── model/ — 2 direct / 2 total files
│   │   ├── native/ — 1 direct / 1 total files
│   │   ├── network/ — 2 direct / 2 total files
│   │   ├── plugin/ — 7 direct / 7 total files
│   │   ├── search/ — 5 direct / 5 total files
│   │   ├── skill/ — 4 direct / 4 total files
│   │   ├── store/ — 34 direct / 34 total files
│   │   ├── tool/ — 13 direct / 35 total files
│   │   │   └── pc-local/ — 22 direct / 22 total files
│   │   └── workspace/ — 5 direct / 5 total files
│   ├── composition/ — 3 direct / 3 total files
│   ├── extensions/ — 7 direct / 7 total files
│   ├── features/ — 6 files
│   │   ├── events/ — 1 direct / 1 total files
│   │   ├── management/ — 1 direct / 1 total files
│   │   ├── routes/ — 1 direct / 1 total files
│   │   └── settings/ — 3 direct / 3 total files
│   ├── hooks/ — 4 direct / 4 total files
│   ├── loop/ — 62 files
│   │   ├── context/ — 16 direct / 16 total files
│   │   ├── core/ — 24 direct / 24 total files
│   │   ├── lifecycle/ — 10 direct / 10 total files
│   │   └── tools/ — 12 direct / 12 total files
│   ├── ports/ — 30 direct / 30 total files
│   ├── runtime/ — 3 direct / 8 total files
│   │   └── use-cases/ — 5 direct / 5 total files
│   ├── security/ — 5 direct / 5 total files
│   ├── server/ — 24 direct / 47 total files
│   │   └── app-server/ — 23 direct / 23 total files
│   ├── shared/ — 3 direct / 3 total files
│   └── utils/ — 6 direct / 6 total files
└── test/ — 208 files
    ├── adapters/ — 48 files
    │   ├── approval/ — 1 direct / 1 total files
    │   ├── feature/ — 1 direct / 1 total files
    │   ├── mcp/ — 2 direct / 2 total files
    │   ├── model/ — 1 direct / 1 total files
    │   ├── native/ — 1 direct / 1 total files
    │   ├── network/ — 1 direct / 1 total files
    │   ├── plugin/ — 5 direct / 5 total files
    │   ├── search/ — 4 direct / 4 total files
    │   ├── skill/ — 1 direct / 1 total files
    │   ├── store/ — 14 direct / 14 total files
    │   ├── tool/ — 7 direct / 12 total files
    │   │   └── pc-local/ — 5 direct / 5 total files
    │   └── workspace/ — 5 direct / 5 total files
    ├── extensions/ — 7 direct / 8 total files
    │   └── support/ — 1 direct / 1 total files
    ├── features/ — 3 files
    │   ├── events/ — 1 direct / 1 total files
    │   ├── routes/ — 1 direct / 1 total files
    │   └── settings/ — 1 direct / 1 total files
    ├── fixtures/ — 5 files
    │   ├── history/ — 2 direct / 2 total files
    │   └── legacy-thread-store/ — 3 files
    │       └── threads/ — 3 direct / 3 total files
    ├── hooks/ — 1 direct / 1 total files
    ├── integration/ — 48 files
    │   ├── adapters/ — 8 files
    │   │   ├── skill/ — 1 direct / 1 total files
    │   │   ├── store/ — 1 direct / 1 total files
    │   │   └── tool/ — 6 direct / 6 total files
    │   ├── agent-loop/ — 25 direct / 25 total files
    │   └── runtime-server/ — 15 direct / 15 total files
    ├── loop/ — 30 files
    │   ├── context/ — 12 direct / 12 total files
    │   ├── core/ — 8 direct / 8 total files
    │   ├── lifecycle/ — 5 direct / 5 total files
    │   └── tools/ — 5 direct / 5 total files
    ├── runtime/ — 2 direct / 4 total files
    │   └── use-cases/ — 2 direct / 2 total files
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
scripts/ — 21 direct / 34 total files
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
docs/ — 1 direct / 59 total files
├── architecture/ — 6 direct / 6 total files
├── core/ — 1 direct / 13 total files
│   ├── contracts/ — 4 direct / 4 total files
│   ├── feature-core/ — 1 direct / 1 total files
│   └── runtime/ — 7 direct / 7 total files
├── designs/ — 1 direct / 9 total files
│   ├── current/ — 5 direct / 5 total files
│   └── history/ — 3 direct / 3 total files
├── desktop/ — 1 direct / 12 total files
│   ├── main/ — 4 direct / 4 total files
│   ├── preload/ — 1 direct / 1 total files
│   └── renderer/ — 6 direct / 6 total files
├── development/ — 4 direct / 4 total files
├── extensions/ — 1 direct / 5 total files
│   ├── plugins/ — 3 direct / 3 total files
│   └── skills/ — 1 direct / 1 total files
└── features/ — 9 direct / 9 total files
```
