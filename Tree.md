# Repository Tree

> 此文件由 `pnpm docs:tree` 生成。不要手工维护逐文件清单；职责和设计约束写在 `docs/`。

## 分层方向

`contracts -> runtime -> Electron main/preload -> renderer`

- 生产代码只放在各模块的 `src/`。
- 测试只放在独立的 `test/`，并镜像生产目录。
- renderer 按 `app / features / services / shared` 组织。
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
| Agent turn 生命周期 | `packages/desktop-runtime/src/loop/{core,context,lifecycle,memory,tools}/` |
| runtime HTTP/SSE | `packages/desktop-runtime/src/server/` |
| 存储、模型、MCP、工具实现 | `packages/desktop-runtime/src/adapters/` |
| runtime 抽象边界 | `packages/desktop-runtime/src/ports/` |
| 单元与集成测试 | 各模块独立的 `test/`，目录镜像对应 `src/` |

## 目录索引

目录后的数字分别表示直属文件数和递归文件总数；生成物与依赖目录不会进入索引。

### `apps/desktop/main/`

```text
apps/desktop/main/ — 0 direct / 91 total files
├── src/ — 2 direct / 56 total files
│   ├── browser/ — 6 direct / 9 total files
│   │   └── cdp/ — 3 direct / 3 total files
│   ├── data-root/ — 13 direct / 13 total files
│   ├── i18n/ — 1 direct / 1 total files
│   ├── ipc/ — 10 direct / 10 total files
│   ├── review/ — 1 direct / 1 total files
│   ├── runtime/ — 6 direct / 6 total files
│   ├── security/ — 2 direct / 2 total files
│   ├── terminal/ — 1 direct / 1 total files
│   ├── updater/ — 3 direct / 3 total files
│   ├── window/ — 3 direct / 5 total files
│   │   └── splash/ — 2 direct / 2 total files
│   └── workspace/ — 3 direct / 3 total files
└── test/ — 35 files
    ├── integration/ — 2 files
    │   ├── review/ — 1 direct / 1 total files
    │   └── terminal/ — 1 direct / 1 total files
    ├── support/ — 1 direct / 1 total files
    └── unit/ — 1 direct / 32 total files
        ├── browser/ — 5 direct / 7 total files
        │   └── cdp/ — 2 direct / 2 total files
        ├── data-root/ — 7 direct / 7 total files
        ├── runtime/ — 5 direct / 5 total files
        ├── security/ — 2 direct / 2 total files
        ├── updater/ — 2 direct / 2 total files
        ├── window/ — 3 direct / 5 total files
        │   └── splash/ — 2 direct / 2 total files
        └── workspace/ — 3 direct / 3 total files
```

### `apps/desktop/preload/`

```text
apps/desktop/preload/ — 0 direct / 1 total files
└── src/ — 1 direct / 1 total files
```

### `apps/desktop/renderer/`

```text
apps/desktop/renderer/ — 0 direct / 556 total files
├── src/ — 2 direct / 403 total files
│   ├── app/ — 2 direct / 33 total files
│   │   ├── controller/ — 6 direct / 6 total files
│   │   ├── layout/ — 11 direct / 11 total files
│   │   ├── providers/ — 2 direct / 2 total files
│   │   ├── sidebar/ — 8 direct / 8 total files
│   │   └── styles/ — 4 direct / 4 total files
│   ├── features/ — 289 files
│   │   ├── capabilities/ — 20 direct / 27 total files
│   │   │   ├── hooks/ — 1 direct / 1 total files
│   │   │   ├── mcp/ — 2 direct / 2 total files
│   │   │   └── styles/ — 4 direct / 4 total files
│   │   ├── chat/ — 3 direct / 112 total files
│   │   │   ├── artifacts/ — 6 direct / 6 total files
│   │   │   ├── composer/ — 26 direct / 26 total files
│   │   │   ├── conversation/ — 30 direct / 30 total files
│   │   │   ├── hooks/ — 8 direct / 8 total files
│   │   │   ├── markdown/ — 11 direct / 11 total files
│   │   │   ├── mentions/ — 4 direct / 4 total files
│   │   │   ├── styles/ — 10 direct / 10 total files
│   │   │   └── tool-runs/ — 14 direct / 14 total files
│   │   ├── conversation-debug/ — 17 direct / 17 total files
│   │   ├── runtime-activity/ — 5 direct / 6 total files
│   │   │   └── styles/ — 1 direct / 1 total files
│   │   ├── settings/ — 10 direct / 49 total files
│   │   │   ├── components/ — 1 direct / 1 total files
│   │   │   ├── data-root/ — 12 direct / 12 total files
│   │   │   ├── providers/ — 2 direct / 2 total files
│   │   │   ├── sections/ — 7 direct / 7 total files
│   │   │   ├── shortcuts/ — 1 direct / 1 total files
│   │   │   ├── styles/ — 9 direct / 9 total files
│   │   │   └── usage/ — 7 direct / 7 total files
│   │   └── workspace/ — 32 direct / 78 total files
│   │       ├── assets/ — 20 direct / 20 total files
│   │       ├── browser/ — 1 direct / 1 total files
│   │       ├── editor/ — 3 direct / 3 total files
│   │       ├── git/ — 2 direct / 2 total files
│   │       ├── hooks/ — 11 direct / 11 total files
│   │       ├── model/ — 1 direct / 1 total files
│   │       └── styles/ — 8 direct / 8 total files
│   ├── services/ — 10 files
│   │   └── runtime-client/ — 10 direct / 10 total files
│   └── shared/ — 69 files
│       ├── assets/ — 1 direct / 21 total files
│       │   └── provider-logos/ — 20 direct / 20 total files
│       ├── branding/ — 2 direct / 2 total files
│       ├── code/ — 4 direct / 4 total files
│       ├── hooks/ — 3 direct / 3 total files
│       ├── i18n/ — 13 direct / 13 total files
│       ├── lib/ — 6 direct / 6 total files
│       ├── preferences/ — 5 direct / 5 total files
│       ├── shortcuts/ — 3 direct / 3 total files
│       ├── styles/ — 7 direct / 7 total files
│       └── ui/ — 5 direct / 5 total files
└── test/ — 153 files
    └── unit/ — 153 files
        ├── app/ — 1 direct / 12 total files
        │   ├── controller/ — 3 direct / 3 total files
        │   ├── layout/ — 3 direct / 3 total files
        │   ├── providers/ — 1 direct / 1 total files
        │   └── sidebar/ — 4 direct / 4 total files
        ├── features/ — 115 files
        │   ├── capabilities/ — 5 direct / 6 total files
        │   │   └── hooks/ — 1 direct / 1 total files
        │   ├── chat/ — 1 direct / 59 total files
        │   │   ├── artifacts/ — 4 direct / 4 total files
        │   │   ├── composer/ — 17 direct / 17 total files
        │   │   ├── conversation/ — 21 direct / 21 total files
        │   │   ├── hooks/ — 3 direct / 3 total files
        │   │   ├── markdown/ — 6 direct / 6 total files
        │   │   ├── mentions/ — 3 direct / 3 total files
        │   │   └── tool-runs/ — 4 direct / 4 total files
        │   ├── conversation-debug/ — 8 direct / 8 total files
        │   ├── runtime-activity/ — 4 direct / 4 total files
        │   ├── settings/ — 9 direct / 14 total files
        │   │   ├── data-root/ — 2 direct / 2 total files
        │   │   └── usage/ — 3 direct / 3 total files
        │   └── workspace/ — 14 direct / 24 total files
        │       ├── browser/ — 1 direct / 1 total files
        │       ├── hooks/ — 8 direct / 8 total files
        │       └── model/ — 1 direct / 1 total files
        ├── services/ — 9 files
        │   └── runtime-client/ — 9 direct / 9 total files
        └── shared/ — 17 files
            ├── branding/ — 1 direct / 1 total files
            ├── code/ — 1 direct / 1 total files
            ├── hooks/ — 2 direct / 2 total files
            ├── i18n/ — 1 direct / 1 total files
            ├── lib/ — 4 direct / 4 total files
            ├── preferences/ — 4 direct / 4 total files
            ├── shortcuts/ — 2 direct / 2 total files
            └── ui/ — 2 direct / 2 total files
```

### `packages/contracts/`

```text
packages/contracts/ — 4 direct / 65 total files
├── src/ — 35 direct / 47 total files
│   ├── event-projections/ — 2 direct / 2 total files
│   └── swe/ — 10 direct / 10 total files
└── test/ — 5 direct / 14 total files
    ├── support/ — 1 direct / 1 total files
    ├── swe/ — 1 direct / 1 total files
    └── swe-events/ — 7 direct / 7 total files
```

### `packages/desktop-runtime/`

```text
packages/desktop-runtime/ — 4 direct / 455 total files
├── src/ — 2 direct / 266 total files
│   ├── adapters/ — 113 files
│   │   ├── approval/ — 1 direct / 1 total files
│   │   ├── browser/ — 1 direct / 1 total files
│   │   ├── debug/ — 1 direct / 1 total files
│   │   ├── event/ — 2 direct / 2 total files
│   │   ├── id/ — 1 direct / 1 total files
│   │   ├── mcp/ — 5 direct / 5 total files
│   │   ├── model/ — 27 direct / 27 total files
│   │   ├── native/ — 1 direct / 1 total files
│   │   ├── plugin/ — 3 direct / 3 total files
│   │   ├── search/ — 5 direct / 5 total files
│   │   ├── skill/ — 2 direct / 2 total files
│   │   ├── store/ — 24 direct / 24 total files
│   │   ├── tool/ — 14 direct / 34 total files
│   │   │   └── pc-local/ — 20 direct / 20 total files
│   │   └── workspace/ — 6 direct / 6 total files
│   ├── hooks/ — 3 direct / 3 total files
│   ├── loop/ — 54 files
│   │   ├── context/ — 13 direct / 13 total files
│   │   ├── core/ — 14 direct / 14 total files
│   │   ├── lifecycle/ — 14 direct / 14 total files
│   │   ├── memory/ — 3 direct / 3 total files
│   │   └── tools/ — 10 direct / 10 total files
│   ├── ports/ — 31 direct / 31 total files
│   ├── runtime/ — 3 direct / 9 total files
│   │   └── use-cases/ — 6 direct / 6 total files
│   ├── security/ — 5 direct / 5 total files
│   ├── server/ — 20 direct / 41 total files
│   │   └── app-server/ — 21 direct / 21 total files
│   ├── shared/ — 2 direct / 2 total files
│   └── utils/ — 6 direct / 6 total files
└── test/ — 185 files
    ├── adapters/ — 56 files
    │   ├── approval/ — 1 direct / 1 total files
    │   ├── browser/ — 1 direct / 1 total files
    │   ├── debug/ — 1 direct / 1 total files
    │   ├── mcp/ — 5 direct / 5 total files
    │   ├── model/ — 4 direct / 4 total files
    │   ├── native/ — 1 direct / 1 total files
    │   ├── plugin/ — 3 direct / 3 total files
    │   ├── search/ — 4 direct / 4 total files
    │   ├── skill/ — 1 direct / 1 total files
    │   ├── store/ — 14 direct / 14 total files
    │   ├── tool/ — 11 direct / 15 total files
    │   │   └── pc-local/ — 4 direct / 4 total files
    │   └── workspace/ — 6 direct / 6 total files
    ├── fixtures/ — 4 files
    │   ├── history/ — 2 direct / 2 total files
    │   └── mcp/ — 2 direct / 2 total files
    ├── integration/ — 38 files
    │   ├── adapters/ — 3 files
    │   │   ├── skill/ — 1 direct / 1 total files
    │   │   ├── store/ — 1 direct / 1 total files
    │   │   └── tool/ — 1 direct / 1 total files
    │   ├── agent-loop/ — 20 direct / 20 total files
    │   └── runtime-server/ — 15 direct / 15 total files
    ├── loop/ — 26 files
    │   ├── context/ — 10 direct / 10 total files
    │   ├── core/ — 5 direct / 5 total files
    │   ├── lifecycle/ — 6 direct / 6 total files
    │   ├── memory/ — 2 direct / 2 total files
    │   └── tools/ — 3 direct / 3 total files
    ├── runtime/ — 2 direct / 5 total files
    │   └── use-cases/ — 3 direct / 3 total files
    ├── security/ — 3 direct / 3 total files
    ├── server/ — 5 direct / 10 total files
    │   └── app-server/ — 5 direct / 5 total files
    ├── shared/ — 2 direct / 2 total files
    ├── support/ — 1 direct / 38 total files
    │   ├── agent-loop/ — 20 direct / 20 total files
    │   └── runtime-server/ — 17 direct / 17 total files
    └── utils/ — 3 direct / 3 total files
```

### `scripts/`

```text
scripts/ — 19 direct / 26 total files
├── ripgrep/ — 3 direct / 3 total files
└── test/ — 3 direct / 4 total files
    └── ripgrep/ — 1 direct / 1 total files
```

### `skills/`

```text
skills/ — 0 direct / 2 total files
├── create-mcp-in-chat/ — 1 direct / 1 total files
└── create-skill-in-chat/ — 1 direct / 1 total files
```

### `plugins/`

```text
plugins/ — 0 direct / 44 total files
├── audit-file-mutations/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
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
├── openai-image-generation/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── skills/ — 1 files
│       └── image-generation/ — 1 direct / 1 total files
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
├── session-start-project-guidance/ — 2 files
│   ├── .setsuna-plugin/ — 1 direct / 1 total files
│   └── hooks/ — 1 direct / 1 total files
└── stop-todo-continuation/ — 2 files
    ├── .setsuna-plugin/ — 1 direct / 1 total files
    └── hooks/ — 1 direct / 1 total files
```

### `docs/`

```text
docs/ — 1 direct / 41 total files
├── apps/ — 13 files
│   └── desktop/ — 1 direct / 13 total files
│       ├── main/ — 5 direct / 5 total files
│       ├── preload/ — 1 direct / 1 total files
│       └── renderer/ — 6 direct / 6 total files
├── architecture/ — 4 direct / 4 total files
├── designs/ — 4 direct / 4 total files
├── development/ — 3 direct / 3 total files
├── packages/ — 12 files
│   ├── contracts/ — 4 direct / 4 total files
│   └── desktop-runtime/ — 8 direct / 8 total files
├── plugins/ — 2 direct / 2 total files
├── scripts/ — 1 direct / 1 total files
└── skills/ — 1 direct / 1 total files
```
