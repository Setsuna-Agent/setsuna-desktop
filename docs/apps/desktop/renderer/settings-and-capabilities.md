# Settings 与 Capabilities

源码：

- `apps/desktop/renderer/src/features/settings/`
- `apps/desktop/renderer/src/features/capabilities/`

Settings 管理用户与 runtime 配置；Capabilities 管理可安装或可调用的扩展能力。两者共享 runtime state，但承担不同产品语义。

## Settings

### 页面编排

`SettingsPage.tsx` 负责 section 导航和数据/回调分发。具体内容位于：

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
| `GeneralSettings.tsx` | 主题、字体、缩放、外观 |
| `PersonalizationSettings.tsx` | Global prompt、Setsuna style、memory |
| `RuntimeSettings.tsx` | Approval、permission、developer features、runtime 行为 |
| `TaskModelSettings.tsx` | 不同 task kind 的模型选择 |
| `ArchivedThreadsSettings.tsx` | 归档线程管理 |
| `AboutSettings.tsx` | 版本与 updater |

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

聚合数据来自 runtime `UsageStore`；renderer 只做展示聚合，不重新计算计费真源。

### Workspace dependencies

`WorkspaceDependenciesSettings.tsx` 展示 runtime 管理的 Python/uv 等依赖状态，支持启用、诊断和重装。实际下载、校验和安装在 runtime adapter，不在 renderer 执行进程。

## Capabilities

`CapabilitiesPage.tsx` 只编排筛选、mutation 和跨能力状态：

- `CapabilitiesCatalogCards.tsx`：MCP、Skill、Hook 列表卡片。
- `CapabilitiesHookEditor.tsx`：Hook draft、metadata 映射和 editor UI。
- Plugin market/editor 继续位于各自子模块。

Hook editor 的 draft/metadata 转换是可独立测试的纯边界；页面不再同时维护表单字段渲染和 catalog card 细节。

### Plugin market

相关组件：

- `CapabilitiesPluginMarket`
- `CapabilitiesPluginListItem`
- `CapabilitiesPluginDetail`
- `CapabilitiesPluginInstallButton`
- `CapabilitiesInstalledPluginShortcut`

默认市场来自随应用打包的 `plugins/`，renderer 只接收无路径摘要。市场首页由已安装快捷区、精选区和按能力分类的紧凑列表组成。详情页展示声明的 Skill/MCP/Hook/resource 元数据，并负责 install/update/uninstall 动作。

Capabilities 的一级标签通过 `AppRouteTopbarPortal` 挂载到 `ShellFrame` 的 route topbar slot，避免窗口标题栏与页面标签各占一行；Windows/Linux 的 slot 位于可拖拽标题栏轨道内，按钮区域显式保持 `no-drag`。插件市场首页不提供搜索框，其他能力分类仍保留各自的目录搜索。

本地侧载不从普通 UI 暴露；不属于默认市场的已安装 Plugin 单独标识。

图片生成第一方 Plugin 还有：

- `ImageGenerationPluginSettings`
- `ImageGenerationPluginTest`

API key 仍由 runtime secret store 处理。

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

### Hooks

`hooks/runtimeHookConfig.ts` 把 UI Hook 表单转换到 runtime config，并处理 user/project matcher scope。

Hooks 页面只展示实际配置内容。Plugin Hook 默认不可信，必须按当前命令 hash 单独信任；renderer 不接收或展示私有安装目录。

## State 与 refresh

Settings/Capabilities 继续通过 `useRuntimeClientState` facade 取数，实际能力状态由 `useRuntimeCapabilityState` 持有：

- Config save 后更新统一 config state。
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
- Provider/model replacement、brand icon upload。
- Data-root issue/backup UI。
- Usage calendar/branding/page。
- Task model settings。

Capabilities：

- `CapabilitiesPage.test.ts`
- Plugin components/display/localization。
- Hook config。

跨层修改还需要 runtime config/MCP/Skill/Plugin store 与 server integration tests。
