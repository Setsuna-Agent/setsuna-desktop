# 桌面控制

源码：`packages/features/computer-use/`。复用现有 Agent、模型供应商、工具审批和图片附件管线。macOS 使用 Swift helper 按目标窗口截图并投递后台输入；Windows 由 Electron main 截图，独立 utility process 加载 Zavora 原生输入模块。两条路径都不启动第三方 Agent 或 MCP server。

## 权限与生命周期

- 设置 → 电脑控制提供持久化总开关，首次使用默认关闭；开启后才向支持图片的模型提供电脑控制工具。普通工具审批策略继续生效。
- 关闭开关立即撤销当前 session、取消执行中和排队的操作，以及所属 runtime turn。主进程也检查开关，已经进入模型上下文的旧工具调用无法绕过关闭状态；再次开启后需由新的用户 turn 创建 session。
- 设置页右侧展示屏幕录制、辅助功能权限。未授权项提供「去授权」：用户点击后请求 macOS 权限，仍未获准则打开对应的系统设置页；聚焦窗口或点击刷新时重新读取状态。普通状态检查不弹窗；Windows 显示无需授权。
- `computer_start` 走通用工具审批。完整访问直接执行；需要确认的模式使用现有审批卡片，支持会话内记住授权。
- 后续截图和输入使用同一 session；macOS 绑定指定窗口，Windows 绑定主桌面。严格审批模式仍遵循通用策略。`computer_stop` 永远不等待审批。
- 自动化任务沿用自身权限设置，不因无人值守标记被额外禁用。只读任务与不支持图片的模型不提供桌面操作工具。
- 不弹出第二次原生确认，不要求 Setsuna 在前台，不创建独立悬浮窗，也没有固定会话时限。
- session 归属一个 thread/turn，避免不同任务交错控制键鼠。turn 完成、取消或失败时清理；顶部电脑图标悬停显示最近一次操作截图，点击图标打开预览，卡片底部提供停止按钮；`CommandOrControl+Shift+Escape` 仍可立即停止。
- 预览停止按钮和急停快捷键同时取消所属 runtime turn，防止模型在用户停止后继续调用其他工具。主进程同步记住已撤销的 turn；即使取消请求尚未完成，该 turn 也不能重新启动电脑控制。模型正常调用 `computer_stop` 只结束当前 session，仍可在同一 turn 切换窗口。
- 操作超时、断开连接、图片交付失败、锁屏、休眠和显示器变化会终止当前 session。单次调用超时用于回收卡住的操作，不限制整个任务的时长。
- runtime 子进程正常退出或崩溃时，main 的 `RuntimeHost.onExit` 通过 Feature lifecycle 撤销 session、清除预览并关闭 helper，不依赖 HTTP 请求仍在进行。重启 runtime 前等待清理完成；释放失败会阻止重新启动。

## 工具与链路

`computer_windows` 返回输入模式和可选窗口；macOS 的 `computer_start` 必须传入其返回的 `windowId`，返回该窗口的首张截图。Windows 不传 `windowId`，保持主桌面控制。切换目标窗口先 stop，再 start。`computer_screenshot` 刷新观察；`computer_action` 执行一次点击、文本输入、按键或滚动后重新截图；`computer_stop` 结束控制。

窗口枚举与输入共用 native helper。已有 session 时仅允许所属 thread/turn 枚举；其他任务在接触 helper 前被拒绝，取消它们不会关闭当前会话。同一任务的枚举沿用 session 的取消与失败清理，成功时保留可用 observation。

```text
ToolOrchestrator / 现有审批策略
  → ComputerToolHost → ComputerRuntimeTools
  → 鉴权 loopback HTTP → ComputerSettingsService → ComputerSessionController
  → macOS：Swift WindowCapture / BackgroundInput
  → Windows：Electron desktopCapturer / Zavora 输入 helper
  → 图片附件 → 模型下一次采样
```

main/preload/renderer 通过窄 bridge 暴露状态、预览、停止、读取设置、修改总开关和请求指定系统权限，控制连接 token 不交给 renderer。权限请求只接受屏幕录制与辅助功能枚举，对应系统设置地址由 main 固定提供。配置由 main 写入 userData 下的 `computer-use.json`，复用宿主的原子 JSON 写入。runtime 在每次构造工具列表时读取鉴权的只读 availability 接口；该 HTTP 接口不允许修改设置或发起系统授权。网页来源不能调用控制 HTTP。任务身份取自 runtime 上下文，不采信模型参数。

预览只读取当前 session 内最近一次截图，不额外截图，也不消耗模型的 observation；仅在卡片打开时每秒读取，关闭卡片或停止 session 后清除 renderer 中的图片。

每个输入必须引用本 session 最新且未过期的截图。模型只收到截图尺寸与窗口标识，不暴露容易混淆的屏幕原点和窗口 points。macOS 使用窗口截图像素坐标，helper 按截图尺寸转换为窗口内 points，并检查 PID、窗口编号、应用启动时间和窗口几何。键盘输入额外核对目标应用的 AX focused window，避免输入落到同进程的另一个窗口。Windows 按实际图片尺寸转换为 physical pixels；显示器身份与几何变化会终止 session。输入派发成功不等于任务完成，模型应检查返回图片。图片内容按不可信外部数据处理。

旧 observation、越界坐标或输入前发现窗口移动/缩放时，不派发输入、不自动重试；保留 session 并返回新截图、`inputDispatched: false` 和 `actionError`，模型需基于新截图决定下一步。无法确认是否已派发部分输入的失败仍终止 session；错误会提醒检查现有内容，避免重复写入。

macOS 通过 ScreenCaptureKit 截取指定窗口，以 nominal 分辨率输出、长边上限 2048 像素，不按 Retina 倍率放大；Windows 通过 Electron desktopCapturer 截取主桌面。截图只在内存编码后进入已有附件管线。空或损坏的图片会失败；深色、纯色和空白画面只记录质量指标，不凭颜色推断权限失败或拒绝合法桌面。Windows helper 只执行原生输入。macOS helper 提供固定的窗口枚举、截图与输入命令；两者都不读写剪贴板或运行任意脚本。

## 当前范围

- macOS 14+：后台窗口控制，可选择不同显示器上的普通应用窗口。Windows：仍为单显示器主桌面控制，使用真实键鼠。
- macOS 使用 SkyLight 目标窗口事件和 per-PID 键盘事件，不调用全局 HID、真实光标移动或应用激活 API；不支持的后台操作报错，不回退到真实键鼠。未提供窗口的旧工具调用也不会进入全局输入路径。
- 只枚举当前可用的非最小化、非隐藏普通窗口。私有 API、应用对合成事件的支持仍有兼容性边界；同一窗口同时编辑仍共享应用内的光标和文档状态。
- 点击、Unicode 文本、导航按键、字母/数字组合快捷键和垂直滚动；暂不支持拖拽。`key` 的可选 `modifiers` 接受 `Meta`（macOS Command / Windows Win）、`Control`、`Alt`、`Shift`，例如 Cmd+N 为 `{ kind: 'key', key: 'n', modifiers: ['Meta'] }`。macOS 修饰键只附加在目标 PID 的事件上，不修改真实键盘状态。
- macOS 使用系统录屏和辅助功能权限。通过设置页的按钮发起授权请求，用户在系统界面完成授权；应用不自行修改系统设置。
- main 的元数据日志保留阶段、停止原因、尺寸和匹配结果，不保存图片、输入、标题、token 或任务身份；日志按大小轮转。

## 构建

`pnpm build:computer-use:mac` 编译当前 Mac 架构的 Swift helper；追加 `x64` 可交叉编译 Intel 版本。`build:electron` 自动准备开发架构，`beforePack` 准备安装包架构，打包后检查 Mach-O 架构及开源许可文件。helper 直接由权限所属 Electron 宿主启动；开发宿主若仍从 ChatGPT 启动，系统权限的 responsible-process 归属不会因换 helper 自动改变。

原生事件实现适配自 MIT 项目 BackgroundComputerUse 的固定提交，来源和许可保留在 `native/computer-use-macos/`。没有整套引入上游服务和持久化逻辑。

## 验证

定向测试覆盖共享审批、任务隔离、取消与急停、图片和坐标校验、原生输入映射、HTTP 鉴权以及打包资源。

```bash
pnpm test:unit packages/features/computer-use/test packages/desktop-runtime/test/adapters/tool/computer-tool-host.test.ts scripts/test/computer-use-resources.test.ts
pnpm test:computer-use:mac
```

原生测试只构造键盘事件、验证修饰键释放与截图坐标换算，不投递输入、不截图、不打开应用。

macOS 真机使用独立签名的 Computer Use Lab 与隔离数据目录，针对本地合成页面验证截图、点击、输入、滚动和取消。Lab 的签名身份由 `CSC_NAME` 显式指定；不复用正式版 bundle ID。历史验收日志保留在开发 checkout 外的 validation 目录，不能以旧包结果替代当前源码验收。Windows 尚待真机验证。

### 设置页验证（2026-10-02）

81 项定向测试通过，覆盖配置持久化、默认关闭、写入失败、并发开关、执行中取消、排队操作失效、工具列表刷新、只读 HTTP 鉴权与 renderer Feature 注册，以及系统授权请求、拒绝后的设置入口、重复点击和返回应用时刷新权限。typecheck（含架构检查）、lint 和 diff 检查通过。当前开发应用已重新启动以加载 main/preload；未重新制作安装包、修改本机系统权限或执行界面视觉验证。

### 原生控制验证（2026-10-02，设置页加入前）

macOS arm64 签名 Lab 已通过真实桌面截图、像素点击、中文与 emoji 输入、Enter 按下/释放、垂直滚动、输入中途取消及显式停止。取消在输入了 13 个测试字符后生效，随后输入不再增长；停止后的截图请求被拒绝。测试只操作本地合成页，图片未落盘或发送模型。

定向 93 项、单测 3239 项、集成 610 项通过；typecheck、lint、构建和深度签名校验通过。急停快捷键的注册、回调和清理已通过单测，但真机模拟快捷键的 Node 宿主缺少辅助功能权限，因此实际硬件快捷键仍未验收。Windows 仍待真机验证。

### 后台窗口接入（2026-10-03）

92 项定向测试通过；全量单测 3263 项、集成 610 项通过（分别跳过 7 项和 1 项）。覆盖窗口枚举、窗口绑定、独立截图附件、跨窗口输出拒绝、停止后换窗口、helper 取消/崩溃/退出确认、macOS 禁止全局输入和打包架构检查。typecheck、lint 通过；arm64 与 x64 原生 helper 均编译成功。原生 helper 的构建与只读 API 探测可独立验证，不请求系统权限或向应用发送输入。旧版全局输入 Lab 的真机结果不代表新后台路径已通过验收；后台点击/打字与用户键鼠并行使用仍需在当前签名宿主上进行真机验证。

### 备忘录调用链修复（2026-10-03）

108 项定向测试通过，覆盖用户停止到所属 turn 取消的 main/IPC/HTTP 链路、同 turn 撤销、新 turn 恢复、输入前窗口变化的截图刷新、组合键解析和派发、模型观察信息。原生键盘事件与坐标测试、typecheck、lint 通过；arm64 与 x64 helper 编译成功。本轮没有向备忘录或其他真实应用发送输入，新组合键与 nominal 截图尚未真机验收。
