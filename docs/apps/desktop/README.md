# Desktop 应用

源码目录：`apps/desktop/`

Desktop 应用由 Electron main、preload 和 React renderer 三部分组成。它们运行在不同信任级别，不能因为位于同一个仓库就跨层直接 import。

## 模块导航

| 源码目录 | 文档 | 职责 |
| --- | --- | --- |
| `apps/desktop/main` | [Electron main](main/README.md) | 窗口、runtime 子进程、IPC、本机能力 |
| `apps/desktop/preload` | [Preload bridge](preload/README.md) | 把 IPC 收敛为 `window.setsunaDesktop` |
| `apps/desktop/renderer` | [React renderer](renderer/README.md) | 工作台 UI、状态投影和交互 |

## 信任边界

```text
untrusted webview page
        │
        │ fixed browser commands only
        ▼
Electron main  ← IPC →  preload  ← window API →  renderer
        │
        │ authenticated loopback HTTP/SSE
        ▼
local runtime
```

- Main 持有 Electron、Node、runtime token、browser CDP 和系统 API。
- Preload 持有 `ipcRenderer`，但只暴露固定方法。
- Renderer 只有浏览器 API、React 和 contracts 类型。
- `<webview>` 页面比 renderer 更不可信，不得继承桌面 preload 或 Node 能力。
- Runtime 是独立子进程，只通过受认证的本地协议调用 main 持有的能力。

## 启动关系

1. Main 在 profile 初始化前决定数据根和维护模式。
2. 正常模式创建主窗口、splash、浏览器控制与原生 bridge。
3. `RuntimeHost` 启动本地 runtime，等待 ready 与 health。
4. Main 注册 IPC，加载 renderer。
5. Renderer 的 `DesktopDataRootGate` 再确认显示维护页面还是正常工作台。
6. 正常工作台创建 runtime client，拉取 snapshot 并订阅当前线程 SSE。

完整时序见 [运行链路](../../architecture/runtime-flows.md)。

## 跨层调用规则

### Renderer 调 Runtime

使用 `DesktopRuntimeClient`：

```text
feature
  → services/runtime-client/client.ts
  → preload runtime bridge
  → main RuntimeHost
  → runtime REST/SSE
```

不要在 feature 中直接拼 `/v1/*`，也不要从 renderer 访问 `127.0.0.1`。

### Renderer 调本机能力

使用 `window.setsunaDesktop.<namespace>`：

```text
feature / hook
  → preload fixed method
  → ipcMain handler
  → main domain module
```

新增能力需要同步 contracts、main IPC、preload 和 renderer，详见 [Runtime 与 IPC](main/runtime-and-ipc.md)。

### Runtime 调本机能力

Runtime 不通过 renderer。浏览器操作走 browser control loopback server，凭据与外链等原生能力走 native bridge。地址和 token 由 main 启动 runtime 时注入。

## 测试布局

```text
apps/desktop/main/test/
├── unit/          # 镜像 main/src
└── integration/   # review 等 app main 真实边界；Terminal integration 跟随其 Feature owner

apps/desktop/renderer/test/unit/
├── app/
├── features/
├── services/
└── shared/
```

Preload 当前通过 contracts、main IPC 和 renderer client 的组合测试约束。新增复杂 preload 状态机时，应优先把纯逻辑抽出并添加独立测试，而不是继续堆在 `src/index.ts`。

## 常见入口

- 窗口或启动：[main/README.md](main/README.md)
- 数据目录迁移：[main/data-root.md](main/data-root.md)
- 内置浏览器：[main/browser.md](main/browser.md)
- Runtime 子进程和 IPC：[main/runtime-and-ipc.md](main/runtime-and-ipc.md)
- Review、terminal、updater、workspace app：[main/native-capabilities.md](main/native-capabilities.md)
- 顶层 UI 状态：[renderer/app-and-runtime-state.md](renderer/app-and-runtime-state.md)
- Chat：[renderer/chat.md](renderer/chat.md)
- Workspace：[renderer/workspace-and-debug.md](renderer/workspace-and-debug.md)
- Settings / capabilities：[renderer/settings-and-capabilities.md](renderer/settings-and-capabilities.md)
