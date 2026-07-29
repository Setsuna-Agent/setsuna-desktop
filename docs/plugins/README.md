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
- 第一方能力插件：图片生成，用 Skill + runtime 内置 ToolHost 配对。
- Hook 插件：危险 shell、secret/path/generated folder 防护、审计和流程提示。

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

完整 manifest、限制、安装和卸载规则见 [Plugin Bundles](bundles.md)。

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
- 普通 Bundle 不能加载任意 TypeScript 到 runtime 进程。

## 测试

- `packages/desktop-runtime/test/adapters/plugin/file-plugin-bundle-store.test.ts`
- `file-plugin-marketplace.test.ts`
- `bundled-hook-plugins.test.ts`
- `packages/desktop-runtime/test/adapters/tool/plugin-bundle-tool-host.test.ts`
- Runtime server capabilities integration。
- Renderer capabilities Plugin tests。
