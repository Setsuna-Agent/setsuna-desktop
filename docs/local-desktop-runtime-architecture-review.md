# 本地桌面 Runtime 架构评审

日期：2026-06-25

## 摘要

新的桌面项目应该按“本地优先桌面应用”来做，而不是在现有 `pc/` 目录里原地硬改。

推荐方向：

- 采用单本地 runtime 架构：桌面壳 -> preload bridge -> 本地 runtime host -> 本地 HTTP/SSE runtime。
- 这是独立开源 Git 仓库，不作为当前 repo 子目录、私有 monorepo package 或内部发布脚本的附属物。
- 使用 Electron + 本地 React renderer。这里的“不再 WebView”指不再加载远端 WebView/Tauri external URL，也不再使用后端托管的桌面 UI，不是完全禁止 Chromium renderer。
- 保留当前 DesktopAgent 工作台里有价值的体验。
- 把现有 `pc/` 的本地 runtime 能力迁移到新的 runtime 边界里。
- 移除后端 Agent API、远端会话/项目绑定、远端 WebView 加载。
- 用户只需要配置本地模型供应商：OpenAI compatible、OpenAI Responses API 或 Anthropic。
- GitHub Releases 是发布真源：安装包、压缩包、校验和/签名、release manifest、构建日志、测试日志和打包日志都必须随每个 release 上传。
- macOS 暂时沿用现有无 Apple Developer ID 证书、无公证的更新体系；GitHub Release 仍然承载 macOS 产物、metadata、校验和和日志，但不把证书签名/公证作为 v1 发布阻断项。

这次重构的核心反转是：

- 当前 `pc/`：远端 Web 应用优先，本地 runtime 是本地工作区/本地模型路径的增强。
- 新项目：本地 runtime 优先，renderer 只是本地客户端，主工作流不依赖后端。

## 当前证据

当前桌面壳仍然在加载远端页面：

- `pc/src/src/window.rs` 调用 `security::configured_app_url()`，并创建 `WebviewUrl::External`。
- `pc/src/src/security.rs` 的生产默认 origin 是 `https://agent.ziyilike.com`。
- `pc/src/src/menu.rs`、`pc/src/src/commands.rs`、`pc/src/src/terminal.rs` 仍然基于这个 configured app URL 做 trusted-window 检查。

当前 runtime 仍然保留后端 fallback：

- `pc/src/sidecars/runtime-core.mjs` 只有在 `state.localLlmService` 存在时才走本地 LLM，否则会调用后端 agent stream。
- `pc/src/sidecars/agent-stream.mjs` 通过 `serverUrl` 拼出 `/api/v1/llm/agent/stream`。
- `runtime-core.mjs` 仍然会读取云端 passive-memory sessions，并 best-effort PATCH 消息 extra 到后端会话。

当前 DesktopAgent 前端仍然混用了本地状态和后端状态：

- `front-end/src/features/desktop-agent/api/desktopAgentApi.ts` 导入 `agentApi`，没有 workspace 时会 fallback 到后端 stream。
- `front-end/src/pages/DesktopAgent/DesktopAgent.tsx` 通过 `agentApi` 获取 runtime config、项目/会话绑定、会话列表、上下文压缩、归档、重命名等。
- `front-end/src/pages/DesktopAgent/components/DesktopCapabilitiesPanel.tsx` 已经有 Skill 管理和选择入口，但 `front-end/src/features/skills/api/skillApi.ts` 仍然请求 `/api/v1/llm/skills` 和 `/api/v1/files/upload`。
- 本地会话主要在选中负数 model id 时才启用，所以本地优先现在只是条件分支，不是真正的唯一真源。

已经存在、值得迁移的本地资产：

- `pc/src/sidecars/local-llm-stream.mjs`：OpenAI compatible、Responses API、Anthropic 的 streaming adapter 雏形。
- `pc/src/src/llm_config.rs`：本地模型 provider 配置、provider 归一、模型列表 URL 归一、稳定负数 model id 选择。
- `pc/src/src/local_sessions.rs`：本地 session index、session 文件、memory preview/delete/reset。
- `pc/src/src/projects.rs`：本地项目注册、目录选择、git root 解析、搜索和读取辅助能力。
- `pc/src/src/mcp_config.rs` 和 `pc/src/runtime/mcp-runtime.mjs`：MCP 配置和运行时加载。
- `pc/src/runtime/local-tools.mjs`：shell、文件、搜索、读写工具、审批敏感执行、本地 memory helper。
- `pc/src/sidecars/runtime-core.mjs`：已有 `skill_injections` -> `<skill>` 上下文消息的注入、去重、截断和 tag neutralize 逻辑。
- `pc/skills/presentation-mcp/SKILL.md`：内置 Presentation MCP 技能资产，应该随新 runtime 的内置技能一起迁移。

## 需求

新项目的明确需求：

- 正常运行不依赖后端 Agent API。
- 不加载远端 Web 应用。
- 本地模型供应商通过 base URL 和 API key 配置。
- 支持的 provider 协议：
  - OpenAI compatible：`/chat/completions`
  - OpenAI Responses API：`/responses`
  - Anthropic：`/v1/messages`
- 本地会话、项目元信息、memory、usage、工具进程状态、审批、workspace status 都在本地。
- Skills 需要本地化：内置 Skill、用户 Skill、Skill 引用文件、启停状态、选中状态和模型上下文注入都不能依赖后端。
- Renderer 不直接实现 agent loop。
- Runtime 负责模型调用、工具执行、状态持久化、审批 gate、用户输入 gate、上下文压缩和事件流。
- UI 保留 DesktopAgent 中有价值的部分：项目侧栏、聊天、文件树、终端、diff/review、MCP/Skill 能力面板、设置、本地模型配置。
- 新项目必须能从公开仓库 fresh clone 后按 README 构建和运行，不依赖当前 repo 的私有路径、内部下载中心或后端环境。
- 发布流程必须基于 GitHub Actions 和 GitHub Releases，不能只在本地机器生成安装包后手工散发。

第一版非目标：

- 重做所有后端、移动端、后台管理 Agent 页面。
- 保留云端分享、登录、远端项目绑定。
- 支持多个桌面 runtime provider。
- 照搬外部项目的 UI。
- 引入云端 managed session。

## 开源仓库与发布规范

新项目按独立开源 Git 仓库设计。当前 repo 只作为调研和迁移来源，不能成为运行时或构建时依赖。

仓库基础要求：

- 根目录提供清晰的 `README.md`、`LICENSE`、`CONTRIBUTING.md`、`SECURITY.md` 和 release 说明入口。
- 常用脚本必须显式可见：`dev`、`build`、`test`、`typecheck`、`lint`、`package`、`release:dry-run`。
- fresh clone 后不需要当前 repo 的相对路径、私有后端、私有对象存储或人工复制资产才能启动基础本地 app。
- 内置 Skill、runtime fixture、图标、字体和基础模板都随仓库提交或通过公开包管理器安装。
- CI 必须覆盖干净环境安装、类型检查、单元测试、打包冒烟和 release 产物校验。

版本和 tag 规范：

- 使用 semver，tag 格式为 `vX.Y.Z`。
- Release notes 从 git history、PR 标题或变更集生成，不能只靠人工临时补写。
- 每个 release 都要有机器可读的 `release-manifest.json`，记录版本、commit、平台、产物文件名、sha256、签名状态、构建时间和构建 workflow run。
- 如果后续存在镜像下载站或 updater feed，必须从 GitHub Release manifest 派生，GitHub Release 仍然是 canonical source。

macOS 临时无证书更新策略：

- v1 macOS 暂时沿用当前无 Apple Developer ID 证书、无 notarization 的更新体系，不要求 Developer ID Application/Installer 证书。
- macOS 产物仍然上传到 GitHub Release，包括 `.dmg`、必要的 `.zip`、`latest-mac.yml`、sha256/sha512 校验信息、release manifest 和构建/打包/上传/验证日志。
- 更新体验沿用当前 manual-install 思路：检查到新版本后下载 DMG，完成后由应用打开访达定位安装包，由用户手动安装；不做静默替换或自动重启安装。
- `release-manifest.json` 必须显式标注 macOS 产物状态，例如 `signing: "unsigned"`、`notarization: "skipped"`、`installMode: "manual"`，避免后续误判为已签名/已公证。
- Release notes 需要提示 macOS 未签名/未公证的安装方式和 Gatekeeper 可能出现的系统提示。
- 这只是过渡策略；后续如果切换到 Apple Developer ID 签名和 notarization，需要作为单独迁移阶段，不夹带在普通版本发布里。

GitHub Release 资产要求：

- 构建产物：macOS `.dmg`/`.zip`，Windows installer/portable，Linux AppImage/deb/tar 等按实际支持平台上传；macOS v1 产物标注为 unsigned/manual-install。
- 校验文件：`SHA256SUMS` 或 `checksums.txt`；启用签名后同步上传签名文件和公钥说明；macOS 过渡期至少保留 GitHub Release 层 sha256 和更新 metadata 里的 sha512。
- 日志文件：`build-logs-vX.Y.Z.zip`，至少包含 install、typecheck、test、build、package、sign/notarize、asset-upload、smoke verification 的日志；macOS 无证书分支需要在日志中明确记录 signing/notarization skipped。
- 元数据文件：`release-manifest.json`、updater metadata、license notices、dependency attribution 或 SBOM。
- Release 页面正文包含用户可读 changelog、已知问题、升级提示和校验方式。

CI/CD 发布流程：

- GitHub Actions 在 macOS、Windows、Linux 上构建；不支持的平台要在 release notes 明确说明。
- 正式发布先创建 draft release，上传所有产物和日志，完成下载校验和冒烟后再 publish。
- 发布校验必须从 GitHub Release URL 重新下载产物，校验 sha256、平台签名状态、manifest 完整性、日志完整性和基础启动路径；macOS 验收按 unsigned/manual-install 策略校验，不要求证书签名和公证。
- 构建失败时保留可追溯日志；不能只有 Actions 页面短期日志，release 对应的长期日志包也要上传。
- 本地 release 脚本只做 dry-run 和复现辅助，正式产物以 CI 结果为准。

## UI 设计规范

新项目 UI 以 Vercel-like 产品界面为基准：克制、高密度、黑白中性色为主、边界清楚、交互精确、少装饰。它是面向开发者和本地 agent 工作流的工具界面，不是营销站、卡片堆叠首页或大面积视觉展示页。

### 视觉原则

- 以白、黑、灰和细边框建立层级，主色只用于明确动作、焦点、链接或状态。
- 避免大面积蓝紫渐变、彩色光斑、厚重投影、过度圆角、装饰性插画和营销式 hero。
- 信息密度优先，用户应能快速扫描项目、会话、工具调用、文件、diff、终端和设置状态。
- 页面 section 不做漂浮大卡片；重复列表项、modal、drawer、局部工具面板可以用 card。
- 圆角默认 `6px` 或 `8px`；窗口级容器或既有 shell 结构最多保留 `10px`。
- `letter-spacing` 固定为 `0`，不要用负字距模拟字体效果。
- 字重优先 `400`、`500`、`600`，不要用大量 `700+` 解决层级问题。

### 字体与排版

- 使用本地打包字体，不依赖外部 CDN。
- 主字体接 `--app-font-family`，代码字体接 `--app-code-font-family`。
- 首选 Geist Sans / Geist Mono 或等价自托管字体；中文、英文、数字、路径、代码块、terminal 都要验证 fallback。
- 代码、路径、ID、命令、时间戳、token 计数使用 monospace；长正文不要用 monospace。
- 工具面板、侧栏、设置页的标题要紧凑，不使用 hero 级字号。
- 长中文、长路径、长模型名、长工具名必须有 `min-width: 0`、截断或换行策略，不能撑破容器。

### Token 层级

- 全局语义变量使用 `--app-*`，放在全局样式入口。
- 第三方组件 token 只作为迁移期兼容层，不能成为新设计系统的源头。
- 桌面端语义变量使用 `--desktop-agent-*` 或新项目等价前缀，集中放在 token partial。
- Chat/Agent 复用壳层继续使用 `--chat-*` 或迁移后的共享 chat token。
- 组件私有变量只能定义在组件根 class 内，命名必须带组件前缀。
- 新增 token 必须同时考虑 light/dark，不允许只补 light 后靠浏览器或组件库默认值兜底。
- 除 token 定义、语法高亮、terminal ANSI palette 之外，不要在组件样式里散写硬编码颜色。

### 布局规范

- 首屏就是可用工作台，不做 landing page。
- 主布局采用全窗口工作台：侧栏、会话区、composer、右侧/底部 panel、terminal/diff/files 能稳定共存。
- 侧栏、右侧 panel、底部 terminal 使用稳定尺寸和 CSS 变量，拖拽时优先更新 CSS 变量，结束时再提交 React 状态。
- 固定格式元素要有稳定尺寸：工具栏、icon button、tabs、list row、status badge、token footer、diff header、terminal header。
- 不把卡片嵌套在卡片里，不用浮动卡片承载整个 page section。
- 窄屏下优先折叠侧栏和次级 panel，保留聊天/执行主流程，不让工具栏挤压到不可用。

### 组件规范

- 新项目不把 Ant Design 作为默认 UI 库。AntD 可以作为旧 DesktopAgent 迁移期的临时兼容来源，但不能成为新组件体系的基础。
- 优先建立自己的桌面 primitive 层：button、icon button、input、textarea、select/combobox、switch、checkbox、radio、tabs、segmented、tooltip、popover、dialog、drawer、command menu、resizable panel、list row、empty/loading/error state。
- 需要第三方能力时，优先选择 headless 或低样式侵入的 primitive 库；引入后必须用项目 token 和 UnoCSS/SCSS 重新落视觉，不保留第三方默认主题。
- 不在同一类控件上长期维护两套库；迁移按钮、输入、开关、下拉、dialog、tooltip 时要明确新旧边界。
- 图标按钮固定 `28px` 或 `32px`，必须有 `aria-label` 或 tooltip。
- 能用图标表达的工具动作优先用图标，例如刷新、保存、下载、展开、折叠、搜索、过滤、复制、删除。
- 不熟悉的图标动作必须有 tooltip，危险动作必须有二次确认或明确的危险态。

### 状态与交互

- hover、focus-visible、active、disabled、loading、selected、error 状态必须成套定义。
- focus-visible 必须清晰可见，不能只靠 hover 表示可交互。
- 动效控制在 `120ms-180ms`，仅用于 hover、focus、panel enter/exit、轻量状态变化。
- 必须尊重 `prefers-reduced-motion`。
- 空态、加载态、错误态使用同一套字体、间距和颜色 token，不单独发明视觉语言。
- destructive action 使用 danger token，不用高饱和红色大面积铺底。

### 关键界面规范

- Chat：消息区保持阅读宽度，工具调用默认折叠细节，token/usage 信息轻量展示。
- Composer：输入区稳定高度，附件、Skill、模型、审批状态不能挤压主输入；长文本不出现横向滚动。
- Sidebar：项目、会话、搜索、用户入口高密度排列；主标题强于时间戳和 meta。
- Capabilities：MCP 和 Skills 是同级能力；列表卡片紧凑，支持搜索、筛选、启停、详情、编辑。
- Files：文件树、搜索结果、路径行要可扫描；路径用 monospace，长路径截断但保留 tooltip。
- Diff/Review：header、文件路径、操作按钮使用统一 toolbar track；diff 内容分块渲染。
- Terminal：terminal body 使用 code font；header 操作紧凑；长输出必须分页、截断或虚拟化。
- Settings：偏工作台配置页，不做大卡片堆叠；分组清晰，主操作固定在容易发现的位置。

### 性能规范

- 长会话、工具日志、terminal 输出、文件树、diff 必须支持虚拟化、分页或分块渲染。
- streaming 文本不要每个 token 都触发全局重渲染；需要批处理和局部更新。
- runtime events 进入 renderer 后先归一成局部状态，不把整棵会话树频繁重建。
- 大面板切换时保持布局尺寸稳定，避免 hover、loading、计数变化导致 layout shift。
- 代码高亮、diff 计算、搜索索引、媒体缩略图生成不应阻塞 renderer 主线程。

### 样式组织

- 低风险结构样式优先用 UnoCSS：flex/grid、gap、padding、min-width、overflow、truncate、简单宽高。
- 第三方 primitive 内部结构覆盖、伪类、复杂 selector、响应式成组规则、动画、deep override 放 SCSS。
- 不用 UnoCSS arbitrary selector 覆盖第三方库内部类。
- 新样式默认 BEM 命名：`surface-block__element--modifier`。
- 桌面主界面 class 使用 `desktop-agent-*` 或新项目等价前缀。
- 新增规则必须进对应 partial，入口样式文件只保留 ordered imports。
- 如果同一组 utility 在 3 个以上位置重复，抽 Uno shortcut 或薄组件。

### 验收要求

- 页面整体读感必须是 Vercel-like 工具界面：中性、克制、紧凑、可扫描。
- 不出现营销式 hero、彩色装饰背景、厚重投影、过度圆角或一屏卡片堆叠。
- light/dark 都能正确显示 token、边框、hover、focus、selected、danger、disabled。
- 关键列表和面板在长中文、长路径、长模型名下不溢出。
- 所有 icon-only button 都有 tooltip 或 `aria-label`。
- 新增样式要通过对应样式检查；涉及样式入口、Uno config、全局 token、全局 CSS 时需要跑构建。

## 封装与复用原则

新项目必须有明确的封装意识。目标不是先堆出功能再回头整理，而是在第一版结构里就避免重复代码、重复样式、重复协议转换和重复工具执行逻辑。

### 总原则

- 同一类 UI、hook、runtime adapter、工具执行、存储访问逻辑出现第 2 次时要评估抽象，出现第 3 次前必须抽象。
- 抽象必须服务真实重复或复杂度，不为了“看起来架构化”制造空壳层。
- 组件、hook、方法、adapter 的边界要以业务语义命名，不用模糊的 `common`、`misc`、`utils2`。
- 复用优先顺序：已有 primitive/token -> 薄组件 -> hook -> service/helper -> 新依赖。
- 不允许一个功能在 renderer、main、runtime 各写一套相似的 schema 或 mapper；共享契约放 `contracts/`。

### UI 组件封装

- 先建立桌面 primitive 层，再组合业务组件。
- primitive 只负责行为和视觉基础，例如 `Button`、`IconButton`、`TextField`、`SelectField`、`SwitchRow`、`SegmentedTabs`、`Panel`、`PanelHeader`、`ListRow`、`EmptyState`、`LoadingState`、`ErrorState`、`ResizeHandle`。
- 业务组件只组合 primitive，不重复写按钮、输入框、面板 header、列表行 hover、空态、loading、错误态样式。
- Settings、Capabilities、Files、Terminal、Diff 里的 header/action row/filter/search/list item 要复用同一批布局组件。
- destructive action、confirm action、copy action、refresh action、save action 要复用统一 action primitive 和状态 token。
- 如果一个 className 串在 3 个以上位置重复，要抽 Uno shortcut 或薄组件。

### Hooks 封装

- 数据请求、SSE 订阅、runtime command、local storage、panel resize、keyboard shortcut、selection state、draft persistence 都要优先封装成 hook。
- hooks 不直接散落协议细节；协议 DTO 转换放 adapter/service。
- 常见 hook 方向：
  - `useRuntimeThreads`
  - `useRuntimeEvents`
  - `useRuntimeCommand`
  - `useProviderConfig`
  - `useWorkspaceProjects`
  - `useCapabilities`
  - `useSkills`
  - `useMcpServers`
  - `useResizablePanel`
  - `usePersistentDraft`
  - `useVirtualizedListState`
- hook 返回值保持稳定，避免让 renderer 因对象重建造成大范围重渲染。

### Runtime 方法封装

- `AgentLoop` 只编排流程，不直接写具体 provider、store、tool、skill、memory、media、computer-use 细节。
- Provider 差异只存在于 provider adapters，不让 OpenAI/Responses/Anthropic 分支散落到 loop、server 或 renderer。
- Tool 执行统一走 `ToolHost` / `ToolCatalog` / `ToolRunner`，不允许每类工具自己实现审批、超时、日志、错误格式、事件映射。
- Approval、user input、steering、cancel、resume 这些 gate 行为要封装成可复用 service，不能在每条路径里手写分支。
- Runtime event emit、usage 统计、artifact 保存、error normalization 都要有统一 helper。

### 存储与契约封装

- 所有 HTTP/SSE DTO、runtime event、tool call、skill、thread、usage schema 放 `contracts/`。
- 存储访问统一通过 `ThreadStore`、`SessionStore`、`SkillStore`、`MemoryStore`、`UsageStore` port，不在业务逻辑里直接读写文件路径。
- JSONL、SQLite、文件系统、OS credential storage 都是 adapter，不进入 loop。
- renderer 使用 `DesktopRuntimeClient`，不直接拼 runtime URL，也不直接操作 HTTP/SSE 细节。

### 测试复用

- Provider stream mock、runtime event fixture、tool call fixture、thread/session fixture、skill fixture 要集中维护。
- OpenAI compatible、Responses、Anthropic 的测试共用同一套 provider contract cases，再补各自特殊格式。
- ToolHost、Skill injection、approval resume、steering、compaction、media artifact replay 都要有可复用测试 helper。

### 注释规范

注释要服务维护者理解边界和风险，不用来复述代码做了什么。合理注释是必须的，但不能变成噪音。

必须写注释的场景：

- 协议转换：OpenAI compatible、Responses、Anthropic、MCP、Skill injection、runtime event schema 之间的非显然映射。
- 安全边界：API key 存储、shell approval、computer-use 权限、workspace scope、敏感环境变量过滤。
- 状态机：AgentLoop、approval resume、user-input gate、steering queue、cancel/resume、compaction。
- 性能策略：stream batching、虚拟列表、diff/log 分块、cache fingerprint、append-only log replay。
- 兼容迁移：从旧 `pc/` config/session/Skill/MCP 数据迁移时，解释保留字段和删除字段的原因。
- 设计取舍：为什么某处不用现成组件库、为什么某个 adapter 不能合并、为什么某个路径必须本地化。

不应该写注释的场景：

- 复述变量名、函数名、明显分支，例如“设置状态为 loading”。
- 给坏命名打补丁；如果只有靠注释才能理解变量含义，优先改名或拆函数。
- 大段历史说明；历史背景放设计文档或 ADR，代码里只留当前约束。

注释风格：

- 以短句为主，说明“为什么”和“边界”，少说“做了什么”。
- 注释靠近对应代码，不放到文件顶部堆积。
- TODO 必须带原因和退出条件，例如 `TODO(local-runtime): remove after old pc sessions migration lands`。
- 对安全/权限相关注释，必须写清楚禁止什么，而不是只写“注意安全”。

### 反模式

- 为每个页面单独写一套按钮、输入框、空态、loading、错误态。
- 在多个组件里复制同一段 className 或 SCSS selector。
- 在 renderer 里直接写 provider 协议分支。
- 在 loop 里直接读写本地文件或拼 HTTP response。
- 在每个工具里重复实现审批、超时、取消、错误格式。
- 先写多个相似实现，最后用注释说明“后面再抽”。
- 用注释解释重复代码、坏命名或临时绕路，但不做封装和清理。

## 推荐架构

```text
Renderer（React DesktopAgent-derived UI）
  |
  | window.setsunaDesktop.runtime.request(path, method, body)
  | window.setsunaDesktop.runtime.startSse(threadId, sinceSeq)
  v
Preload bridge
  |
  v
Electron main process
  RuntimeHost:
    - 配置读写
    - API key 存储桥
    - port/token 选择
    - runtime spawn/restart
    - health check
    - HTTP/SSE 转发
  |
  v
Local runtime service（Node/TypeScript）
  /health
  /v1/config
  /v1/models
  /v1/threads
  /v1/threads/:id
  /v1/threads/:id/turns
  /v1/threads/:id/events
  /v1/threads/:id/fork
  /v1/threads/:id/compact
  /v1/approvals/:id
  /v1/user-inputs/:id
  /v1/skills
  /v1/skills/:id
  /v1/skill-assets
  /v1/workspace/status
  /v1/usage
```

这部分的关键点：GUI 只消费一个本地 runtime 协议；agent loop 由 runtime 拥有；桌面壳只管理进程、配置和生命周期。

## Runtime 模块

Runtime 内部采用典型 ports & adapters 分层。这里可以参考外部项目里成熟的单 runtime 组织方式，但命名和能力边界以本项目为准。

核心原则：

- `contracts/` 定义 HTTP/SSE DTO、事件、配置、tool/skill/model schema，是 renderer、main、runtime 的共享契约。
- `ports/` 定义 runtime 核心依赖的抽象接口，例如 `ModelClient`、`ToolHost`、`ThreadStore`、`SkillRegistry`、`MemoryStore`。
- `adapters/` 承接所有具体实现，例如 OpenAI/Anthropic provider、本地文件工具、shell、MCP、Skill loader、media generation、computer-use、JSONL/SQLite store。
- `loop/` 是 agent loop 核心，`AgentLoop` 只依赖 ports，不直接 import 具体 adapter。
- `cache/` 负责稳定前缀、tool catalog fingerprint、LRU/TTL、usage/cache telemetry，避免每轮上下文抖动。
- `server/` 暴露本地 HTTP/SSE API，做 auth、routing、SSE fanout 和 runtime factory。

建议的新 runtime 包结构：

```text
desktop-runtime/
  contracts/
    http.ts
    events.ts
    config.ts
    provider.ts
    tools.ts
    skills.ts
    memory.ts
    usage.ts
  ports/
    model-client.ts
    tool-host.ts
    skill-registry.ts
    memory-store.ts
    media-generator.ts
    computer-use-host.ts
    thread-store.ts
    session-store.ts
    approval-gate.ts
    user-input-gate.ts
    event-bus.ts
    workspace-inspector.ts
    clock.ts
    id-generator.ts
  adapters/
    model/
      openai-chat.ts
      openai-responses.ts
      anthropic-messages.ts
      multi-provider-model-client.ts
    tool/
      local-file-tool-host.ts
      shell-tool-host.ts
      mcp-tool-host.ts
      skill-tool-host.ts
      memory-tool-host.ts
      media-generation-tool-host.ts
      computer-use-tool-host.ts
      tool-catalog.ts
    skill/
      builtin-skills.ts
      file-skill-registry.ts
      skill-loader.ts
      skill-injection.ts
    store/
      jsonl-thread-store.ts
      file-session-store.ts
      sqlite-index-store.ts
      memory-store.ts
      skill-store.ts
      usage-store.ts
    workspace/
      project-store.ts
      workspace-inspector.ts
      file-index.ts
  server/
    router.ts
    sse.ts
    auth.ts
    runtime-factory.ts
  loop/
    agent-loop.ts
    turn-runner.ts
    tool-runner.ts
    steering-queue.ts
    context-compactor.ts
    inflight-registry.ts
    approval-runner.ts
    user-input-runner.ts
    history-healing.ts
  cache/
    immutable-prefix.ts
    tool-catalog-fingerprint.ts
    cache-diagnostics.ts
    lru.ts
    ttl-lru.ts
```

现有 `runtime-core.mjs` 可以作为行为参考，但不建议在新项目里继续保留一个巨大的 orchestration 文件。重写时应该尽早拆出 contract、provider、tool host、loop、persistence 这些边界。

`AgentLoop` 是 runtime 的核心：它负责组装系统提示词、Skill 上下文、历史消息、工具定义和模型请求；接收模型流；调度工具调用；处理 approval/user-input gate；写入 append-only events；触发 compaction；产出 renderer 可消费的 runtime events。

工具层应统一挂在 `ToolHost` / `ToolCatalog` 后面，至少覆盖：

- 本地文件：read、write、patch、search、list、diff、undo/reapply。
- Shell：一次性命令、持久 shell、输出截断、敏感环境变量过滤、审批策略。
- MCP：stdio、streamable HTTP、workspace/global config、tool allow/deny、timeout。
- Skills：内置 Skill、用户 Skill、引用文件、上下文注入。
- Memory：remember、recall、project/global memory、memory citation。
- Media generation：图片/音乐等生成工具、附件落盘、消息事件映射。
- Computer-use：截图、点击、输入、滚动等桌面控制能力；默认必须强审批和明确作用域。

Skill 不应该作为纯 UI 功能保留在 renderer 里。Renderer 只负责列出、选择、创建和编辑；runtime 负责加载内置/用户 Skill、解析 `SKILL.md`、读取引用文件、生成受控的 `skill_injections`，并在每次 turn、steer、approval resume 时把 Skill 上下文稳定注入模型消息。

## Provider 合约

所有 provider 应该映射到一个内部模型接口：

```ts
type ModelProviderKind = 'openai-compatible' | 'openai-responses' | 'anthropic';

type ModelRequest = {
  model: string;
  messages: RuntimeMessage[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: RuntimeToolChoice;
  maxOutputTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
};

type ModelStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_delta'; call: RuntimeToolCallDelta }
  | { type: 'usage'; usage: RuntimeUsage }
  | { type: 'done'; finishReason?: string };
```

Provider 差异必须隔离：

- OpenAI compatible 构造 `POST {baseUrl}/chat/completions`。
- OpenAI Responses 构造 `POST {baseUrl}/responses`。
- Anthropic 构造 `POST {baseUrl}/v1/messages`，除非用户直接传入完整 messages endpoint。
- Responses 和 Anthropic 的 tool call 必须先归一化，再进入 agent loop history。
- Provider API key 保存后不能再明文暴露给 renderer。

## 存储策略

推荐存储策略：

- 配置：本地 JSON，加 OS credential storage 保存 API key。
- Threads：append-only JSONL event log 作为 canonical history。
- Index：SQLite 或轻量 JSON index，用于列表、搜索、usage。
- Session snapshots：从 event log 派生，用于快速 UI 加载。
- Memory：project-scoped 和 global local memory，可放文件或 SQLite 表。
- Tool artifacts：保存 workspace-scoped 路径和 event 引用，不保存成不透明后端 blob。

第一版可以先用 JSON-only store，但 store interface 要按未来 JSONL + SQLite 的形状设计，避免后面重写。

## 前端边界

新增 local runtime adapter，让 DesktopAgent 消费 adapter，而不是后端 `agentApi`。

Renderer-facing adapter：

```ts
type DesktopRuntimeClient = {
  listThreads(query: ThreadQuery): Promise<ThreadList>;
  getThread(threadId: string): Promise<Thread>;
  createThread(input: CreateThreadInput): Promise<Thread>;
  updateThread(threadId: string, patch: ThreadPatch): Promise<Thread>;
  sendTurn(threadId: string, input: SendTurnInput): Promise<void>;
  subscribeEvents(threadId: string, sinceSeq?: number, onEvent: (event: RuntimeEvent) => void): () => void;
  cancelTurn(threadId: string, turnId: string): Promise<void>;
  steerTurn(threadId: string, turnId: string, input: string): Promise<void>;
  compactThread(threadId: string): Promise<CompactResult>;
  answerApproval(approvalId: string, decision: ApprovalDecision): Promise<void>;
  answerUserInput(inputId: string, answers: unknown): Promise<void>;
};
```

Renderer 不应该知道当前 provider 是 OpenAI-compatible、Responses 还是 Anthropic。Renderer 只接收 runtime config 暴露的能力，例如是否支持 vision、reasoning、tool call、max context hints。

## 迁移矩阵

| 范围 | 当前来源 | 新动作 |
| --- | --- | --- |
| Tauri window shell | `pc/src/src/window.rs`, `security.rs` | 替换为 Electron 本地 renderer window 和 preload bridge。 |
| Runtime 生命周期 | `pc/src/src/runtime.rs` | 重建为 Electron `RuntimeHost`；保留 lifecycle 思路，不保留 Rust/Tauri plumbing。 |
| 模型 provider 配置 | `pc/src/src/llm_config.rs`, settings UI | 保留行为，把 config contract 移到 runtime/main；API key 安全存储。 |
| OpenAI/Responses/Anthropic streaming | `pc/src/sidecars/local-llm-stream.mjs` | 抽成 provider adapters，并补测试。 |
| 后端 agent stream | `agent-stream.mjs`, `runtime-core.mjs` fallback | 删除。Runtime 永远调用本地 provider adapters。 |
| 本地工具 | `pc/src/runtime/local-tools.mjs` | 迁入 runtime `tools/local-tool-host`。 |
| MCP | `mcp_config.rs`, `mcp-runtime.mjs`, `mcp-client.mjs` | 配置迁到 main/runtime；保留 global 和 workspace config 支持。 |
| Skills | `DesktopCapabilitiesPanel.tsx`, `skillApi.ts`, `runtime-core.mjs`, `pc/skills/*` | 删除后端 Skill API 依赖；迁为本地 Skill registry、Skill store、内置 Skill loader 和 runtime injection pipeline。 |
| Media generation | `apps/llm_server/service/media_tools.py`, `media_generation.py` | 迁为 runtime media generation adapter；生成结果落本地 artifact store，并通过 runtime events 映射回 UI。 |
| Computer-use | 新增 runtime adapter | 作为高风险工具接入 `ToolHost`；默认强审批、限制作用域，并保留截图/点击/输入/滚动事件审计。 |
| 本地会话 | `local_sessions.rs` | 替换为 runtime thread/session store；迁移旧本地会话。 |
| 云端会话/项目 | DesktopAgent 里的 `agentApi` 路径 | 删除，或转换为本地 project/thread records。 |
| Passive memory | `runtime-core.mjs`, `local-tools.mjs`, `local_sessions.rs` | 保留本地 memory；删除 cloud session scanning。 |
| Review/diff | `pc/src/src/review.rs`, frontend panels | 保留用户可见 UI；通过 runtime/main adapter 路由。 |
| Terminal | `pc/src/src/terminal.rs`, xterm UI | 如果产品范围包含 terminal 则保留；trust model 脱离远端 origin。 |
| Settings | `ChatUserSettingsModal.tsx` | 拆出 desktop-local settings，去掉 cloud account/API-key sections。 |

## 分阶段计划

### Phase 0：决策冻结

- 已确认：“不再 webview”指不再加载远端 WebView/Tauri WebView；Electron 本地 React renderer 可以接受。
- 冻结 UI 规范：Vercel-like、单本地 runtime 工作台、token 层级、布局密度、组件 primitive、light/dark 验收标准。
- 冻结 UI 库策略：新项目不默认使用 Ant Design；先定义自有 primitive 层，再按需引入 headless primitive 依赖。
- 冻结封装策略：UI primitive、hooks、runtime ports/adapters、storage ports、test fixtures 必须先定边界。
- 已确认：新项目是独立开源 Git 仓库，不作为当前 repo 子目录；继续确认仓库名、包名、license、release owner 和 GitHub Actions 权限。
- 已确认：macOS 暂时沿用无证书、无公证、manual-install 更新体系；证书签名/公证后续单独立项。
- 决定 API key 的安全存储方案。
- 决定第一版 store：先 JSON-only，还是一开始就 JSONL + SQLite。

### Phase 1：Runtime Skeleton

- 创建 Electron app skeleton。
- 创建 preload bridge。
- 创建 runtime host，包含 spawn、port、token、health check、restart。
- 创建 Node runtime server，先支持 `/health`、`/v1/config`、`/v1/threads`。
- 增加本地 config read/write 和一个 test provider。
- 建立 `contracts/`、`ports/`、`adapters/`、`loop/`、`server/` 的基础目录和测试 fixture，不把代码先堆到一个入口文件里。

### Phase 2：Model Loop

- 从 `local-llm-stream.mjs` 抽出 provider adapters。
- 定义 canonical runtime event stream。
- 实现 create thread、send turn、stream events、cancel turn。
- 本地持久化 thread events。
- 先支持 OpenAI compatible，再补 Responses，最后补 Anthropic。

### Phase 3：DesktopAgent UI Port

- 迁移 DesktopAgent renderer shell。
- 先抽桌面 primitive 层：button、icon button、panel、list item、tabs、segmented、empty/loading/error、resizable handle。
- 建立桌面 token partial，并接入全局字体、primitive token、light/dark overrides。
- 如果从现有 DesktopAgent 迁移 AntD 组件，只作为过渡层；新功能默认使用自有 primitive 或 headless primitive。
- 用 `DesktopRuntimeClient` 替换 `agentApi` 调用。
- 移除 auth/session-key/client-source 假设。
- 让本地 sessions/projects 成为唯一状态源。
- 增加 provider base URL、API key、model、storage path、memory、approval policy 设置。
- 把能力面板里的 Skill 列表、创建、编辑、选择改成本地 runtime API，不再请求 `/api/v1/llm/skills`。

### Phase 4：Tools And Workspace

- 迁移本地 file/search/shell tools。
- 迁移 approval gate 和 user-input gate。
- 迁移 MCP config/runtime。
- 迁移 Skill registry、内置 Skill、用户 Skill、Skill 引用文件和 injection pipeline。
- 接入 media generation adapter，并定义本地 artifact 存储和 UI 事件格式。
- 预留或接入 computer-use adapter；默认放在强审批策略下，不作为静默工具开放。
- 恢复 file tree、diff/review、terminal、undo/reapply。
- 增加 workspace status endpoint。

### Phase 5：Memory、Compaction、Usage

- 迁移本地 memory store。
- 用本地 project/thread memory lookup 替换 cloud passive memory。
- 实现本地 compaction。
- 持久化 usage，并展示 usage 汇总。
- 增加旧本地会话迁移。

### Phase 6：GitHub Release、Packaging And Verification

- 增加 GitHub Actions 多平台构建、signing、updater、crash log、diagnostics。
- 定义 release manifest、checksums、签名文件、license notices 和日志包格式。
- 把安装包、压缩包、校验和/签名、manifest、updater metadata、构建日志、测试日志、打包日志上传到 GitHub Release。
- macOS 发布链路先沿用 unsigned/manual-install：生成 DMG/ZIP、`latest-mac.yml`、sha256/sha512、manifest 标记和日志，不接入 Apple Developer ID signing/notarization。
- Release notes 从 git history、PR 或 changeset 生成，并随 draft release 一起审查。
- 增加 e2e smoke：启动、保存 provider、创建 thread、流式响应、运行只读工具、审批、取消、恢复。
- 增加从旧 `pc` 本地 config/session layout 迁移的测试。
- 发布后从 GitHub Release URL 重新下载产物，校验 sha256、平台签名状态、manifest、日志包和基础启动路径；macOS 额外校验 `latest-mac.yml` 与 manual-install 下载路径。

## 风险清单

| 风险 | 严重度 | 缓解方式 |
| --- | --- | --- |
| Electron 仍然使用 Chromium，chat/log/diff 渲染不当时仍会卡顿。 | Medium | Agent loop 不进 renderer；使用虚拟列表、stream 批处理、diff/log 分块、收窄 React state 更新。 |
| 现有 `runtime-core.mjs` 很大且横跨多个职责。 | High | 通过接口抽行为，不要整文件复制。 |
| Provider stream 格式差异很大。 | High | 严格隔离 provider adapter，并统一 canonical stream events。 |
| API key 可能泄漏到 renderer 或本地 JSON。 | High | 密钥只在 main/runtime 持有；renderer 只看到 masked state。 |
| DesktopAgent 依赖共享 cloud Agent hooks。 | Medium | 新建 local-only hooks，或把 session/message 操作改成可注入。 |
| 初期赶功能导致 UI、hooks、provider、tool 执行逻辑重复，后续难以收敛。 | High | 阶段验收加入重复代码审查；同类实现第 3 次出现前必须抽 primitive、hook、service、port 或 adapter。 |
| Skill 现在一半在后端 API，一半在 runtime injection，迁移时容易只搬 UI 漏掉模型上下文。 | High | 把 Skill registry、Skill store、Skill loader、Skill injection 列为 runtime 一级模块，并补 turn/steer/approval resume 测试。 |
| Media generation 从后端迁到本地后，附件路径、缩略图、历史回放可能断裂。 | Medium | 统一 artifact store 和 runtime event schema；生成结果只引用本地可恢复路径。 |
| Computer-use 能操作桌面，权限边界比普通 shell 更敏感。 | High | 默认禁用或强审批；每次操作必须有可审计事件、清晰作用域和用户可取消路径。 |
| 独立开源仓库如果仍依赖当前私有路径、私有后端或内部对象存储，外部贡献者无法构建。 | High | fresh clone CI 验证；禁止 monorepo 相对路径和私有下载中心作为必需依赖。 |
| GitHub Release 只上传安装包、不上传构建和打包日志，失败后难以追溯。 | Medium | 每个 release 强制上传 `build-logs-vX.Y.Z.zip`，并在 manifest 中记录日志文件和 workflow run。 |
| GitHub Release 与镜像下载站或 updater metadata 漂移。 | Medium | GitHub Release 是 canonical source；镜像和 updater metadata 从 `release-manifest.json` 生成并回校验。 |
| macOS 暂时无证书/无公证，用户安装时可能遇到 Gatekeeper 提示。 | Medium | Release notes 明确安装方式；manifest 标注 unsigned/manual-install；后续证书签名和公证作为单独阶段迁移。 |
| 把 macOS 无证书策略误当作所有平台都不需要签名或校验。 | Medium | 平台级 release manifest 必须分别记录 signing/notarization/installMode；CI 校验不同平台的发布契约。 |
| 本地存储随着 sessions 增长导致列表/搜索变慢。 | Medium | 即使 v1 先 JSON-only，也按 JSONL + SQLite 的接口形状设计。 |
| MCP 和 shell tools 可能执行高风险命令。 | High | 审批策略和 workspace scope 必须由 runtime 拥有。 |
| 沿用现有 PC release flow 可能把内部上传、私有下载中心和旧 changelog 结构带入新项目。 | Medium | 新项目 release flow 从 GitHub Actions/GitHub Releases 重新定义；当前 `pc/` 只作为迁移参考。 |

## 验收标准

架构进入可开工状态时，需要满足：

- “不再 webview”的产品口径明确。当前决策：接受 Electron 本地 React renderer；不接受远端 WebView/后端托管桌面 UI。
- 新 app 的 shell/runtime 技术栈已确定。
- UI 规范已冻结，并明确 token、primitive、布局、状态、性能和 light/dark 验收标准。
- UI 库策略已冻结：Ant Design 不是默认依赖；迁移期如果临时保留 AntD，需要有退出边界。
- 封装策略已冻结，并明确 UI primitive、hooks、runtime ports/adapters、store ports、test fixtures 的边界。
- 注释规范已冻结，并明确协议转换、安全边界、状态机、性能策略、兼容迁移和设计取舍需要合理注释。
- 开源仓库边界已冻结：新项目是独立 Git 仓库，能从公开 fresh clone 构建和运行。
- 发布规范已冻结：GitHub Releases 是 canonical release source，构建产物、日志、校验和、manifest 和 release notes 都随 release 上传。
- macOS 发布例外已冻结：v1 沿用 unsigned/manual-install 更新体系，不把 Apple Developer ID signing/notarization 作为阻断项。
- Runtime API contract 已确认。
- Provider config schema 已确认。
- Storage strategy 已确认。
- 迁移矩阵每一行都有 owner 或执行计划。

第一版可用实现完成时，需要满足：

- App 启动时不加载任何远端 app URL。
- 用户可以保存一个 provider，包括 base URL、API key、model。
- 用户可以创建本地 thread，并得到流式响应。
- 会话重启后仍然存在。
- Renderer 不调用 `/api/v1/llm/*`。
- Runtime 不调用 `/api/v1/llm/agent/stream`。
- Skill 列表、创建、编辑、选择和注入都走本地 runtime；renderer 不调用 `/api/v1/llm/skills`。
- 内置 `pc/skills/presentation-mcp/SKILL.md` 能作为内置 Skill 被发现、选择并注入模型上下文。
- Media generation 工具能生成本地 artifact，并在会话重启后正确回放。
- Computer-use 若启用，必须经过强审批，并记录可审计事件。
- OpenAI compatible、Responses、Anthropic 都至少有一个 mocked stream test。
- GitHub Actions 能从 fresh clone 完成 install、typecheck、test、build、package 和 release dry-run。
- 每个正式 GitHub Release 都包含安装包/压缩包、`SHA256SUMS`、`release-manifest.json`、日志包和用户可读 release notes。
- 发布验收从 GitHub Release URL 下载产物，并校验 sha256、平台签名状态、manifest、日志包完整性和基础启动路径。
- macOS release manifest 明确标注 unsigned/manual-install/notarization skipped，Release notes 包含无证书安装提示，`latest-mac.yml` 与 DMG 下载路径可用。
- 基础本地 app 启动不需要私有后端、内部对象存储、当前 repo 路径或手工复制资产。
- 本地项目选择可用。
- 只读文件工具可用。
- 破坏性工具和本地 shell 工具按策略要求审批。
- UI 通过 Vercel-like 视觉验收：中性克制、高密度、细边框、稳定布局、完整 hover/focus/disabled/loading 状态。
- 长会话、长日志、长 diff、长路径、长模型名不造成明显溢出或全局重排。
- 没有明显重复实现：按钮/输入/面板/列表/空态、runtime command hooks、provider mapper、tool runner、store access 都有共享封装。
- 关键复杂逻辑有合理注释：协议转换、安全边界、状态机、性能策略、兼容迁移和设计取舍都有短而准的说明；没有用注释掩盖坏命名或重复代码。

## 已确认决策

关键产品决策已经确认：

“不再 webview”指不再加载远端 WebView/Tauri external URL，也不再使用后端托管的桌面 UI。Electron 本地 React renderer 可以接受。

这个方向能复用当前 React DesktopAgent UI，同时移除两个真正的问题：后端 API 依赖和远端 WebView 加载。
