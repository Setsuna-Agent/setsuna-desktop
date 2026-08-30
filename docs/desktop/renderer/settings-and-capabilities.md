# Settings 与 Capabilities

源码：

- `apps/desktop/renderer/src/features/settings/`
- `apps/desktop/renderer/src/features/capabilities/`（宿主壳与共享布局样式）
- `packages/features/{plugin-management,skills,mcp}/src/renderer/`（能力页面与状态 owner）
- `packages/renderer-contracts/src/{settings,capabilities}.ts`（Slot 与刷新 contract）

Settings 管理用户与 runtime 配置；Capabilities 管理可安装或可调用的扩展能力。两者共享 runtime state，但承担不同产品语义。

## Settings

### 页面编排

`SettingsPage.tsx` 负责宿主 section 导航和数据/回调分发，并消费 `renderer.settings.page` keyed Slot 与当前 page 拥有的 `renderer.settings.page.extensions` Slot。页面 metadata 和 renderer 来自同一 contribution，导航不再维护第二份 Feature catalog。具体宿主内容位于：

- `sections/`
- `data-root/`
- `components/`
- `styles/`

页面根不应包含 provider normalize、calendar 聚合或数据根错误翻译等纯逻辑。

### Sections

| 文件 | 内容 |
| --- | --- |
| `GeneralSettings.tsx` | 主题、字体、缩放、外观与 Windows 关闭窗口行为 |
| `PersonalizationSettings.tsx` | Global prompt、Setsuna style |
| `RuntimeSettings.tsx` | Approval、permission、developer features、runtime 行为 |
| `TaskModelSettings.tsx` | 标题、代码审查、审批审查与上下文压缩等宿主任务的模型选择 |
| `ArchivedThreadsSettings.tsx` | 归档线程管理 |

Memory 是独立 renderer Feature，但不单独占用设置导航。它在 setup 中通过 `registerSettingsPageExtension(context.ui, ...)` 注册两个 keyed extension，把启用/生成/外部上下文策略和记忆管理入口追加到“个性化”，把抽取/整理模型追加到“专用模型”；preview、delete、clear 和保存状态仍由 Feature 自己持有，`SettingsPage` 不接收任何 Memory 专用 prop。标准 Section/Group/Row、Switch、Select 和 Button 由宿主通过 Slot props 中的 `ui` 注入，因此业务所有权独立不等于信息架构或视觉系统独立。

Updater 也是独立 renderer Feature。它通过 Settings extension Slot 填充宿主保留的“关于”分区，并由 `UpdaterRendererStateService` 单点订阅 preload 状态；设置页和 App controller 不传递 updater 专用 props。顶栏铃铛由 Feature 自己注册到 `renderer.shell.topbar.action`，状态、动作、文案和样式均由 `packages/features/updater/src/renderer` 持有。

WebDAV Sync 也是独立 renderer Feature，并通过 `registerSettingsPage(context.ui, ...)` 形成完整“同步”页面。它用 `navigationGroupId` 声明归入宿主“模型与服务”分组；没有已知宿主归属的 contribution 才进入独立“功能”分组。连接、自动备份、数据类别、当前快照、还原检查、文案和 scoped CSS 都位于 `packages/features/webdav-sync/src/renderer`；宿主设置页只消费 Slot descriptor，不读取 WebDAV 状态，也不持有 bridge 方法。

Network Proxy 同样通过 Settings page Slot 提供完整“代理服务器”页面，状态订阅、编辑动作、文案与 scoped CSS 位于 `packages/features/network-proxy/src/renderer`。Model Provider Feature 通过宿主 capability 读取代理服务器公开投影；宿主设置页不直接调用代理 bridge，也不拥有代理 section。preload 子桥类型由 Feature contract 贡献，renderer 不接触端口、凭据或本地文件。

`shared/ui/SettingsViewUi.tsx` 是 Settings View 的宿主设计系统入口。它复用现有 `primitives.tsx` 和设置页布局样式，统一 focus、disabled、danger/primary、密度与可访问性；Feature 只为预览卡片、业务结果等特有 presentation 写 scoped CSS，并使用 `tokens.css` 公开的 `--sd-*` 语义 token。完整页面默认由宿主渲染标题；需要把 Feature 状态动作放进标题栏时，contribution 声明 `pageHeading: 'view'`，再使用注入的 `ui.PageHeading`，不能用正文定位或负 margin 模拟标题 action。

### Provider settings

模型服务由 `packages/features/model-provider/` 独立拥有，并通过 Settings page Slot 挂载到宿主设置页。renderer service 负责读取、暂存和串行保存，宿主只注入 Settings UI、品牌图标和网络代理能力。

Feature 管理：

- Pi 内置厂商/方案、API key 与模型目录。
- 自定义兼容服务的协议、base URL 和模型同步。
- Thinking effort、max output、vision 等能力。
- Provider/model 品牌图标。
- 模型批量选择与删除。

规则：

- API key 留空不能覆盖已保存 secret。
- Renderer 只看到 `apiKeySet`/preview。
- 厂商或方案变更必须确认并清除旧凭据和不兼容模型；显式选择自定义服务不能被旧配置迁移再次识别成预设厂商。
- Provider capabilities 来自 Pi catalog 或 discovery，不在 UI 写死厂商私有 payload。
- Base URL normalize 和 provider validation 最终仍由 runtime store 执行。
- 模型列表没有厂商级“默认模型”概念；聊天和宿主任务各自保存 provider/model 引用。
- 同步结果必须确认后应用，并在连接配置变化时丢弃旧请求结果。

### 访问模式与审批审查

聊天输入区的三个访问模式会原子保存审批策略、审批主体和权限配置：

- “请求批准”：`on-request + user + workspace-write`，工作区内的读取、编辑和常规命令无需审批；越过沙箱边界时由用户决定。
- “替我审批”：`on-request + automatic + workspace-write`，只把 policy 检出的交互审批交给独立审查模型。
- “完全访问”：`full + user + danger-full-access`，不运行 OS sandbox 或审批审查。对强制删除命令的
  处理与 Codex 的 `DangerFullAccess + Never` 一致：命中窄范围危险命令规则时直接拒绝而不是弹窗，
  其余命令不受风险提示规则限制。Windows Shell 即使处于完全访问，也会将 `TEMP` / `TMP` / `TMPDIR` 指向系统临时
  目录下的独立会话目录，并在进程结束后清理；临时文件不应回落到当前项目工作区。

Approval Review Feature 通过目标为 `taskModels` 的 Settings extension Slot 贡献独立 provider/model 选择；值保存在 Feature settings，未配置或引用失效时跟随当前对话模型。自动审查的等待、允许、拒绝和人工降级状态仍由 Core tool run 投影展示，renderer 不持有未截断工具参数，也不能回答标记为 `automatic` 的审批请求。

### Data root

`data-root/` 展示 main 的迁移/恢复状态：

- `DataLocationSettings`
- `DataMigrationProgressPage`
- `DataRootRecoveryPage`
- `DataMigrationCleanupPage`
- `RetainedDataRootBackupList`
- Issue/format/message helpers

数据根不通过 `saveConfig()` 热更新；所有动作调用 `window.setsunaDesktop.dataRoot` 并预期 relaunch。详细状态机见 [main 数据根](../main/data-root.md)。

### Usage

Usage 是独立纵向 Feature，源码位于 `packages/features/usage/`。renderer setup 通过
Usage 的 Renderer Feature 注册完整的“用量分析” Settings page entry，并归入宿主“模型与服务”导航组。
`SettingsPage` 只渲染当前 Slot winner，不接收 usage 数据或 query callback。
Usage 声明 view-owned page heading，把时段筛选作为 `ui.PageHeading` 的 action 渲染在标题右侧。

Feature 自己负责：

- Summary metrics。
- Provider/model breakdown。
- Activity calendar。
- Recent calls。
- Provider/model branding 的语义输入；宿主通过 `usage.renderer-host` 注入实际图标与 Tooltip。
- 全部时间、当天、滚动 24h/7d/30d 与分钟级自定义时间范围。
- 最近调用明细按 10 条分页，翻页通过 usage query 的 `limit`/`offset` 按需读取。

时间范围通过 Feature contract 中的 `RuntimeUsageQuery.from/to` 传给 runtime，按 `[from, to)` 过滤后再统一聚合；
renderer 只负责范围选择与展示，不重新计算计费真源。年度 Activity calendar 始终使用未筛选的
全局过去一年数据，避免短区间筛选把长期趋势图压缩成少量格子。

会话概览中的 Token/调用数也由 Usage Feature 的线程 controller 投影。它以持久化记录为基线，
在 turn 运行或结算交接期间只补齐 thread 事件中的实时 token count，不再经过 App 级 `threadUsage` prop 链。
宿主在确有用量的 turn 结算后发送 Feature 失效通知；已打开的全部时间统计和对应线程投影会重读，controller 在最后一个订阅者离开时释放。

### Workspace dependencies

Workspace Dependencies 是独立纵向 Feature，源码位于 `packages/features/workspace-dependencies/`。renderer setup 通过 Settings extension Slot 把设置追加到“运行时”区域；设置视图、controller、文案和 scoped CSS 都由 Feature 自己持有，宿主页不读取包源或工具链状态。

Windows Sandbox 同样由 `packages/features/windows-sandbox/` 纵向拥有。renderer setup 仅在 Windows 返回“运行时”设置扩展；状态 controller、安装/修复/卸载动作、文案和 scoped CSS 均留在 Feature 内，宿主 Runtime Settings 不再读取平台或 sandbox bridge。

Feature 的 typed operations 读取 Node.js/Python/uv 状态、更新 npm/Python 包源，并执行诊断或修复。修复会复用健康的本机或托管工具，只补齐缺失、损坏或版本过低的环境；实际下载、校验和安装在 Feature runtime，不在 renderer 执行进程。旧 `config.json.desktopSettings` 包源字段只作为一次性迁移输入，迁移成功后退役，不再通过统一 `DesktopRuntimeClient` 或根 Config 修改。

## Capabilities

`CapabilitiesShell.tsx` 是薄宿主：它只从 `renderer.settings.page` keyed Slot 的 metadata 生成一级导航，在 topbar 或 Windows 页内渲染标签，并把当前 key 对应的页面 contribution 挂到 outlet。它不读取 Plugin、Skill、MCP snapshot，也不执行业务 mutation。

三个一级页面由各自 Renderer Feature 在 setup 中注册，`navigationGroupId = capabilities.catalog` 只表达共同的信息架构：

- `packages/features/plugin-management/src/renderer/PluginCapabilitiesPage.tsx`
- `packages/features/skills/src/renderer/SkillsCapabilitiesPage.tsx`
- `packages/features/mcp/src/renderer/McpCapabilitiesPage.tsx`

宿主只通过 Slot props 提供设计系统、当前 workspace、创建对话入口和选中的 Plugin ID。业务页面直接消费自己 setup 创建的 service；缺失 contribution 时由 composition root 的 `FeatureRecoveryShell` 提供诊断与恢复入口。

Hook 不再作为一级目录或独立表单暴露；它是 Plugin Bundle 内的一项能力，由插件创建、导入和安装流程统一管理。

### Plugin market

Plugin 管理的跨层所有权位于 `packages/features/plugin-management/`：contracts 声明聚合 snapshot、Hook projection 与安装、更新、卸载、详情、扩展信任、Hook 状态 typed operations；runtime 只通过 Plugin Store、Marketplace、Extension Manager 和 `RuntimeHookManagement` 窄 host 能力实现；renderer service 持有 Plugin/Hook snapshot、并发 refresh 与 mutation 后收敛。`PluginCapabilitiesPage`、`PluginDetail`、`PluginItemDialog` 和展示 helper 同样位于 Feature 包内，宿主不再保存或适配 Plugin/Hook 状态。

默认市场来自随应用打包的 `plugins/`，renderer 只接收无路径摘要。市场首页分别展示市场目录和不在目录内的本地安装项；卡片直接表达安装、更新和打开状态。详情页展示声明的 Tool/Skill/MCP/Hook/resource 元数据，并负责 install/update/uninstall 动作。

Capabilities 的一级标签默认通过 `AppRouteTopbarPortal` 挂载到 `ShellFrame` 的 route topbar slot；Windows 下改为放在能力页内容顶部。各 Feature page 自己持有标题、搜索、刷新、创建/导入和详情返回动作，但复用宿主注入的 controls 与共享能力页布局样式。

页面标题栏分别提供“用对话创建插件”和“导入本地插件”；不属于默认市场的已安装 Plugin 在本地来源分区单独展示。

图片生成和视觉识别第一方 Plugin 的配置不在 Plugin Management 页面中硬编码。各自的 renderer Feature 在 setup 时静态返回对应 Plugin 详情的设置与测试视图：

- `packages/features/image-generation/src/renderer/`
- `packages/features/vision-recognition/src/renderer/`

两个插件都默认不安装，只有用户从市场安装后详情页才显示 contribution。图片生成 Feature 维护自己的 Images API 服务配置；视觉识别 Feature 只列出“模型服务”中已启用且标记为支持图片的模型，在自己的 `model-selection` document 保存 provider/model 引用，并复用 provider 的服务地址、API key、协议和代理设置。组件只调用各自 typed Feature client，不读取根 Config，也不调用统一 `DesktopRuntimeClient` 的业务方法；输入框、文本域、选择器和按钮统一使用宿主注入的 `SettingsViewUi`，测试结果和图片预览仍由 Feature 自己布局。

Bundle 规则见 [Plugin Bundle](../../extensions/plugins/bundles.md)。

### MCP

`packages/features/mcp/src/renderer/McpCapabilitiesPage.tsx` 管理目录、详情和编辑状态：

- `stdio` / `streamable_http` transport。
- Command/args 或 URL。
- Env/header 的 key/value 编辑。
- Enabled、required、approval policy。
- Allowed/disabled tools。
- Fetch tools、OAuth login/logout。

保存时保持结构化字段，不把 command/args 拼成 shell 文本。List/status 不显示 secret 值。

MCP 的 renderer 状态与命令由 `packages/features/mcp/src/renderer` 持有。Feature service 通过 typed operations 管理 server snapshot、工具发现、保存、启停、删除和 OAuth 登录/登出，并用统一请求序列阻止迟到 refresh 回退 mutation 结果；旧 `/v1/mcp/*` REST 与 App Server 仍作为兼容 adapter 调用同一个 `McpControl`。

### Skills

- `SkillsCapabilitiesPage.tsx`：目录、详情、启用、默认选择和 MCP dependency 状态。
- 同一 Feature 页面持有用户 Skill 创建/编辑状态；内置和 Plugin Skill 只读。

内置和 Plugin Skill 只读；用户 Skill 才能修改正文。MCP dependency 的安装与认证通过 runtime coordinator。

Skills 的 renderer snapshot 与命令由 `packages/features/skills/src/renderer/` 持有。Feature service 通过 `/v1/features/skills/*` typed operations 管理 catalog、extra roots、CRUD 和 MCP dependency，并串行化 mutation、阻止迟到 refresh 回退最新结果。额外 Skill 根目录也由 Skills Feature 通过 Settings extension Slot 挂到“运行时”，宿主 Settings 不再接收 Skills 专用 props。该设置扫描用户级的 `.agents`、Codex、Claude、Grok 和 Pi Skill 目录，由宿主把相对主目录约定解析为跨平台绝对路径；未继承且没有可发现 Skill 的目录不展示，其他目录显示 Skill 数量并支持一键继承，用户仍可通过系统目录选择器添加自定义根目录。

“用对话创建 Skill”发出面向下一次主聊天 composer 的待消费请求，不绑定短生命周期 `composerKey`；切换到聊天或 composer 重建后，请求仍会插入对应 Skill slot 并聚焦输入框。

### Hooks

能力页不提供独立 Hooks 标签、目录或手动编辑器。用户通过“用对话创建插件”让 AI 生成包含 Hook 的 Plugin Bundle，或导入已有 Bundle；插件详情继续展示 Hook 的声明和运行状态。renderer 只读取 Plugin Management 提供的无路径投影：管理动作使用 opaque ID + 当前 command hash，Plugin Hook 的绝对命令也不会跨过 Feature boundary；旧版独立用户 Hook 只保留管理所需的命令预览。

随应用发布的内置插件由应用控制的可信来源规则启用 Hook；Agent 创建插件时，Hook 内容和信任包含在同一次 `configure_plugin` 审批中。开发者本地导入仍按侧载边界处理，不因选中目录而自动取得信任。

## State 与 refresh

宿主 Settings 通过 `useRuntimeClientState` facade 获取通用 Config；Skills、MCP，以及 Plugin 列表、市场、extension 与 Hook 状态由各自 renderer service 独立持有。composition root 只提供一个窄 `CapabilitiesRefreshCoordinator`：三个 Feature 在 setup 时登记自己的刷新动作，调用方按 owner 请求刷新；单个 owner 失败会记录后台错误，但不会阻止其他 owner 收敛。

刷新规则：

- Config save 后更新统一 config state。
- Image Generation、Vision Recognition 与 Workspace Dependencies 的设置更新不经过统一 config state，成功后只刷新所属 Feature controller。
- Skills、MCP 与 Plugin Management 分别维护独立 snapshot，迟到的旧 refresh 不覆盖新状态；Plugin Management 串行 Hook mutation，并让已开始的旧 refresh 无法覆盖 mutation 结果。
- Hook query 记录当前 project cwd；切换 project 或后台刷新失败时保留最后一次有效投影。
- Plugin install/update/remove 先由 Feature service 重读 Plugin snapshot，再通过 coordinator 刷新可能被 Bundle 改变的 Skill 与 MCP；Skill 的 Plugin/MCP dependency mutation 同样只请求相关 owner。runtime 初次 ready 与 turn 结算触发一次 best-effort `refreshAll()`，因此协作子线程的能力变更也能收敛。

## Developer features

全局开关默认关闭。关闭时需要同时：

- 隐藏 conversation debug 入口。
- 卸载已打开面板。
- 停止 trace polling。
- 让 runtime debug trace route 不可用。

不能只隐藏菜单而让数据继续在后台采集。

## 测试

Settings：

- `test/unit/features/settings/SettingsPage.test.ts`
- `packages/features/model-provider/test/renderer/`
- `packages/features/webdav-sync/test/renderer/`
- `packages/features/network-proxy/test/renderer/`
- `packages/features/workspace-dependencies/test/renderer/`
- `packages/features/usage/test/renderer/`
- Data-root issue/backup UI。
- Task model settings。

Capabilities：

- `apps/desktop/renderer/test/unit/composition/capabilities-refresh-coordinator.test.ts`
- `apps/desktop/renderer/test/unit/composition/renderer-feature-composition.test.ts`
- `packages/features/{plugin-management,skills,mcp}/test/renderer/` 的 service/presentation 测试。
- Plugin Management Hook runtime/service。

跨层修改还需要 runtime config/MCP/Skill/Plugin store 与 server integration tests。
