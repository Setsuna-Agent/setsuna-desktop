# Builtin Skills

源码目录：`skills/`

这里存放随应用直接打包、无需安装 Plugin 就可用的内置 Skill。用户创建的 Skill 写入数据根 `runtime/user-skills/`；Plugin Skill 位于已安装 Plugin 私有副本。

## 当前内置 Skill

| 目录 | 用途 |
| --- | --- |
| `create-mcp-in-chat/` | 在对话中收集结构化 MCP 配置并调用管理工具 |
| `create-skill-in-chat/` | 在对话中生成完整 Skill 内容并保存为用户 Skill |

具体行为以各目录的 `SKILL.md` 为准。

## 三种 Skill 来源

| Kind | 来源 | 正文是否可编辑 |
| --- | --- | --- |
| Builtin | 应用包 `skills/` | 否 |
| Plugin | `runtime/plugins/<plugin>/skills/` | 否 |
| User | `runtime/user-skills/<id>/SKILL.md` | 是 |

Enable/selected 状态统一保存在 `runtime/skills.json`。

## Runtime 加载链路

```text
main RuntimeHost
  → inject builtin skills directory
  → FileSkillRegistry
      ├── builtins
      ├── installed plugin skills
      ├── user skills
      └── optional extra roots
  → SkillRegistry port
  → RuntimeSamplingContextBuilder
  → prompt injection
```

`FileSkillRegistry` 负责：

- 读取 YAML frontmatter 与正文。
- 规范化 ID/name/description。
- 读取 MCP dependency manifest。
- 合并状态。
- 监视目录变化并通知 app-server。
- 返回 prompt injection。

## 选择与自动激活

注入来源：

- 用户在当前输入显式选择的 Skill。
- `selected: true` 的默认 Skill。
- Plugin Skill 的 auto-activation。

显式选择存在时，不再追加自动匹配的 Plugin Skill。自动匹配可使用：

- `auto-activate` 短语。
- 用户文本。
- 附件文件名和 MIME。
- Plugin/Skill 名称与高置信度标签 fallback。

匹配只是选择候选，不能改变 Skill 的信任级别或工具权限。

## `SKILL.md` 结构

最小示例：

```markdown
---
name: "示例 Skill"
description: "在明确的示例任务中使用。"
---

# 示例 Skill

## Workflow

1. 收集必要输入。
2. 使用已有项目链路执行。
3. 验证结果。

## Constraints

- 不读取任务范围外的文件。
```

Plugin Skill 可额外声明：

```yaml
auto-activate:
  - 精确短语
```

用户 Skill 的 frontmatter 由 runtime 根据结构化输入生成；管理工具的 `content` 只传正文。

## MCP dependencies

Skill 可以声明 MCP dependency。`SkillMcpDependencyCoordinator`：

- 展示缺失/已安装/需认证状态。
- 安装声明的 server。
- 发起 OAuth。
- 在依赖变化时刷新 Skill detail。

Skill 本身不能把 secret 写入 manifest；认证仍走 MCP/native secret 链路。

## 修改内置 Skill

1. 保持触发描述窄且可判断。
2. 工作流写完整动作，不留 TODO/占位符。
3. 明确哪些动作需要审批或用户输入。
4. 使用当前 runtime 工具名和结构化参数。
5. 不要求用户手写 runtime 私有 JSON。
6. 检查 packaged build 的 `skills/**/*` 仍包含新增资源。
7. 运行 Skill registry integration 和相关 ToolHost tests。

新增适合市场按需安装的能力时，优先创建 Plugin Skill，而不是扩大默认内置 Skill 面。

## 相关源码

- `packages/desktop-runtime/src/adapters/skill/file-skill-registry.ts`
- `skill-mcp-dependency-coordinator.ts`
- `packages/desktop-runtime/src/adapters/tool/skill-management-tool-host.ts`
- `packages/desktop-runtime/src/ports/skill-registry.ts`
- `packages/contracts/src/skills.ts`
- Renderer `features/capabilities/CapabilitiesSkill*.tsx`

## 测试

- `packages/desktop-runtime/test/integration/adapters/skill/file-skill-registry.test.ts`
- `test/adapters/skill/skill-mcp-dependency-coordinator.test.ts`
- `test/adapters/tool/skill-management-tool-host.test.ts`
- Runtime server capabilities tests。
- Renderer capabilities tests。

