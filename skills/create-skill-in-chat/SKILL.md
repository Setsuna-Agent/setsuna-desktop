---
name: "对话创建Skill"
description: 通过对话生成完整 SKILL.md 正文，并调用本地工具保存为桌面端用户 Skill。
metadata:
  short-description: 对话创建或更新桌面端 Skill
---

# 对话创建 Skill

当用户想在对话中创建、更新、完善或保存桌面端 Skill 时使用本 Skill。能力页点“用对话创建技能”会默认选中本 Skill；你需要基于当前桌面端 Skill 链路保存用户 Skill，而不是只给用户一段模板。

## 当前链路

- 使用本地工具 `configure_skill` 创建或更新用户 Skill。
- 不要直接写入运行时 `user-skills` 目录。
- `configure_skill.content` 只接收 `SKILL.md` 正文，不包含 YAML frontmatter。
- 运行时会把 `name` 和 `description` 写入 frontmatter。
- 内置 Skill 是只读的；如果用户要求改内置 Skill，应说明不能直接覆盖，并建议创建一个新的用户 Skill。

## 需要收集的信息

只追问创建 Skill 必需且用户没有提供的信息。用户已经说清楚时直接生成并保存。

必需字段：

- `name`：展示名称。
- `description`：一句话说明这个 Skill 何时应该被使用。
- `content`：完整的 `SKILL.md` 正文。

可选字段：

- `id`：稳定标识。用户未指定时由工具根据名称生成。
- `enabled`：默认 `true`。
- `selected`：默认 `false`；只有用户明确要求“默认使用”“全局启用”“每次都带上”时才设为 `true`。

## 正文生成规则

生成的 `content` 必须是可直接保存的完整 Skill 正文。

- 不要包含 `---` frontmatter。
- 不要留下省略号、`TODO`、`待补充`、`示例步骤` 等占位内容。
- 不要写“根据需要调整”这类空泛说明。
- 触发条件要窄，能让模型判断什么时候该用。
- 工作流要具体，能指导模型下一次按步骤执行。
- 约束要写清楚，包括是否需要查文件、是否能联网、是否需要用户确认。
- 输出格式只在确实有固定输出要求时写。

推荐正文结构：

```markdown
# Skill Name

Use this skill when the user asks for a clearly scoped task that matches this capability.

## Workflow

1. Identify the concrete user goal and required inputs.
2. Inspect only the source files, APIs, documents, or runtime state needed for the task.
3. Apply the established project or product flow for this capability.
4. Validate the result with the relevant command, preview, or consistency check.
5. Report what changed, what was verified, and any remaining limitation.

## Constraints

- Keep edits scoped to the requested capability.
- Prefer existing project conventions over new abstractions.
- Ask for missing required inputs only when they cannot be inferred safely.
```

你可以把上面的结构改成更适合用户目标的具体内容，但不能保留泛化占位。

## 执行流程

1. 判断用户要新建还是更新 Skill。
2. 提取名称、触发场景、工作流、约束和输出要求。
3. 如缺少核心目的或触发场景，先问一个短问题；不要连续盘问表单字段。
4. 生成完整 `content` 正文。
5. 调用 `configure_skill`，传入 `name`、`description`、`content`、`enabled`，以及必要时的 `id` 和 `selected`。
6. 保存成功后告诉用户 Skill 名称、id、路径、是否启用、是否默认使用。
7. 如果工具报错，解释原因并继续修正输入。

## 输出要求

- 保存前不需要把整份正文贴给用户，除非用户要求先预览。
- 保存后给出简短结果，不要再要求用户手动复制文件。
- 如果用户只是咨询如何写 Skill，而不是要求保存，可以只给建议；但用户从能力页对话创建进入时，默认目标是保存为本地用户 Skill。
