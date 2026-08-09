# Plugins

源码目录：`plugins/`

仓库根 `plugins/` 是随应用打包的只读精选市场源。每个子目录是一个 Plugin Bundle；runtime 安装时会完整校验并复制到用户数据根，不从源码/应用目录原地运行可变状态。

## 与 Runtime 的关系

```text
repository plugins/
  → electron-builder packages read-only bundles
  → FilePluginMarketplace scans summaries
  → renderer lists marketplace
  → user installs by plugin ID
  → FilePluginBundleStore validates and copies
  → runtime/plugins/<plugin-id>
```

Renderer 只能看到安全摘要：

- ID、name、version、publisher、description、tags、icon token。
- 声明的 Skill/MCP/Hook/resource 展示信息。
- 安装/更新状态。

Renderer 看不到：

- Bundle 本地路径。
- 私有安装目录。
- Hook command。
- MCP secret。
- 任意可执行文件内容。

## 当前插件类型

仓库内 Bundle 主要分为：

- Skill 插件：OpenAI docs、Context7、PDF、Documents 等。
- 第一方能力插件：网络搜索、图片生成和视觉识别，用市场 Bundle + runtime 内置 ToolHost 配对，并由用户从市场按需安装。
- Hook 插件：危险 shell、secret/path/generated folder 防护、审计和流程提示。
- 可执行扩展：Bundle v2 在受管 Node worker 中注册动态工具和 Agent 生命周期中间件。
- Setsuna 原生工具：结构化提问、会话任务清单和 Claude Rules 兼容；设计参考与许可记录保留在 Bundle 源码内部，不作为用户侧品牌或能力资源。

目录内容以 `plugins/` 实际文件和各 Bundle manifest 为准，生成索引见根 [Tree.md](../../Tree.md)。

## 目录要求

每个 Plugin 至少包含：

```text
<plugin-id>/
└── .setsuna-plugin/
    └── plugin.json
```

可选：

- `skills/`
- `hooks/`
- `resources/`
- `extension/`

完整 manifest、限制、安装和卸载规则见 [Plugin Bundles](bundles.md)；动态代码的作者 API、信任模型和限制见 [可执行扩展 API v1](extensions.md)。

用户也可以直接在对话中让 Agent 创建或修改插件。Agent 通过 `configure_plugin` 提交完整的 Bundle v2 manifest 和 UTF-8 文本文件快照，runtime 将内容写入自己的受管草稿目录并完成安装；用户不需要先创建、下载或选择一个本地目录。包含 Hook 或可执行扩展时，审批卡片会展示本次完整内容摘要和文件哈希，批准只信任这一版内容，后续修改必须重新审批。

## 添加精选 Plugin

1. 创建稳定的小写目录 ID。
2. 编写 `.setsuna-plugin/plugin.json`。
3. 只声明 Bundle 内相对路径。
4. Skill 使用完整 `SKILL.md`，必要时提供 agent manifest。
5. Hook 脚本保持单一职责，并定义 Windows 命令或确认跨平台命令可用。
6. 不在 manifest 内嵌 API key、env secret、header secret 或带凭据 URL。
7. 运行 Plugin bundle/marketplace tests。
8. 如果改变 schema 或用户语义，更新 [bundles.md](bundles.md)。

## 信任模型

- 应用目录是默认可信市场来源，但每个 Bundle 仍执行完整结构校验。
- Bundle MCP/Hook 不因来自市场就自动获得运行权限。
- Hook 默认按 command hash 单独信任。
- MCP 默认审批。
- Resource 作为外部不可信上下文。
- 内置 Plugin 全部使用 Bundle v2；没有 `extension` 的 Bundle 保持纯声明式。内置扩展在安装和升级时自动校验并启用，本地侧载扩展才需要用户信任完整包哈希；扩展代码始终只在独立 worker 中运行。
- Agent 创建的 Plugin 必须先通过内容绑定审批；批准后该版本会直接安装并启用，Hook 命令与可执行扩展的信任仅覆盖审批时展示的内容哈希。

## 测试

- `packages/desktop-runtime/test/adapters/plugin/file-plugin-bundle-store.test.ts`
- `file-plugin-marketplace.test.ts`
- `bundled-hook-plugins.test.ts`
- `packages/desktop-runtime/test/adapters/tool/plugin-bundle-tool-host.test.ts`
- Runtime server capabilities integration。
- Renderer capabilities Plugin tests。
