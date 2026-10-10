# 系统通知

源码：`packages/features/notifications/`。Runtime/Main 为 optional Feature，preload 提供固定导航事件；不注册 renderer 视图。通知由 macOS 通知中心和 Windows 通知中心展示。

## 调用链

### 后台任务完成

`持久化 turn.completed -> Runtime EventBus 全局实时订阅 -> Notifications runtime -> 已认证 native bridge -> Main 前台判断 -> Electron Notification`。

- 每轮成功完成后自动处理，不要求模型调用工具，也不依赖该对话在 renderer 中保持订阅。
- 标题使用对话名称，正文使用该 turn 的可见 `final_answer`；忽略中途 commentary、推理、失败/取消、压缩、用户 Shell、子代理及临时 side 对话。空回答不发通知。
- 通知预览折叠空白，标题最多 80、正文最多 160 个 UTF-16 字符；超长加 `…`，按完整字素截断以保留 emoji。
- Main 在实际发送前检查原生窗口焦点；应用有前台窗口时返回 `suppressed`，不创建通知，切到后台后也不补发这次已跳过的事件。用户显式要求的 `send_notification` 不受这项自动通知策略限制。
- 幂等 ID 绑定 thread/turn，同一完成事件重复投递只显示一次。只订阅实时发布，不在启动或 SSE 重连时重放历史完成通知。
- 完成事件先落盘再异步发送，慢通知/权限失败不阻塞任务结束、事件推送或下轮输入；失败记录到 Feature health。关闭时取消请求并移除订阅，迟到的线程读取不会再次发送。

### 显式发送

`send_notification -> NotificationToolHost -> Feature runtime client -> 已认证 native bridge -> Feature main -> Electron Notification`。

- 工具只接受标题和正文。来源 thread ID、幂等 ID 由真实工具上下文提供，模型不能指定其他对话；只读 turn 不开放工具。
- Runtime client 只连接 main 注入的 HTTP loopback 地址，携带原有 bearer token，禁用重定向和代理，并有取消及 10 秒超时。Renderer 不持有端口、token 或发送通知的 IPC。
- Main 在收到请求时才创建原生通知。同一工具调用的重复请求在当前进程内去重，最多保留 200 个通知的回调与去重记录。失败后允许重试。
- 点击通知时，宿主显示并聚焦现有窗口，经 preload 固定事件导航到来源对话。Windows 横幅超时仍保留点击回调，用户可从系统通知中心打开对话。
- 工具等待 Electron 的原生 `show` 回调后才返回 `shown`，已确认发送的重复调用返回 `duplicate`。`failed`、不支持和 8 秒未确认都抛出工具错误，不能显示为发送成功；原生错误保留给调用方并进入 Feature health，成功后清除旧错误。并发重试共享同一次确认，失败后允许重试。

## 平台与生命周期

Windows main 在通知前设置与 NSIS 开始菜单快捷方式一致的 AppUserModelID；开发实例使用 Electron 可执行文件路径，当前 Electron 在首次创建通知 presenter 时注册快捷方式及激活器。macOS 使用 Electron 原生通知接口，应用必须有有效的 bundle 签名并取得系统通知授权。`pnpm dev` 自动在后台准备独立的 `Setsuna Desktop Dev.app`，以开发 bundle ID、本机 ad-hoc 签名和固定缓存路径注册到系统；不需要 Developer ID 证书，仍使用未打包的开发 profile。有效缓存直接用于启动；首次或缓存失效时先启动原 Electron，准备完成后重启 Electron 才使用通知应用。复制、签名或注册的慢任务及失败均不阻塞窗口；退出时取消准备并忽略迟到结果。首次发送时需用户允许该应用通知，曾拒绝时需在系统设置中开启。开发 supervisor 的完整时序见 [开发启动链路](../development/build-and-release.md#scriptsstart-electron-devts)。

`Notification.isSupported()` 不代表已获权限，`UNErrorDomain 1` 表示当前应用不允许提交通知；操作系统仍可根据通知授权及专注模式决定横幅展示。平台要求参见 [Electron 通知指南](https://www.electronjs.org/docs/latest/tutorial/notifications)、[Notification API](https://www.electronjs.org/docs/latest/api/notification) 和 [Apple 的通知权限错误说明](https://developer.apple.com/documentation/usernotifications/unerror/notificationsnotallowed)。

Feature 激活只登记服务、实时事件订阅与回调，没有磁盘恢复、网络请求或系统通知调用；没有通知任务阻塞 runtime ready 或首帧。Scope 关闭时取消未确认请求并撤销 route 和事件监听，迟到的回执不能再次导航；只撤回失败或取消的请求，不主动清空已确认通知的系统历史。

未来提醒由现有 `manage_automation` 安排，在任务执行时调用 `send_notification`；调度仍要求应用运行，不新增系统后台服务。

## 验证

`test/main/feature.test.ts` 覆盖前台抑制与后台发送、按需调用、并发去重、Windows 横幅超时后的点击、异步权限拒绝、未确认超时与取消/关闭；同时记录空 host 与通知 Feature 的激活耗时。`test/runtime/` 覆盖精确轮次的最终回答、Unicode 截断、终态与内部任务过滤、启动零读取/发送、慢请求取消及关闭后不补发，以及来源绑定、只读边界、loopback 鉴权、重定向拒绝、回执校验与错误传播。

`scripts/test/prepare-electron-dev-app.test.ts` 覆盖独立签名应用、缓存复用与 Electron 更新、签名失败保留旧应用及重试、慢命令取消和临时目录清理、Windows 不执行 macOS 准备。`scripts/test/start-electron-dev.test.ts` 覆盖 Electron 启动和计划重启不等待准备、后台失败隔离、下次启动使用准备结果及关闭后忽略迟到结果。真实横幅、系统权限及系统通知中心点击需要在 macOS 开发/签名应用和 Windows 应用验证；mock 测试只验证接线与生命周期。
