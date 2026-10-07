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
| beUI 基础组件与控件样式 | `packages/renderer-ui/src/` |
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
apps/desktop/main/ — 0 direct / 99 total files
├── src/ — 2 direct / 58 total files
│   ├── composition/ — 3 direct / 3 total files
│   ├── data-root/ — 14 direct / 14 total files
│   ├── i18n/ — 1 direct / 1 total files
│   ├── ipc/ — 6 direct / 6 total files
│   ├── runtime/ — 9 direct / 9 total files
│   ├── security/ — 2 direct / 2 total files
│   ├── window/ — 16 direct / 18 total files
│   │   └── splash/ — 2 direct / 2 total files
│   └── workspace/ — 3 direct / 3 total files
└── test/ — 41 files
    ├── fixtures/ — 1 direct / 1 total files
    ├── integration/ — 1 files
    │   └── runtime/ — 1 direct / 1 total files
    ├── support/ — 2 direct / 2 total files
    └── unit/ — 1 direct / 37 total files
        ├── data-root/ — 8 direct / 8 total files
        ├── ipc/ — 1 direct / 1 total files
        ├── runtime/ — 9 direct / 9 total files
        ├── security/ — 2 direct / 2 total files
        ├── window/ — 10 direct / 12 total files
        │   └── splash/ — 2 direct / 2 total files
        └── workspace/ — 4 direct / 4 total files
```

### `apps/desktop/preload/`

```text
apps/desktop/preload/ — 0 direct / 5 total files
├── src/ — 3 direct / 4 total files
│   └── composition/ — 1 direct / 1 total files
└── test/ — 1 files
    └── unit/ — 1 direct / 1 total files
```

### `apps/desktop/renderer/`

```text
apps/desktop/renderer/ — 0 direct / 726 total files
├── src/ — 2 direct / 519 total files
│   ├── app/ — 3 direct / 74 total files
│   │   ├── app-creation/ — 5 direct / 5 total files
│   │   ├── controller/ — 8 direct / 8 total files
│   │   ├── layout/ — 27 direct / 27 total files
│   │   ├── providers/ — 2 direct / 2 total files
│   │   ├── sidebar/ — 19 direct / 19 total files
│   │   ├── styles/ — 8 direct / 8 total files
│   │   └── thread-menu/ — 2 direct / 2 total files
│   ├── composition/ — 35 direct / 40 total files
│   │   ├── automation/ — 3 direct / 3 total files
│   │   ├── renderer-plugins/ — 1 direct / 1 total files
│   │   └── review/ — 1 direct / 1 total files
│   ├── features/ — 273 files
│   │   ├── capabilities/ — 3 direct / 12 total files
│   │   │   └── styles/ — 9 direct / 9 total files
│   │   ├── chat/ — 8 direct / 177 total files
│   │   │   ├── composer/ — 33 direct / 36 total files
│   │   │   │   └── editor/ — 3 direct / 3 total files
│   │   │   ├── conversation/ — 35 direct / 43 total files
│   │   │   │   ├── messages/ — 1 direct / 1 total files
│   │   │   │   ├── navigation/ — 4 direct / 4 total files
│   │   │   │   └── search/ — 3 direct / 3 total files
│   │   │   ├── fork/ — 1 direct / 1 total files
│   │   │   ├── hooks/ — 16 direct / 16 total files
│   │   │   ├── markdown/ — 15 direct / 15 total files
│   │   │   ├── mentions/ — 7 direct / 7 total files
│   │   │   ├── plugin-usage/ — 5 direct / 5 total files
│   │   │   ├── references/ — 3 direct / 3 total files
│   │   │   ├── skills/ — 2 direct / 2 total files
│   │   │   ├── styles/ — 18 direct / 18 total files
│   │   │   ├── subagents/ — 1 files
│   │   │   │   └── avatars/ — 1 direct / 1 total files
│   │   │   └── tool-runs/ — 22 direct / 22 total files
│   │   ├── settings/ — 5 direct / 37 total files
│   │   │   ├── components/ — 2 direct / 2 total files
│   │   │   ├── data-root/ — 12 direct / 12 total files
│   │   │   ├── sections/ — 8 direct / 8 total files
│   │   │   ├── shortcuts/ — 1 direct / 1 total files
│   │   │   └── styles/ — 9 direct / 9 total files
│   │   └── workspace/ — 17 direct / 47 total files
│   │       ├── editor/ — 4 direct / 4 total files
│   │       ├── hooks/ — 17 direct / 17 total files
│   │       ├── markdown/ — 2 direct / 2 total files
│   │       └── styles/ — 7 direct / 7 total files
│   ├── kernel/ — 33 files
│   │   ├── declarative-plugin-ui/ — 8 direct / 18 total files
│   │   │   ├── app-appearance/ — 8 direct / 8 total files
│   │   │   └── app-order/ — 2 direct / 2 total files
│   │   ├── renderer-plugins/ — 8 direct / 8 total files
│   │   └── sandboxed-plugin-ui/ — 7 direct / 7 total files
│   ├── services/ — 9 files
│   │   └── runtime-client/ — 9 direct / 9 total files
│   └── shared/ — 88 files
│       ├── assets/ — 1 direct / 8 total files
│       │   └── provider-logos/ — 7 direct / 7 total files
│       ├── branding/ — 6 direct / 6 total files
│       ├── code/ — 4 direct / 4 total files
│       ├── hooks/ — 5 direct / 5 total files
│       ├── i18n/ — 16 direct / 16 total files
│       ├── lib/ — 6 direct / 6 total files
│       ├── preferences/ — 6 direct / 6 total files
│       ├── shortcuts/ — 3 direct / 3 total files
│       ├── styles/ — 12 direct / 12 total files
│       └── ui/ — 17 direct / 22 total files
│           └── model-picker/ — 5 direct / 5 total files
└── test/ — 207 files
    ├── fixtures/ — 1 direct / 1 total files
    ├── integration/ — 2 direct / 2 total files
    └── unit/ — 204 files
        ├── app/ — 2 direct / 27 total files
        │   ├── app-creation/ — 1 direct / 1 total files
        │   ├── controller/ — 8 direct / 8 total files
        │   ├── layout/ — 8 direct / 8 total files
        │   ├── providers/ — 1 direct / 1 total files
        │   ├── sidebar/ — 6 direct / 6 total files
        │   └── thread-menu/ — 1 direct / 1 total files
        ├── composition/ — 10 direct / 12 total files
        │   ├── automation/ — 1 direct / 1 total files
        │   └── renderer-plugins/ — 1 direct / 1 total files
        ├── features/ — 120 files
        │   ├── chat/ — 6 direct / 93 total files
        │   │   ├── composer/ — 20 direct / 20 total files
        │   │   ├── conversation/ — 28 direct / 32 total files
        │   │   ├── hooks/ — 8 direct / 8 total files
        │   │   ├── markdown/ — 9 direct / 9 total files
        │   │   ├── mentions/ — 4 direct / 4 total files
        │   │   ├── plugin-usage/ — 3 direct / 3 total files
        │   │   ├── skills/ — 1 direct / 1 total files
        │   │   └── tool-runs/ — 10 direct / 10 total files
        │   ├── settings/ — 4 direct / 6 total files
        │   │   └── data-root/ — 2 direct / 2 total files
        │   └── workspace/ — 6 direct / 21 total files
        │       ├── editor/ — 2 direct / 2 total files
        │       ├── hooks/ — 12 direct / 12 total files
        │       └── markdown/ — 1 direct / 1 total files
        ├── kernel/ — 17 files
        │   ├── declarative-plugin-ui/ — 3 files
        │   │   ├── app-appearance/ — 2 direct / 2 total files
        │   │   └── app-order/ — 1 direct / 1 total files
        │   ├── renderer-plugins/ — 7 direct / 7 total files
        │   └── sandboxed-plugin-ui/ — 7 direct / 7 total files
        ├── services/ — 9 files
        │   └── runtime-client/ — 9 direct / 9 total files
        ├── shared/ — 18 files
        │   ├── branding/ — 3 direct / 3 total files
        │   ├── code/ — 1 direct / 1 total files
        │   ├── hooks/ — 2 direct / 2 total files
        │   ├── i18n/ — 1 direct / 1 total files
        │   ├── lib/ — 1 direct / 1 total files
        │   ├── preferences/ — 1 direct / 1 total files
        │   ├── shortcuts/ — 2 direct / 2 total files
        │   └── ui/ — 6 direct / 7 total files
        │       └── model-picker/ — 1 direct / 1 total files
        └── support/ — 1 direct / 1 total files
```

### `packages/contracts/`

```text
packages/contracts/ — 4 direct / 88 total files
├── src/ — 35 direct / 56 total files
│   ├── desktop/ — 1 direct / 1 total files
│   ├── event-projections/ — 4 direct / 4 total files
│   ├── localization/ — 1 direct / 1 total files
│   ├── network-proxy/ — 1 direct / 1 total files
│   ├── review/ — 1 direct / 1 total files
│   ├── runtime-api/ — 1 direct / 1 total files
│   ├── shell/ — 2 direct / 2 total files
│   └── swe/ — 10 direct / 10 total files
└── test/ — 18 direct / 28 total files
    ├── shell/ — 1 direct / 1 total files
    ├── support/ — 1 direct / 1 total files
    ├── swe/ — 1 direct / 1 total files
    └── swe-events/ — 7 direct / 7 total files
```

### `packages/feature-core/`

```text
packages/feature-core/ — 4 direct / 32 total files
├── src/ — 8 direct / 23 total files
│   ├── internal/ — 3 direct / 3 total files
│   ├── main/ — 1 direct / 1 total files
│   ├── preload/ — 1 direct / 1 total files
│   ├── renderer/ — 5 direct / 5 total files
│   └── runtime/ — 5 direct / 5 total files
└── test/ — 5 files
    ├── composition/ — 1 direct / 1 total files
    ├── preload/ — 1 direct / 1 total files
    ├── renderer/ — 2 direct / 2 total files
    └── runtime/ — 1 direct / 1 total files
```

### `packages/renderer-ui/`

```text
packages/renderer-ui/ — 3 direct / 51 total files
├── src/ — 29 direct / 43 total files
│   ├── styles/ — 13 direct / 13 total files
│   └── tabs/ — 1 direct / 1 total files
└── test/ — 5 direct / 5 total files
```

### `packages/features/`

```text
packages/features/ — 0 direct / 1411 total files
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
├── automation/ — 2 direct / 47 total files
│   ├── src/ — 37 files
│   │   ├── contracts/ — 6 direct / 6 total files
│   │   ├── renderer/ — 25 direct / 25 total files
│   │   └── runtime/ — 6 direct / 6 total files
│   └── test/ — 8 files
│       ├── renderer/ — 6 direct / 6 total files
│       └── runtime/ — 2 direct / 2 total files
├── browser/ — 2 direct / 288 total files
│   ├── src/ — 202 files
│   │   ├── contracts/ — 20 direct / 20 total files
│   │   ├── main/ — 14 direct / 69 total files
│   │   │   ├── annotations/ — 3 direct / 3 total files
│   │   │   ├── cdp/ — 3 direct / 3 total files
│   │   │   ├── extensions/ — 25 direct / 33 total files
│   │   │   │   ├── native-messaging/ — 3 direct / 3 total files
│   │   │   │   └── user-scripts/ — 5 direct / 5 total files
│   │   │   ├── import/ — 5 direct / 5 total files
│   │   │   ├── passwords/ — 6 direct / 6 total files
│   │   │   └── settings/ — 5 direct / 5 total files
│   │   ├── preload/ — 13 direct / 13 total files
│   │   ├── renderer/ — 25 direct / 96 total files
│   │   │   ├── address-bar/ — 4 direct / 4 total files
│   │   │   ├── annotations/ — 5 direct / 5 total files
│   │   │   ├── extensions/ — 14 direct / 14 total files
│   │   │   ├── find/ — 3 direct / 3 total files
│   │   │   ├── import/ — 2 direct / 2 total files
│   │   │   ├── load-error/ — 3 direct / 3 total files
│   │   │   ├── passwords/ — 3 direct / 3 total files
│   │   │   ├── records/ — 14 direct / 14 total files
│   │   │   └── settings/ — 23 direct / 23 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 84 files
│       ├── contracts/ — 2 direct / 2 total files
│       ├── integration/ — 22 direct / 22 total files
│       ├── main/ — 9 direct / 35 total files
│       │   ├── annotations/ — 1 direct / 1 total files
│       │   ├── cdp/ — 2 direct / 2 total files
│       │   ├── extensions/ — 8 direct / 14 total files
│       │   │   ├── native-messaging/ — 3 direct / 3 total files
│       │   │   └── user-scripts/ — 3 direct / 3 total files
│       │   ├── import/ — 1 direct / 1 total files
│       │   ├── passwords/ — 4 direct / 4 total files
│       │   └── settings/ — 4 direct / 4 total files
│       ├── preload/ — 3 direct / 3 total files
│       ├── renderer/ — 8 direct / 20 total files
│       │   ├── address-bar/ — 2 direct / 2 total files
│       │   ├── annotations/ — 1 direct / 1 total files
│       │   ├── extensions/ — 1 direct / 1 total files
│       │   ├── find/ — 1 direct / 1 total files
│       │   ├── import/ — 2 direct / 2 total files
│       │   ├── load-error/ — 1 direct / 1 total files
│       │   └── settings/ — 4 direct / 4 total files
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
├── computer-use/ — 2 direct / 55 total files
│   ├── src/ — 37 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── main/ — 15 direct / 15 total files
│   │   ├── preload/ — 1 direct / 1 total files
│   │   ├── renderer/ — 11 direct / 11 total files
│   │   └── runtime/ — 5 direct / 5 total files
│   └── test/ — 16 files
│       ├── main/ — 13 direct / 13 total files
│       ├── renderer/ — 2 direct / 2 total files
│       └── runtime/ — 1 direct / 1 total files
├── conversation-debug/ — 2 direct / 60 total files
│   ├── src/ — 48 files
│   │   ├── contracts/ — 7 direct / 7 total files
│   │   ├── renderer/ — 31 direct / 37 total files
│   │   │   ├── flow/ — 1 direct / 1 total files
│   │   │   └── styles/ — 5 direct / 5 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 10 files
│       ├── renderer/ — 9 direct / 9 total files
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
├── mcp/ — 4 direct / 58 total files
│   ├── src/ — 37 files
│   │   ├── contracts/ — 8 direct / 8 total files
│   │   ├── renderer/ — 12 direct / 12 total files
│   │   └── runtime/ — 6 direct / 17 total files
│   │       ├── adapters/ — 8 files
│   │       │   └── sdk/ — 8 direct / 8 total files
│   │       └── tools/ — 3 direct / 3 total files
│   └── test/ — 9 direct / 17 total files
│       ├── contracts/ — 1 direct / 1 total files
│       ├── fixtures/ — 2 direct / 2 total files
│       ├── renderer/ — 4 direct / 4 total files
│       └── support/ — 1 direct / 1 total files
├── memory/ — 2 direct / 31 total files
│   ├── src/ — 24 files
│   │   ├── contracts/ — 7 direct / 7 total files
│   │   ├── renderer/ — 6 direct / 6 total files
│   │   └── runtime/ — 11 direct / 11 total files
│   └── test/ — 5 files
│       └── runtime/ — 5 direct / 5 total files
├── model-provider/ — 2 direct / 64 total files
│   ├── src/ — 46 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 24 direct / 24 total files
│   │   └── runtime/ — 17 direct / 17 total files
│   └── test/ — 16 files
│       ├── renderer/ — 6 direct / 6 total files
│       └── runtime/ — 10 direct / 10 total files
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
├── plugin-management/ — 2 direct / 39 total files
│   ├── src/ — 30 files
│   │   ├── contracts/ — 7 direct / 7 total files
│   │   ├── main/ — 5 direct / 5 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   ├── renderer/ — 14 direct / 14 total files
│   │   └── runtime/ — 2 direct / 2 total files
│   └── test/ — 7 files
│       ├── main/ — 1 direct / 1 total files
│       ├── renderer/ — 5 direct / 5 total files
│       └── runtime/ — 1 direct / 1 total files
├── pull-requests/ — 2 direct / 70 total files
│   ├── src/ — 58 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 35 direct / 39 total files
│   │   │   ├── account/ — 2 direct / 2 total files
│   │   │   └── loading/ — 2 direct / 2 total files
│   │   └── runtime/ — 14 direct / 14 total files
│   └── test/ — 10 files
│       ├── renderer/ — 2 direct / 3 total files
│       │   └── account/ — 1 direct / 1 total files
│       ├── runtime/ — 6 direct / 6 total files
│       └── support/ — 1 direct / 1 total files
├── review/ — 2 direct / 145 total files
│   ├── src/ — 116 files
│   │   ├── contracts/ — 16 direct / 16 total files
│   │   ├── main/ — 17 direct / 17 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   ├── renderer/ — 31 direct / 73 total files
│   │   │   ├── git/ — 10 direct / 10 total files
│   │   │   ├── history/ — 23 direct / 23 total files
│   │   │   ├── hooks/ — 2 direct / 2 total files
│   │   │   ├── model/ — 1 direct / 1 total files
│   │   │   └── styles/ — 6 direct / 6 total files
│   │   └── runtime/ — 8 direct / 8 total files
│   └── test/ — 27 files
│       ├── integration/ — 5 files
│       │   └── main/ — 5 direct / 5 total files
│       ├── main/ — 3 direct / 3 total files
│       ├── renderer/ — 9 direct / 15 total files
│       │   ├── git/ — 1 direct / 1 total files
│       │   ├── history/ — 4 direct / 4 total files
│       │   └── hooks/ — 1 direct / 1 total files
│       └── runtime/ — 4 direct / 4 total files
├── runtime-activity/ — 2 direct / 29 total files
│   ├── src/ — 22 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 14 direct / 14 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 5 files
│       ├── renderer/ — 4 direct / 4 total files
│       └── runtime/ — 1 direct / 1 total files
├── side-conversation/ — 2 direct / 18 total files
│   ├── src/ — 14 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── renderer/ — 6 direct / 6 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 2 files
│       ├── renderer/ — 1 direct / 1 total files
│       └── runtime/ — 1 direct / 1 total files
├── skills/ — 4 direct / 25 total files
│   ├── src/ — 15 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── renderer/ — 8 direct / 8 total files
│   │   └── runtime/ — 3 direct / 3 total files
│   └── test/ — 6 files
│       ├── contracts/ — 1 direct / 1 total files
│       ├── renderer/ — 3 direct / 3 total files
│       └── runtime/ — 2 direct / 2 total files
├── terminal/ — 2 direct / 30 total files
│   ├── src/ — 21 files
│   │   ├── contracts/ — 3 direct / 3 total files
│   │   ├── main/ — 5 direct / 5 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 11 direct / 11 total files
│   └── test/ — 7 files
│       ├── integration/ — 1 files
│       │   └── main/ — 1 direct / 1 total files
│       ├── main/ — 1 direct / 1 total files
│       └── renderer/ — 5 direct / 5 total files
├── thread-title-generation/ — 2 direct / 18 total files
│   ├── src/ — 14 files
│   │   ├── contracts/ — 5 direct / 5 total files
│   │   ├── renderer/ — 5 direct / 5 total files
│   │   └── runtime/ — 4 direct / 4 total files
│   └── test/ — 2 files
│       └── runtime/ — 2 direct / 2 total files
├── ui-card/ — 2 direct / 13 total files
│   ├── src/ — 10 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   └── renderer/ — 6 direct / 6 total files
│   └── test/ — 1 files
│       └── contracts/ — 1 direct / 1 total files
├── updater/ — 2 direct / 35 total files
│   ├── src/ — 26 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── main/ — 9 direct / 9 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 11 direct / 11 total files
│   └── test/ — 7 files
│       ├── main/ — 5 direct / 5 total files
│       └── renderer/ — 2 direct / 2 total files
├── usage/ — 2 direct / 47 total files
│   ├── src/ — 35 files
│   │   ├── contracts/ — 6 direct / 6 total files
│   │   ├── renderer/ — 15 direct / 26 total files
│   │   │   └── usage/ — 11 direct / 11 total files
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
├── webdav-sync/ — 2 direct / 63 total files
│   ├── src/ — 42 files
│   │   ├── contracts/ — 4 direct / 4 total files
│   │   ├── main/ — 21 direct / 21 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 15 direct / 15 total files
│   └── test/ — 19 files
│       ├── main/ — 13 direct / 13 total files
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
├── workspace-apps/ — 2 direct / 43 total files
│   ├── src/ — 38 files
│   │   ├── contracts/ — 3 direct / 3 total files
│   │   ├── main/ — 4 direct / 4 total files
│   │   ├── preload/ — 2 direct / 2 total files
│   │   └── renderer/ — 8 direct / 29 total files
│   │       └── assets/ — 21 direct / 21 total files
│   └── test/ — 3 files
│       ├── main/ — 2 direct / 2 total files
│       └── renderer/ — 1 direct / 1 total files
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
packages/desktop-runtime/ — 4 direct / 628 total files
├── src/ — 2 direct / 367 total files
│   ├── adapters/ — 154 files
│   │   ├── approval/ — 1 direct / 1 total files
│   │   ├── event/ — 2 direct / 2 total files
│   │   ├── feature/ — 8 direct / 8 total files
│   │   ├── id/ — 1 direct / 1 total files
│   │   ├── mcp/ — 4 direct / 4 total files
│   │   ├── model/ — 4 direct / 4 total files
│   │   ├── native/ — 1 direct / 1 total files
│   │   ├── network/ — 2 direct / 2 total files
│   │   ├── plugin/ — 26 direct / 26 total files
│   │   ├── search/ — 5 direct / 5 total files
│   │   ├── skill/ — 6 direct / 6 total files
│   │   ├── store/ — 35 direct / 39 total files
│   │   │   └── sqlite/ — 4 direct / 4 total files
│   │   ├── tool/ — 20 direct / 46 total files
│   │   │   └── pc-local/ — 26 direct / 26 total files
│   │   └── workspace/ — 9 direct / 9 total files
│   ├── composition/ — 4 direct / 5 total files
│   │   └── automation/ — 1 direct / 1 total files
│   ├── extensions/ — 15 direct / 15 total files
│   ├── features/ — 6 files
│   │   ├── events/ — 1 direct / 1 total files
│   │   ├── management/ — 1 direct / 1 total files
│   │   ├── routes/ — 1 direct / 1 total files
│   │   └── settings/ — 3 direct / 3 total files
│   ├── hooks/ — 4 direct / 4 total files
│   ├── loop/ — 72 files
│   │   ├── context/ — 22 direct / 22 total files
│   │   ├── core/ — 25 direct / 25 total files
│   │   ├── lifecycle/ — 10 direct / 10 total files
│   │   └── tools/ — 15 direct / 15 total files
│   ├── ports/ — 32 direct / 32 total files
│   ├── runtime/ — 3 direct / 12 total files
│   │   └── use-cases/ — 9 direct / 9 total files
│   ├── security/ — 5 direct / 5 total files
│   ├── server/ — 26 direct / 49 total files
│   │   └── app-server/ — 23 direct / 23 total files
│   ├── shared/ — 3 direct / 3 total files
│   └── utils/ — 8 direct / 8 total files
└── test/ — 257 files
    ├── adapters/ — 69 files
    │   ├── approval/ — 1 direct / 1 total files
    │   ├── feature/ — 1 direct / 1 total files
    │   ├── mcp/ — 2 direct / 2 total files
    │   ├── model/ — 3 direct / 3 total files
    │   ├── native/ — 1 direct / 1 total files
    │   ├── network/ — 1 direct / 1 total files
    │   ├── plugin/ — 10 direct / 13 total files
    │   │   └── support/ — 3 direct / 3 total files
    │   ├── search/ — 4 direct / 4 total files
    │   ├── skill/ — 1 direct / 1 total files
    │   ├── store/ — 16 direct / 17 total files
    │   │   └── sqlite/ — 1 direct / 1 total files
    │   ├── tool/ — 11 direct / 18 total files
    │   │   └── pc-local/ — 7 direct / 7 total files
    │   └── workspace/ — 7 direct / 7 total files
    ├── extensions/ — 9 direct / 10 total files
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
    ├── integration/ — 68 files
    │   ├── adapters/ — 11 files
    │   │   ├── skill/ — 1 direct / 1 total files
    │   │   ├── store/ — 1 direct / 1 total files
    │   │   └── tool/ — 9 direct / 9 total files
    │   ├── agent-loop/ — 32 direct / 32 total files
    │   ├── runtime/ — 1 direct / 1 total files
    │   └── runtime-server/ — 24 direct / 24 total files
    ├── loop/ — 33 files
    │   ├── context/ — 15 direct / 15 total files
    │   ├── core/ — 8 direct / 8 total files
    │   ├── lifecycle/ — 5 direct / 5 total files
    │   └── tools/ — 5 direct / 5 total files
    ├── runtime/ — 2 direct / 5 total files
    │   └── use-cases/ — 3 direct / 3 total files
    ├── security/ — 3 direct / 3 total files
    ├── server/ — 7 direct / 12 total files
    │   └── app-server/ — 5 direct / 5 total files
    ├── shared/ — 2 direct / 2 total files
    ├── support/ — 4 direct / 43 total files
    │   ├── agent-loop/ — 22 direct / 22 total files
    │   └── runtime-server/ — 17 direct / 17 total files
    └── utils/ — 3 direct / 3 total files
```

### `scripts/`

```text
scripts/ — 28 direct / 44 total files
├── ripgrep/ — 3 direct / 3 total files
├── test/ — 7 direct / 9 total files
│   ├── ripgrep/ — 1 direct / 1 total files
│   └── windows-sandbox/ — 1 direct / 1 total files
└── windows-sandbox/ — 4 direct / 4 total files
```

### `skills/`

```text
skills/ — 0 direct / 7 total files
├── create-mcp-in-chat/ — 2 direct / 2 total files
├── create-skill-in-chat/ — 2 direct / 2 total files
└── goal-writer/ — 2 direct / 3 total files
    └── agents/ — 1 direct / 1 total files
```

### `plugins/`

```text
plugins/ — 1 direct / 104 total files
├── app-builder/ — 14 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── skills/ — 12 files
│       └── create-plugin-in-chat/ — 2 direct / 12 total files
│           ├── agents/ — 1 direct / 1 total files
│           ├── assets/ — 3 direct / 3 total files
│           └── references/ — 6 direct / 6 total files
├── audit-file-mutations/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── hooks/ — 1 direct / 1 total files
├── claude-rules/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── extension/ — 1 direct / 1 total files
├── compact-warning/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── hooks/ — 1 direct / 1 total files
├── context7-docs/ — 5 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── skills/ — 3 files
│       └── context7-docs/ — 2 direct / 3 total files
│           └── agents/ — 1 direct / 1 total files
├── documents/ — 24 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── skills/ — 22 files
│       └── documents/ — 4 direct / 22 total files
│           ├── examples/ — 2 direct / 2 total files
│           ├── references/ — 4 direct / 4 total files
│           ├── scripts/ — 6 direct / 6 total files
│           └── tasks/ — 6 direct / 6 total files
├── guard-dangerous-shell/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── hooks/ — 1 direct / 1 total files
├── openai-docs/ — 5 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── skills/ — 3 files
│       └── openai-docs/ — 2 direct / 3 total files
│           └── agents/ — 1 direct / 1 total files
├── openai-image-generation/ — 6 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   ├── extension/ — 2 direct / 2 total files
│   └── skills/ — 2 files
│       └── image-generation/ — 2 direct / 2 total files
├── openai-vision-recognition/ — 6 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   ├── extension/ — 2 direct / 2 total files
│   └── skills/ — 2 files
│       └── vision-recognition/ — 2 direct / 2 total files
├── pdf/ — 5 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── skills/ — 3 files
│       └── pdf/ — 2 direct / 3 total files
│           └── agents/ — 1 direct / 1 total files
├── prompt-secret-detector/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── hooks/ — 1 direct / 1 total files
├── protect-generated-folders/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── hooks/ — 1 direct / 1 total files
├── protect-secret-paths/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── hooks/ — 1 direct / 1 total files
├── question/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── extension/ — 1 direct / 1 total files
├── session-start-project-guidance/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── hooks/ — 1 direct / 1 total files
├── stop-todo-continuation/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── hooks/ — 1 direct / 1 total files
├── todo/ — 3 files
│   ├── .setsuna-plugin/ — 2 direct / 2 total files
│   └── extension/ — 1 direct / 1 total files
└── web-search/ — 5 files
    ├── .setsuna-plugin/ — 2 direct / 2 total files
    └── extension/ — 3 direct / 3 total files
```

### `docs/`

```text
docs/ — 1 direct / 63 total files
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
├── extensions/ — 1 direct / 6 total files
│   ├── plugins/ — 4 direct / 4 total files
│   └── skills/ — 1 direct / 1 total files
└── features/ — 12 direct / 12 total files
```
