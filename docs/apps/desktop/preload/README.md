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
| `browser` | tab 注册、截图、favicon、设备模拟、新标签事件 | `ipc/browser-ipc.ts` |
| `desktopReview` | review state、stage、unstage、discard | `ipc/review-ipc.ts` |
| `terminal` | session open/write/read/resize/close、事件 | `ipc/terminal-ipc.ts` |
| `workspaceApps` | 应用列表与打开 workspace/file | `ipc/workspace-ipc.ts` |
| `updater` | 状态、检查、下载源、下载和打开 | `ipc/updater-ipc.ts` |
| `windowControls` | minimize/maximize/close/scale 与状态事件 | `ipc/window-ipc.ts` |

准确方法面由 `packages/contracts/src/desktop.ts`、`http.ts` 和相关领域 contract 定义。

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

1. 在 contracts 扩展 `SetsunaDesktopBridge` 或领域类型。
2. 在 main domain 模块实现能力。
3. 在 main `src/ipc/` 注册固定 handler/event。
4. 在 preload namespace 添加一行明确映射。
5. 在 renderer 增加 hook/helper。
6. 测试 main 行为和 renderer 调用。

如果方法需要大量本地状态机，状态机应留在 main service；preload 只做代理和 listener cleanup。

如果方法其实访问 runtime 数据，应扩展 `DesktopRuntimeClient`，不要新建直达 main 文件存储的桥。

## 类型来源

Renderer 的 `window.setsunaDesktop` 类型来自 contracts，不应在 renderer 另写全局声明副本。修改 preload 方法后如果类型检查没有同时影响 main/renderer，通常说明 contract 没有处于正确边界。

## 验证

Preload 当前只有一个生产文件，验证重点是：

- `pnpm typecheck` 确认 bridge 两端一致。
- Main 对应模块单元测试。
- `apps/desktop/renderer/test/unit/services/runtime-client/client.test.ts`。
- 使用事件 API 的 hook/component cleanup 测试。
