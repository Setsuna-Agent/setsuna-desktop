# Diagnostics

源码：`packages/features/diagnostics/`。Feature 参与 main、preload 和 renderer；runtime 子进程的生命周期由宿主 `RuntimeProcess` 观察，目前没有独立 runtime entry。

## 所有权与接入

- `packages/contracts/src/desktop/diagnostics.ts` 仅定义通用 `DiagnosticReporter` 与标量字段类型，不依赖文件系统或具体 Feature。
- Feature main 拥有 `DesktopDiagnosticLog`、轮转和固定目录 IPC。宿主在创建窗口前建立进程级 writer，注入应用版本和平台信息，保证 Feature 激活前的故障也能记录；writer 构造不访问磁盘。
- 宿主 `main/src/composition/diagnostics-main-binding.ts` 监听 Electron renderer、原生子进程退出和窗口无响应；runtime 进程、renderer 加载及恢复分别由原生命周期 owner 通过注入的 reporter 上报。
- Main Feature setup 只注册目录 handler，并由 scope 管理在途打开请求和 handler 清理。Main 与 renderer 都以 optional Feature 登记，磁盘写入不参与任何就绪等待。
- Preload 静态贡献 `diagnostics.getLogDirectory()` 和 `diagnostics.openLogDirectory()`。IPC 只接受登记桌面窗口的主 frame，目录由 main 决定。
- Renderer 通过 Settings page Slot 注册“系统 → 日志”，页面与 hook 只消费注入的 bridge、翻译和设置控件；进入页面时才读取路径，打开失败使用 Toast。缺少诊断 bridge 时仅降级该 Feature，不注册日志入口，也不阻塞其他页面。

文件位于本机 bootstrap 的 `logs/desktop-diagnostics.jsonl`，不跟随数据根迁移，开发实例与正式版隔离。每条记录携带 UTC 时间、应用/Electron/Chromium/V8/系统版本、架构、启动会话 ID、main PID 与运行时长。

## 当前采集边界

| 链路 | 记录 |
| --- | --- |
| 应用启动 | 启动、完成耗时和失败调用位置 |
| 桌面文档加载 | 开始、资源加载完成、本机服务就绪及两者各自的失败 |
| Renderer | 退出原因/退出码/WebContents ID、无响应、自动恢复开始/加载成功/失败/次数耗尽 |
| Electron 原生子进程 | GPU 等进程的类型、退出原因和退出码 |
| Runtime 子进程 | 启动/ready 耗时、PID、退出码/信号、是否主动退出、ready 后运行时长 |
| Runtime 恢复与关闭 | 重试次数/退避、次数耗尽、原生资源清理失败、关闭失败，以及启动失败的阶段/超时/health 状态码 |

普通请求、SSE 消息和 Agent 工具执行不逐条写入此日志；线程持久化事件、数据迁移事务和电脑控制诊断仍由原领域 owner 持有。错误快照仅保留异常类型、错误码和有限调用位置，不复制异常 message、任意 rejection 对象、stderr、模型响应、工具参数或凭据。主动取消使用独立事件，不作为 runtime 启动失败。

日志按事件异步串行写入，单文件上限 2 MiB，保留三个备份；排队数量有限，写入失败后可处理后续事件。正常退出在服务关闭后排空记录，以包含最后的退出事件，最多等待一秒。诊断 reporter 抛错不会改变启动、重试或恢复结果。此处的调用位置是 JS 异常栈；原生崩溃仍需结合系统崩溃报告。

验证以真实临时文件的有序写入/跨启动追加/轮转/失败恢复、Feature scope 清理、IPC 权限、恢复状态与隐私边界为主；慢磁盘和失败写入下对比 renderer readiness，确保日志不阻塞启动。
