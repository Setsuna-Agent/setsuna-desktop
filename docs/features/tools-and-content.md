# 工具、内容与能力管理 Features

本页覆盖 Artifact、Image Generation、Vision Recognition、Skills 和 Plugin Management。MCP 有独立的[详细文档](mcp.md)；通用工具审批与执行链见 [Runtime 工具宿主](../core/runtime/tools-and-capabilities.md)。

## Artifact

源码：`packages/features/artifact/`

Artifact 拥有 `publish_artifact` 工具语义和持久结果展示。Runtime 从宿主获得受 workspace 约束的文件能力，Feature 定义工具 schema、结果 envelope 和安全路径语义；renderer 解码同一 contract 并把结果放到 assistant tail。

- Runtime required：向 CompositeToolHost 提供 `artifactRuntimeToolServiceCapability`。
- Renderer required：注册 `artifact.file` v1 tool-result view，并兼容旧结果格式。
- Result identity 使用 workspace root + path，避免同一文件的旧发布结果重复占据 transcript。
- 打开、预览和复制仍通过宿主注入的受限文件能力，不把本地绝对路径变成 renderer 权限。

Runtime Core 的 `ArtifactToolHost` 只是绑定 Feature service 的薄 adapter，不应复制 schema、审批或结果格式化。

## Image Generation

源码：`packages/features/image-generation/`

Image Generation 拥有图片服务设置、连接测试、生成服务、资产结果与 Plugin 详情设置 contribution。宿主注入网络 fetch、generated image store、线程引用读取和 workspace 文件能力。

- Settings 使用独立 Feature document，并从旧 `RuntimeConfig` 字段一次性迁移。
- API key/secret 不进入 renderer public state；更新走 revisioned typed operation。
- 生成结果引用 runtime 管理的 asset ID，renderer 通过窄 desktop asset bridge 读取、复制或 reveal。
- Plugin 未安装时不在 Plugin 详情显示配置；安装后 renderer contribution 才进入对应详情面。
- Feature optional 失败不能破坏普通 Chat；通用工具结果仍要有 fallback。

## Vision Recognition

源码：`packages/features/vision-recognition/`

Vision Recognition 拥有视觉模型选择、附件识别服务、测试操作和 Plugin 详情 contribution。它复用已启用 Model Provider 的 endpoint、credential、协议和 proxy，而不是维护第二套 provider 配置。

- Settings 只保存 provider/model 引用，并校验所选模型具备图片能力。
- Runtime host 注入附件读取、模型采样、usage 记录、thread 状态和 Plugin 安装状态。
- Renderer 只展示可用视觉模型，并通过 typed operations 读取/更新/测试。
- Plugin 未安装时业务入口不可被 UI contribution 误开放。
- 模型错误、附件错误与 Feature settings 错误要保持可区分，不能统一吞成“识别失败”。

## Skills

源码：`packages/features/skills/`

Skills Feature 拥有 Skill catalog、详情、用户 Skill CRUD、extra roots、启用状态和 MCP dependency 安装的管理面。文件扫描和 MCP/Plugin 安装事务由宿主 adapter 提供，Feature 统一 operation 与 renderer 收敛逻辑。

主要 operation：

- `readSkills` / `readSkill`
- `createSkill` / `updateSkill` / `deleteSkill`
- 启用状态与 extra roots 更新
- `installSkillMcpDependencies`

内置和 Plugin Skill 只读，用户 Skill 才能编辑。Renderer service 串行 mutation，并防止已开始的旧 refresh 覆盖新结果；宿主 Capabilities 页面只消费 service，不拥有 Skill snapshot。

Skill 格式、来源和自动激活见 [Builtin Skills](../extensions/skills/README.md)。

## Plugin Management

源码：`packages/features/plugin-management/`

Plugin Management 是 Plugin catalog 和管理事务的业务 owner，横跨 runtime、main、preload 和 renderer：

| 进程 | 所有权 |
| --- | --- |
| Runtime | 聚合 snapshot、市场/已安装详情、install/update/remove、Hook 状态、extension trust |
| Main | 本地目录选择、可信 sender 校验、通过 RuntimeHost 安装绝对目录 |
| Preload | `plugins` 子桥，只暴露固定本地安装入口 |
| Renderer | Plugin/Hook/extension state service、详情和 mutation 收敛 |

本地安装是特殊安全链路：通用 runtime proxy 明确拒绝对应绝对路径 operation；只有 Main Feature 在用户选择目录后，才能通过内部 RuntimeHost 调用安装。Renderer 永远不持有或传递绝对本地目录。

Plugin Management 还拥有：

- 内置市场与已安装 Bundle 的聚合投影。
- Plugin item 详情读取。
- 更新、卸载和 extension trust。
- Plugin Hook 的启停，以及 legacy standalone Hook 的最窄清理接口。
- catalog revision，供 Agent turn 在跨线程 mutation 后决定是否刷新扩展快照。

Bundle 格式和安装事务见 [Plugin Bundles](../extensions/plugins/bundles.md)，可执行 worker 边界见 [Extensions API](../extensions/plugins/extensions.md)。

## Core 与 Feature 的分工

```text
Feature service
  ├── tool definition / settings / catalog / result codec
  └── business operation
            │
            ▼
Runtime Core adapter
  ├── CompositeToolHost ordering
  ├── preview / approval / retry / terminal event
  └── thread/toolRun persistence
```

- Feature 决定“能力是什么、返回什么、如何配置”。
- Runtime Core 决定“如何通过统一安全链执行、何时审批、怎样写 toolRun terminal event”。
- Renderer Core 决定 transcript/layout；Feature contribution 决定业务结果的解码和呈现。

## 修改检查表

1. Tool schema、approval、external context 和 result envelope 是否由真实 owner 定义？
2. Secret、绝对路径和 executable command 是否被截在正确的进程边界？
3. Plugin/Skill/MCP 安装事务是否原子，失败后是否能回滚或明确恢复？
4. Renderer mutation 后是否防止迟到 refresh 回退？
5. 未安装/未知/已删除 owner 的持久结果是否仍有通用 fallback？
