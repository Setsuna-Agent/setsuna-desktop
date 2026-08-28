# Extensions

Setsuna Desktop 有四种容易混淆的扩展机制，它们的信任级别、安装方式和所有权不同：

| 机制 | 来源 | 是否运行代码 | 主要 owner | 适合 |
| --- | --- | --- | --- | --- |
| 第一方 Feature | 编译进应用 | 是，进入指定进程 bundle | `packages/features/*` + Feature Core | 与产品同版本发布的完整业务闭环 |
| Plugin Bundle | 内置市场、本地导入、Agent 创建 | 声明式内容；受信任 extension 可在隔离 worker 运行 | Plugin Management Feature + runtime adapters | 一组 Tool/Skill/MCP/Hook/resource 的可安装能力 |
| Skill | 内置、用户、Plugin | `SKILL.md` 本身不执行任意代码 | Skills Feature + FileSkillRegistry | 给 Agent 的工作流说明、约束和依赖 |
| MCP server | 用户配置或 Plugin 声明 | 在外部进程/服务运行 | MCP Feature | 标准化 tools/resources/prompts 与 OAuth |

## 选择边界

- 需要 main/preload/renderer 原生闭环、产品级持久状态或编译期 UI：使用第一方 Feature。
- 需要用户安装/卸载的一组 Agent 能力：使用 Plugin Bundle。
- 主要内容是可读工作流和约束：使用 Skill。
- 能力已经通过 MCP 协议提供：配置 MCP server，不复制成内置工具。

不要把 Feature Composition 当作运行时插件系统。Feature inventory 来自源码和四个静态 composition root；Plugin/Skill/MCP 才有运行时 catalog。

## 目录

- [Plugin 概览](plugins/README.md)：Bundle 类型、目录要求、安装和信任模型。
- [Plugin Bundles 与默认市场](plugins/bundles.md)：manifest、内置能力和安装事务。
- [可执行扩展 API](plugins/extensions.md)：worker、Tool、Hook、网络与结构化 UI。
- [Builtin Skills](skills/README.md)：Skill 来源、选择、自动激活、依赖和编辑规则。
- [MCP Feature](../features/mcp.md)：连接、OAuth、工具执行和宿主兼容面。

## 安全基线

- Plugin manifest、Skill 正文、MCP 输出和网页内容都可能是不可信外部上下文，不能提升为 system policy。
- 本地导入目录不自动获得 extension/Hook 执行信任。
- 可执行 extension 只在独立 Node worker 中运行，通过显式 host API 获取能力。
- MCP/Plugin/Tool 的 mutation 仍受 runtime policy、approval、permission profile 和路径边界约束。
- Renderer contribution 是受限结构，不允许 Plugin 注入 React、HTML、全局 CSS、任意 JavaScript 或任意 IPC。
