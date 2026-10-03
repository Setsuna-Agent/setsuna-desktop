# 桌面控制

源码：`packages/features/computer-use/`。复用现有 Agent、模型供应商、工具审批和图片附件管线。macOS 使用 Swift helper 按目标窗口截图并投递后台输入；Windows 由 Electron main 截图，独立 Rust helper 执行输入并按需通过 UAC 启动高权限输入进程。两条路径都不启动第三方 Agent 或 MCP server。

## 权限与生命周期

- 设置 → 电脑控制提供持久化总开关，首次使用默认关闭；开启后才向支持图片的模型提供电脑控制工具。普通工具审批策略继续生效。
- Windows 的系统权限区只显示「管理员权限」状态与「去授权」按钮，点击立即请求 UAC；确认后显示已授权，取消则保持未授权。授权只启动高权限输入 helper，不截图或开启输入会话；Electron 与 Agent 保持原权限。权限状态取自当前 helper，不写入偏好文件。
- 关闭开关立即撤销当前 session、取消执行中和排队的操作，以及所属 runtime turn。主进程也检查开关，已经进入模型上下文的旧工具调用无法绕过关闭状态；再次开启后需由新的用户 turn 创建 session。
- macOS 的系统权限区显示屏幕录制与辅助功能，Windows 隐藏这两项。未授权项提供「去授权」：用户点击后请求 macOS 权限，仍未获准则打开对应的系统设置页；聚焦窗口或点击刷新时重新读取状态。普通状态检查不弹窗。
- Windows 在 `computer_start` 时请求 UAC，确认管理员 token 后才开始截图与输入，设置页按钮仅用于提前授权。两种入口的授权状态一致；普通 `computer_stop` 和 turn 清理仅解除输入会话，下一次控制复用同一 helper。用户停止、急停、关闭总开关、错误、锁屏、runtime 或应用退出会关闭 helper 并撤销权限，下次开始操作时自动重新请求，无需先回设置页。
- `computer_start` 走通用工具审批。完整访问直接执行；需要确认的模式使用现有审批卡片，支持会话内记住授权。
- 后续截图和输入使用同一 session；macOS 绑定指定窗口，Windows 绑定主桌面。严格审批模式仍遵循通用策略。`computer_stop` 永远不等待审批。
- 自动化任务沿用自身权限设置，不因无人值守标记被额外禁用。只读任务与不支持图片的模型不提供桌面操作工具。
- 不重复弹出应用自己的确认；Windows 遇到管理员窗口时仍需用户确认系统 UAC。不要求 Setsuna 在前台，也没有固定会话时限。
- session 归属一个 thread/turn，避免不同任务交错控制键鼠。turn 完成、取消或失败时清理；顶部电脑图标悬停显示最近一次操作截图，点击图标打开预览，卡片底部提供停止按钮；Windows 使用 `Ctrl+Alt+Shift+Esc` 急停（避开系统任务管理器占用的 `Ctrl+Shift+Esc`），macOS 使用 `⌘+Shift+Esc`。急停快捷键注册失败时拒绝启动截图和输入，并提示发生冲突的组合键。
- 预览停止按钮和急停快捷键同时取消所属 runtime turn，防止模型在用户停止后继续调用其他工具。主进程同步记住已撤销的 turn；即使取消请求尚未完成，该 turn 也不能重新启动电脑控制。模型正常调用 `computer_stop` 只结束当前 session，仍可在同一 turn 切换窗口。
- 操作超时、断开连接、图片交付失败、锁屏、休眠和显示器变化会终止当前 session。单次调用超时用于回收卡住的操作，不限制整个任务的时长。
- runtime 子进程正常退出或崩溃时，main 的 `RuntimeHost.onExit` 通过 Feature lifecycle 撤销 session、清除预览并关闭 helper，不依赖 HTTP 请求仍在进行。重启 runtime 前等待清理完成；释放失败会阻止重新启动。

### 屏幕控制提示

控制期间，被控制的屏幕显示加粗的冷蓝色边框及柔和光晕，半透明控制条标明「AI 正在控制电脑」和用 `+` 连接的停止快捷键，并提供可点击的「停止操作」按钮。控制条通过原生拖动区域调整位置，截图不重置位置；Windows 点击或滚动前按实时窗口位置检查遮挡，必要时将控制条移到屏幕上沿或下沿，确认让开目标后才派发输入，停止按钮始终可点。Windows 对应绑定的主显示器；macOS 根据最新目标窗口截图的位置选择显示器。提示条语言跟随应用设置，快捷键与主进程注册的急停定义共用同一来源。

`NativeComputerSupervisor` 同时管理急停和 `ComputerControlIndicator`：边框与控制条分为两个原生窗口，首张观察交付前等待两者完成首帧，之后才允许模型发起输入。停止同步销毁两者；任一窗口加载被取消、崩溃或意外隐藏时终止控制，迟到的加载不能恢复已停止的会话。窗口仅展示无脚本的本地页面，无 preload、Node 或 IPC 能力，不进入应用工作窗口注册表。主进程只接受当前控制条的固定停止地址，按钮与急停一样撤销当前 turn。

两个窗口均不抢焦点，边框窗口始终鼠标穿透，只有控制条接受点击和拖动。Windows 在显示前设置 Electron 的 [截图排除](https://www.electronjs.org/docs/latest/api/base-window#winsetcontentprotectionenable-macos-windows)；macOS 继续只截图选中的目标窗口。边框按屏幕 DIP 定位，与模型截图到物理像素的输入换算分离。

## 工具与链路

`computer_windows` 查询输入模式；macOS 的 `background-window` 模式返回窗口列表，`computer_start` 必须传入其返回的 `windowId`，返回该窗口的首张截图。Windows 的 `foreground-desktop` 模式不枚举窗口，返回结果不包含 `windows` 字段，不能据此判断某应用是否运行；模型收到明确的下一步 `computer_start({})`，获取主屏截图后再判断桌面状态。切换目标窗口先 stop，再 start。`computer_screenshot` 刷新观察；`computer_action` 执行一次点击、文本输入、按键或滚动后重新截图；`computer_stop` 结束控制。

窗口枚举与输入共用 native helper。已有 session 时仅允许所属 thread/turn 枚举；其他任务在接触 helper 前被拒绝，取消它们不会关闭当前会话。同一任务的枚举沿用 session 的取消与失败清理，成功时保留可用 observation。

```text
ToolOrchestrator / 现有审批策略
  → ComputerToolHost → ComputerRuntimeTools
  → 鉴权 loopback HTTP → ComputerSettingsService → ComputerSessionController
  → macOS：Swift WindowCapture / BackgroundInput
  → Windows：Electron desktopCapturer / Windows 原生输入 helper
  → 图片附件 → 模型下一次采样
```

main/preload/renderer 通过窄 bridge 暴露状态、预览、停止、读取设置、修改总开关和请求指定系统权限，控制连接 token 不交给 renderer。权限请求只接受屏幕录制、辅助功能与管理员权限枚举；macOS 系统设置地址由 main 固定提供，Windows 授权只启动固定的输入 helper。总开关由 main 写入 userData 下的 `computer-use.json`，复用宿主的原子 JSON 写入。runtime 在每次构造工具列表时读取鉴权的只读 availability 接口；该 HTTP 接口不允许修改设置或发起系统授权。网页来源不能调用控制 HTTP。任务身份取自 runtime 上下文，不采信模型参数。

预览只读取当前 session 内最近一次截图，不额外截图，也不消耗模型的 observation；仅在卡片打开时每秒读取，关闭卡片或停止 session 后清除 renderer 中的图片。

每个输入必须引用本 session 最新且未过期的截图。模型只收到截图尺寸与窗口标识，不暴露容易混淆的屏幕原点和窗口 points。点击/滚动的 `x`、`y` 始终是返回图片中的像素，范围为 `0 ≤ x < width`、`0 ≤ y < height`。runtime 和 main 原样传递坐标，main 按所引用图片检查边界；只有原生输入模块执行一次图片到目标坐标的转换。macOS helper 按截图尺寸转换为窗口内 points，并检查 PID、窗口编号、应用启动时间和窗口几何。键盘输入额外核对目标应用的 AX focused window，避免输入落到同进程的另一个窗口。Windows 按实际图片尺寸转换为 physical pixels；显示器身份与几何变化会终止 session。输入派发成功不等于任务完成，模型应检查返回图片。图片内容按不可信外部数据处理。

旧 observation、越界坐标或输入前发现窗口移动/缩放时，不派发输入、不自动重试；保留 session 并返回新截图、`inputDispatched: false` 和 `actionError`，模型需基于新截图决定下一步。无法确认是否已派发部分输入的失败仍终止 session；错误会提醒检查现有内容，避免重复写入。

macOS 通过 ScreenCaptureKit 截取指定窗口，以 nominal 分辨率输出、长边上限 2048 像素，不按 Retina 倍率放大；Windows 通过 Electron desktopCapturer 截取主桌面，等比例限制长边为 1920，编码图片与返回尺寸保持一致，真实屏幕尺寸仅用于输入映射。截图只在内存编码后进入已有附件管线。空或损坏的图片会失败；深色、纯色和空白画面只记录质量指标，不凭颜色推断权限失败或拒绝合法桌面。Windows helper 只执行原生输入。macOS helper 提供固定的窗口枚举、截图与输入命令；两者都不读写剪贴板或运行任意脚本。

## 当前范围

- macOS 14+：后台窗口控制，可选择不同显示器上的普通应用窗口。Windows：多屏环境下只控制主显示器，目标应用需位于主屏，使用真实键鼠。截图按 Electron 主屏 ID 选择；原生输入按主屏原点和物理尺寸核对，不依赖显示器枚举顺序，也不将 Win32 monitor handle 当作 Electron display ID。
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

### Windows 启动修复（2026-10-03）

Windows 真机复现旧急停快捷键注册失败，新 `Ctrl+Alt+Shift+Esc` 注册与释放成功。双屏环境下，主屏绑定、原生 helper 启动与停止、真实显示器元数据的坐标校验通过；坐标派发由记录器替代，没有截图或向真实应用发送输入。111 项定向测试、typecheck（含架构检查）与模块 lint 通过，覆盖多屏主屏选择、枚举顺序、重复/缺失主屏和尺寸变化时拒绝输入。Windows 真实截图、点击、输入与硬件急停仍待端到端验收。

随后修正 Windows 模式查询的返回语义：此前固定返回 `windows: []`，模型可能把未实现窗口枚举误判成没有应用运行，并在调用 `computer_start` 前终止任务。现在只有后台窗口模式携带窗口列表，主屏模式明确返回下一步截图调用；工具说明和宿主提示同步区分两种模式。24 项定向测试、typecheck 和相关 lint 通过，其中 Windows 测试贯穿实际后端、鉴权 HTTP、runtime 结果投影、无 windowId 启动及截图附件交付，原生输入和截图使用测试替身。

### Windows 输入提权与结果检查（2026-10-03）

Windows 输入改由 `native/computer-use-windows` 的窄协议辅助程序执行，Electron、renderer 和 Agent 不提权。普通进程通过私有 stdio 接收输入；目标权限更高或 Windows 在任何输入被接受前拒绝 `SendInput` 时，通过 `ShellExecuteExW(runas)` 请求系统 UAC。只启动当前辅助程序本身，协议不接受可执行文件路径、脚本或 shell 命令。上游事件映射的许可继续保留在 `THIRD_PARTY_NOTICES.md`，不再打包原来的第三方 MCP 依赖。

高权限进程使用随机本地命名管道，双向核对进程 PID，禁止远程连接。停止、取消、宿主退出和管道断开都会撤销输入；设置页主动授权或开始控制时自动授权，均只在应用运行期间保留空闲 helper，普通会话结束会解除输入。等待 UAC 时仍能处理取消；迟到的授权不能恢复已关闭的输入通道。模型操作触发的 UAC 被取消后会撤销当前 turn，避免反复请求授权。

每个 `SendInput` 批次检查系统接受的事件数量。完整键鼠按下/释放作为一批，文本按 Unicode 字符分批；只接受部分事件时尝试释放按键并明确报错，不重放已经接受的输入。每个键盘批次还会确认前台窗口未切换，且客户区完整位于主屏物理边界内；副屏、跨屏、无法查询的目标均拒绝输入，连续输入中途移动窗口也会停止后续字符。提权成功也不重放原操作，而是返回 `inputDispatched=false` 和新截图。坐标按 DPI-aware 主屏物理尺寸换算一次，采用像素中心的绝对坐标。

Windows start/action 为 UAC 留出 120 秒，HTTP 客户端和服务端同步超时；截图有效期仍为 30 秒，Mac 的操作超时保持不变。`pnpm build:computer-use:windows` 构建原生程序，`build:electron` 和 `beforePack` 自动调用，打包验证 PE 架构。原生检查和手动 UAC 探测见 `native/computer-use-windows/README.md`。

本轮 106 项 TypeScript 定向测试、7 项原生测试、typecheck（含架构检查）、相关 ESLint 和 Clippy 通过。实际 UAC 探测确认输入 helper 获得高完整性级别、正常响应并退出，未向 QQ 或其他应用发送键鼠输入。

### Windows 权限查询与观察失败修复（2026-10-03）

重试记录暴露了一个遗漏：普通进程查询 QQ 的 token 返回 `ERROR_ACCESS_DENIED`，旧分支将查询失败当成无需提权，仍然投递输入。现在无法确定目标权限时先请求 UAC；提权后重新检查，如果仍无法读取权限则拒绝输入。真机只读验证确认普通权限查询 QQ token 失败（错误 5），UAC 后可读取，QQ 和诊断进程的完整性级别均为 `0x3000`。这项验证不发送键鼠，不能替代 QQ 操作验收。

截图捕获保留 Electron 的字符串错误。动作后截图失败会明确告知输入是否已派发，停止会话并要求重新观察，防止模型把截图失败当成输入未执行而重复点击或输入。定向测试覆盖权限未知、提权后仍不可读、截图失败的两种派发状态，以及捕获错误恢复。

最新 MiniMax 重试另有坐标判断错误：2560×1440 截图中联系人约在 `(900, 480)`，模型传入 `(170, 162)`，实际点到其他应用。该错误发生在原生坐标换算之前，不能用固定偏移补偿；权限修复不代表模型的视觉定位已通过验收。

### 截图坐标契约（2026-10-03）

此前根据一次模型回放把工具改成 0–1000 相对坐标，随后 GPT 重试把图片像素 `(680, 289)` 提交给该工具，main 将其转换成 `(1305, 312)`，落到联系人右侧。权限已生效，额外的坐标语义转换却使定位更难核对；单个模型在一张图片上的成功不能证明整个工具协议可靠。

现统一采用返回图片的像素坐标，删除相对坐标类型、单位选择和 main 转换层，不按模型名称适配。参考 [Anthropic computer-use demo 的截图/坐标映射](https://github.com/anthropics/anthropic-quickstarts/blob/main/computer-use-demo/computer_use_demo/tools/computer.py) 和 [mcp-computer-use 的 CoordinateMap](https://github.com/anaisbetts/mcp-computer-use/blob/main/src/scaling.rs)：图片尺寸就是操作坐标系，缩放关系由执行端持有。截图尺寸、图片传输和原生输入共用同一 observation；未知工具参数会被拒绝，不允许附加参数悄悄改变坐标含义。

验证覆盖工具到 HTTP、session、Windows helper 的像素透传，macOS 窗口像素透传，以及 Rust 输入事件在横屏、竖屏、缩放和边缘上的实际落点。模型只读回放与真实应用操作验收分开记录；测试不发送 QQ 消息。

112 项定向测试、Windows 原生测试（9 项通过，人工 UAC 测试跳过）、typecheck 和 lint 通过。两张已有截图的只读回放中，GPT-5.6-luna 两次返回的像素均在联系人行内；MiniMax-M3.1 一次返回近似相对坐标，一次选择了滚动，均未命中目标。后者仍未通过模型操作验收；不因单个模型的输出更改全局坐标协议，也不将静态回放当作 QQ 端到端成功。
