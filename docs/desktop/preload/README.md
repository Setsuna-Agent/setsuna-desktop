# Preload bridge

源码：`apps/desktop/preload/src/index.ts`

Preload 是 renderer 唯一能接触 Electron IPC 的地方。它使用 `contextBridge` 暴露 `window.setsunaDesktop`，不承载业务状态。

## API namespaces

| Namespace | 主要能力 | Main 对应模块 |
| --- | --- | --- |
| `runtime` | request、attachment upload、SSE | `ipc/runtime-ipc.ts`、`RuntimeHost` |
| `dataRoot` | 状态、扫描、迁移、恢复、旧根清理 | `ipc/data-root-ipc.ts` |
| `desktop` | 平台、目录选择、profile、图片、workspace 文件、本地路径 | `ipc/desktop-ipc.ts` |
| `links` | 打开受控外链 | `ipc/desktop-ipc.ts` |
| `browser` | tab 注册、截图、favicon、设备模拟、新标签事件 | `packages/features/browser/src/{preload,main}/` |
| `computerUse` | 授权设置、状态、预览与停止 | `packages/features/computer-use/src/{preload,main}/` |
| `networkProxy` | 代理设置、路由与状态 | `packages/features/network-proxy/src/{preload,main}/` |
| `plugins` | 用户选择本地 Bundle 目录并安装 | `packages/features/plugin-management/src/{preload,main}/` |
| `desktopReview` | review state、stage、unstage、discard | `packages/features/review/src/{preload,main}/` |
| `terminal` | session open/write/read/resize/restart/close、事件 | `packages/features/terminal/src/{preload,main}/` |
| `webdavSync` | 连接、备份、还原、取消与状态事件 | `packages/features/webdav-sync/src/{preload,main}/` |
| `workspaceApps` | 应用列表与打开 workspace/file | `packages/features/workspace-apps/src/{preload,main}/` |
| `updater` | 状态、检查、下载源、安装包打开与状态事件 | `packages/features/updater/src/{preload,main}/` |
| `windowsSandbox` | 状态检测与安装、修复、卸载 | `packages/features/windows-sandbox/src/{preload,main}/` |
| `windowControls` | minimize/maximize/close/scale、应用菜单、原生文本编辑、会话窗口与恢复上下文 | `ipc/window-ipc.ts`、`window/thread-windows.ts` |

准确方法面由 `packages/contracts/src/desktop.ts`、`http.ts` 和相关 Feature/领域 contract 定义；Updater、Workspace Apps 等 bridge 由各自 Feature contracts 定义。Host namespaces 与 Feature contributions 由 `src/composition/builtin-preload-features.ts` 组装，最后只调用一次 `contextBridge.exposeInMainWorld`。

`windowControls.executeTextEdit` 只接受 `cut`、`copy`、`paste`，Main 校验调用来自登记的宿主窗口主 frame，并在该窗口执行原生编辑命令。Renderer 在菜单关闭后恢复原选区；剪贴板数据继续经过现有编辑器的 clipboard 事件，不通过此 API 直接读写。

`desktop.revealPath` 用于在系统文件管理器中定位 Skill 等工作区外的应用文档。Main 限制调用来自登记的宿主窗口主 frame，校验绝对路径和目标存在后调用 `shell.showItemInFolder`；它不读取文件内容，也不执行文件。工作区引用仍通过 `revealWorkspaceFile` 的 root + 相对路径边界校验。

`desktop.startFileDrag` 接收 workspace root + 相对文件路径，或现有 `DesktopImageInput` 图片引用。Main 校验宿主主 frame，复用工作区 canonical path 或受管图片资产边界，按需读取系统图标后调用来源窗口的 `webContents.startDrag`，支持拖到桌面、系统文件管理器和接收文件的其他应用。启动只注册 handler，不扫描或预读文件。`desktop.resolveWorkspaceFileDrop` 在 preload 用 `webUtils.getPathForFile` 读取真实 `File` 路径，再由 Main 校验并返回工作区内的相对文件路径；外部文件、目录和越界路径返回 null。文件树用它接回原生拖拽后执行已有移动操作，目录仍走内部拖拽。

## Runtime SSE 的细节

`runtime.startSse()` 需要处理订阅 ID 的异步竞态：

1. 先注册 `runtime:event` listener。
2. 调用 `runtime:subscribe` 获取 subscription ID。
3. ID 返回前到达的 batch payload 暂存。
4. 只投递 ID 匹配的 `RuntimeEventBatch`，不在 preload 重新拆成逐事件 callback。
5. 如果调用方已取消，立即请求 main unsubscribe。
6. 返回的 cleanup 同时移除 listener 和关闭远端订阅。

这避免快速切线程时旧 SSE 事件落到新线程，也保留 main 建立的渲染批次边界。
Batch 可以携带 `resync` snapshot；preload 保持原子边界转发，renderer 负责 owner/sequence
校验并在后续增量事件前采用该 snapshot。

## 事件 API

所有 main → renderer 事件都遵循同一形状：

```ts
const unsubscribe = window.setsunaDesktop.someNamespace.onSomething(callback);
// 组件卸载或身份变化
unsubscribe();
```

不能暴露原始 `ipcRenderer.on`，也不能要求 renderer 自己记 channel 名。

## 安全规则

- 不暴露 `ipcRenderer`、`shell`、`fs`、`process.env` 或任意 invoke。
- 方法名和 channel 在 preload 中固定。
- 输入输出使用 contracts 类型。
- 不在 preload 缓存 token、secret 或业务 snapshot。
- 文件路径、URL 和 guest ID 仍由 main 二次校验。
- Listener 必须可取消，避免组件重挂载后重复处理。
- 不把 Electron event object 传给 renderer callback。

## 新增 API

1. 在共享 contracts 或 Feature contracts 声明窄子对象。
2. 在 main domain 模块实现能力。
3. 在所属 main 模块注册固定 handler/event；Feature 通过自己的 scope 释放 handler，宿主公共能力留在 main `src/ipc/`。
4. 在 host preload namespace 添加明确映射，或由 Feature preload module 向 `PreloadBridgeBuilder` 贡献子对象。
5. 在 renderer 增加 hook/helper。
6. 测试 main 行为和 renderer 调用。

如果方法需要大量本地状态机，状态机应留在 main service；preload 只做代理和 listener cleanup。

如果方法访问 runtime 数据，Core 使用 `DesktopRuntimeClient`，Feature 使用 typed operation transport；不要新建直达 main 文件存储的桥。

## 类型来源

Renderer 的 `window.setsunaDesktop` 类型来自 host contract 与已安装 Feature bridge contribution 的显式组合，不应另写重复方法签名；preload builder 会在 expose 前拒绝重复 key 和缺失实现。

## 验证

宿主 preload 由入口、Feature composition 和少量事件辅助模块组成，业务子桥位于各 Feature。验证重点是：

- `pnpm typecheck` 确认 bridge 两端一致。
- Main 对应模块单元测试。
- `apps/desktop/renderer/test/unit/services/runtime-client/client.test.ts`。
- 使用事件 API 的 hook/component cleanup 测试。
