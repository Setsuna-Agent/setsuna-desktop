# Settings 与 Capabilities

源码：

- `apps/desktop/renderer/src/features/settings/`
- `apps/desktop/renderer/src/features/capabilities/`

Settings 管理用户与 runtime 配置；Capabilities 管理可安装或可调用的扩展能力。两者共享 runtime state，但承担不同产品语义。

## Settings

### 页面编排

`SettingsPage.tsx` 负责宿主 section 导航和数据/回调分发，并通过通用 `settings` contribution slot 挂载纵向 Feature 设置。具体宿主内容位于：

- `sections/`
- `providers/`
- `data-root/`
- `usage/`
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

Memory 是独立 renderer Feature，但不单独占用设置导航。它的 setup 静态返回两个 `settingsSectionExtensions`，把启用/生成/外部上下文策略和记忆管理入口追加到“个性化”，把抽取/整理模型追加到“专用模型”；preview、delete、clear 和保存状态仍由 Feature 自己持有，`SettingsPage` 不接收任何 Memory 专用 prop。标准 Section/Group/Row、Switch、Select 和 Button 由宿主通过 `SettingsViewHostProps.ui` 注入，因此业务所有权独立不等于信息架构或视觉系统独立。

Updater 也是独立 renderer Feature。它通过 `settingsSectionExtensions` 填充宿主保留的“关于”分区，并由 `UpdaterRendererStateService` 单点订阅 preload 状态；设置页和 App controller 不传递 updater 专用 props。顶栏铃铛只在 `composition/UpdaterFeatureBoundary.tsx` 占用宿主动作插槽，状态、动作、文案和样式仍由 `packages/features/updater/renderer` 拥有。

WebDAV Sync 也是独立 renderer Feature，并通过 setup 返回静态 `settingsViews` contribution，形成完整“同步”页面。它用 `navigationGroupId` 声明归入宿主“模型与服务”分组；没有已知宿主归属的 contribution 才进入独立“功能”分组，为后续可安装/第三方功能保留。连接、自动备份、数据类别、当前快照、还原检查、文案和 scoped CSS 都位于 `packages/features/webdav-sync/renderer`；宿主设置页只渲染只读 catalog，不读取 WebDAV 状态，也不持有 bridge 方法。标准表单控件由 `SettingsViewHostProps.ui` 注入，Feature 只维护业务特有布局。

Network Proxy 同样通过静态 `settingsViews` contribution 提供完整“代理服务器”页面，状态订阅、编辑动作、文案与 scoped CSS 位于 `packages/features/network-proxy/renderer`。宿主 controller 只通过 composition boundary 读取代理服务器公开投影，供仍属于根 Runtime Config 的模型 provider 下拉框使用；宿主设置页不直接调用代理 bridge，也不拥有代理 section。preload 子桥类型由 Feature contract 贡献，renderer 不接触端口、凭据或本地文件。

`shared/ui/SettingsViewUi.tsx` 是 Settings View 的宿主设计系统入口。它复用现有 `primitives.tsx` 和设置页布局样式，统一 focus、disabled、danger/primary、密度与可访问性；Feature 只为预览卡片、业务结果等特有 presentation 写 scoped CSS，并使用 `tokens.css` 公开的 `--sd-*` 语义 token。

### Provider settings

`providers/ProviderSettings.tsx` 和 `provider-model.ts` 管理：

- Provider kind、base URL、API key。
- Models 与默认 model。
- Thinking effort、max output、vision 等能力。
- Provider/model 品牌图标。
- 模型替换与引用关系。

规则：

- API key 留空不能覆盖已保存 secret。
- Renderer 只看到 `apiKeySet`/preview。
- Provider capabilities 来自 contract/discovery，不在 UI 写死厂商私有 payload。
- Base URL normalize 和 provider validation 最终仍由 runtime store 执行。
- 删除/替换被 task model 引用的模型要先显式迁移引用。

### 访问模式与审批审查

聊天输入区的三个访问模式会原子保存审批策略、审批主体和权限配置：

- “请求批准”：`strict + user + workspace-write`，所有需要确认的操作由用户决定。
- “替我审批”：`on-request + automatic + workspace-write`，只把 policy 检出的交互审批交给独立审查模型。
- “完全访问”：`full + user + danger-full-access`，不运行 OS sandbox 或审批审查。对强制删除命令的
  处理与 Codex 的 `DangerFullAccess + Never` 一致：命中窄范围危险命令规则时直接拒绝而不是弹窗，
  其余命令不受风险提示规则限制。Windows Shell 即使处于完全访问，也会将 `TEMP` / `TMP` / `TMPDIR` 指向系统临时
  目录下的独立会话目录，并在进程结束后清理；临时文件不应回落到当前项目工作区。

`TaskModelSettings.tsx` 中的 `taskModels.approvalReview` 可为审批审查选择独立 provider/model；未配置或引用失效时跟随当前对话模型。自动审查的等待、允许、拒绝和人工降级状态由 tool run 投影展示，renderer 不持有未截断工具参数，也不能回答标记为 `automatic` 的审批请求。

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

`usage/` 负责：

- Summary metrics。
- Provider/model breakdown。
- Activity calendar。
- Recent calls。
- Branding 映射。
- 全部时间、当天、滚动 24h/7d/30d 与分钟级自定义时间范围。
- 最近调用明细按 10 条分页，翻页通过 usage query 的 `limit`/`offset` 按需读取。

时间范围通过 `RuntimeUsageQuery.from/to` 传给 runtime，按 `[from, to)` 过滤后再统一聚合；
renderer 只负责范围选择与展示，不重新计算计费真源。年度 Activity calendar 始终使用未筛选的
全局过去一年数据，避免短区间筛选把长期趋势图压缩成少量格子。

### Workspace dependencies

Workspace Dependencies 是独立纵向 Feature，源码位于 `packages/features/workspace-dependencies/`。renderer setup 通过 `settingsSectionExtensions` 把设置追加到“运行时”区域；设置视图、controller、文案和 scoped CSS 都由 Feature 自己持有，宿主页不读取包源或工具链状态。

Feature 的 typed operations 读取 Node.js/Python/uv 状态、更新 npm/Python 包源，并执行诊断或修复。修复会复用健康的本机或托管工具，只补齐缺失、损坏或版本过低的环境；实际下载、校验和安装在 Feature runtime，不在 renderer 执行进程。旧 `config.json.desktopSettings` 包源字段只作为一次性迁移输入，迁移成功后退役，不再通过统一 `DesktopRuntimeClient` 或根 Config 修改。

## Capabilities

`CapabilitiesPage.tsx` 只编排筛选、mutation 和跨能力状态：

- `CapabilitiesCatalogItems.tsx`：MCP、Skill 的双列目录项。
- Plugin market/editor 继续位于各自子模块。

Hook 不再作为一级目录或独立表单暴露；它是 Plugin Bundle 内的一项能力，由插件创建、导入和安装流程统一管理。

### Plugin market

相关组件：

- `CapabilitiesPluginMarket`
- `CapabilitiesPluginListItem`
- `CapabilitiesPluginDetail`
- `CapabilitiesPluginInstallButton`
- `CapabilitiesInstalledPluginShortcut`

默认市场来自随应用打包的 `plugins/`，renderer 只接收无路径摘要。市场首页由已安装快捷区、精选区和按能力分类的紧凑列表组成。详情页展示声明的 Tool/Skill/MCP/Hook/resource 元数据，并负责 install/update/uninstall 动作。

Capabilities 的一级标签默认通过 `AppRouteTopbarPortal` 挂载到 `ShellFrame` 的 route topbar slot；Windows 下改为放在能力页内容顶部，分类与数量分别对齐该行两端，并使用一致的顶部/左右页边距。插件、MCP 与 Skill 的详情或编辑页沿用同一顶部基线。插件市场首页不提供搜索框，其他能力分类仍保留各自的目录搜索。

本地 Plugin Bundle 通过右上角“创建”菜单导入；不属于默认市场的已安装 Plugin 单独标识。

图片生成和视觉识别第一方 Plugin 的配置不在 `CapabilitiesPluginDetail` 中硬编码。各自的 renderer Feature 在 setup 时静态返回对应 Plugin 详情的设置与测试视图：

- `packages/features/image-generation/src/renderer/`
- `packages/features/vision-recognition/src/renderer/`

两个插件都默认不安装，只有用户从市场安装后详情页才显示 contribution。图片生成 Feature 维护自己的 Images API 服务配置；视觉识别 Feature 只列出“模型服务”中已启用且标记为支持图片的模型，在自己的 `model-selection` document 保存 provider/model 引用，并复用 provider 的服务地址、API key、协议和代理设置。组件只调用各自 typed Feature client，不读取根 Config，也不调用统一 `DesktopRuntimeClient` 的业务方法；输入框、文本域、选择器和按钮统一使用宿主注入的 `SettingsViewUi`，测试结果和图片预览仍由 Feature 自己布局。

Bundle 规则见 [Plugin Bundle](../../../plugins/bundles.md)。

### MCP

`mcp/CapabilitiesMcpEditor.tsx` 与 `mcp-editor-model.ts` 管理：

- `stdio` / `streamable_http` transport。
- Command/args 或 URL。
- Env/header 的 key/value 编辑。
- Enabled、required、approval policy。
- Allowed/disabled tools。
- Fetch tools、OAuth login/logout。

保存时保持结构化字段，不把 command/args 拼成 shell 文本。List/status 不显示 secret 值。

### Skills

- `CapabilitiesSkillDetail.tsx`：详情、启用、默认选择、依赖状态。
- `CapabilitiesSkillEditor.tsx`：用户 Skill 创建/编辑。

内置和 Plugin Skill 只读；用户 Skill 才能修改正文。MCP dependency 的安装与认证通过 runtime coordinator。

“用对话创建 Skill”发出面向下一次主聊天 composer 的待消费请求，不绑定短生命周期 `composerKey`；切换到聊天或 composer 重建后，请求仍会插入对应 Skill slot 并聚焦输入框。

### Hooks

能力页不提供独立 Hooks 标签、目录或手动编辑器。用户通过“用对话创建插件”让 AI 生成包含 Hook 的 Plugin Bundle，或导入已有 Bundle；插件详情继续展示 Hook 的声明和运行状态。renderer 只读取无路径的 Hook 投影，不接收或展示私有安装目录。

随应用发布的内置插件由应用控制的可信来源规则启用 Hook；Agent 创建插件时，Hook 内容和信任包含在同一次 `configure_plugin` 审批中。开发者本地导入仍按侧载边界处理，不因选中目录而自动取得信任。

## State 与 refresh

宿主 Settings/Capabilities 继续通过 `useRuntimeClientState` facade 获取通用 Config 和目录数据，实际能力状态由 `useRuntimeCapabilityState` 持有；Feature-owned 设置则由 renderer composition 注入的 typed client/controller 独立读取：

- Config save 后更新统一 config state。
- Image Generation、Vision Recognition 与 Workspace Dependencies 的设置更新不经过统一 config state，成功后只刷新所属 Feature controller。
- Capabilities refresh 使用 `Promise.allSettled`，单个 Skill/MCP/Hook/Plugin 请求失败不抹掉其他成功数据。
- Hook 请求受当前 project cwd 影响，使用 latest request guard。
- Install/remove 后重新拉取 Plugin、Skill、MCP、Hook，而不是靠局部猜测所有权变化。

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
- `packages/features/webdav-sync/test/renderer/`
- `packages/features/network-proxy/test/renderer/`
- `packages/features/workspace-dependencies/test/renderer/`
- Provider/model replacement、brand icon upload。
- Data-root issue/backup UI。
- Usage calendar/branding/page。
- Task model settings。

Capabilities：

- `CapabilitiesPage.test.ts`
- Plugin components/display/localization。
- Hook config。

跨层修改还需要 runtime config/MCP/Skill/Plugin store 与 server integration tests。
