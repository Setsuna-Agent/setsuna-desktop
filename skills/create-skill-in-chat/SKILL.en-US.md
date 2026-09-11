---
name: "Create Skill in Chat"
description: "Generate a complete SKILL.md body through conversation and save it as a desktop user Skill with the local tool."
---

# Create Skill in Chat

Use this Skill when the user wants to create, update, improve, or save a desktop Skill through conversation. The capability page's “Create Skill in chat” action selects this Skill. Save a user Skill through the existing desktop flow instead of returning only a template.

## Runtime flow

- Use `configure_skill` to create or update a user Skill.
- Do not write directly into the runtime's `user-skills` directory.
- `configure_skill.content` accepts only the `SKILL.md` body, without YAML frontmatter.
- The runtime writes `name` and `description` into frontmatter.
- Built-in Skills are read-only. If asked to change one, explain that it cannot be overwritten directly and suggest creating a new user Skill.

## Required information

Ask only for information needed to create the Skill that the user has not already provided. When the request is clear, generate and save it directly.

Required fields:

- `name`: display name.
- `description`: one sentence explaining when the Skill should be used.
- `content`: complete `SKILL.md` body.

Optional fields:

- `id`: stable identifier; the tool derives it from the name when omitted.
- `enabled`: defaults to `true`.

## Content rules

Generate a complete body ready to save:

- Do not include `---` frontmatter.
- Do not leave ellipses, TODOs, unfinished sections, example steps, or other placeholders.
- Avoid vague instructions such as “adjust as needed”.
- Keep the trigger narrow enough for the model to decide when to use it.
- Make the workflow concrete enough to execute in a later turn.
- State constraints, including whether files, network access, or user confirmation are required.
- Specify an output format only when the task actually requires one.

Recommended structure:

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

Adapt this structure to the actual goal and replace all generic placeholders.

## Workflow

1. Determine whether the user is creating or updating a Skill.
2. Extract its name, trigger, workflow, constraints, and output requirements.
3. If the core purpose or trigger is missing, ask one short question; avoid a field-by-field interrogation.
4. Generate the complete `content` body.
5. Call `configure_skill` with `name`, `description`, `content`, `enabled`, and `id` when needed.
6. On success, report the name, ID, path, and enabled state.
7. On error, explain the cause and continue correcting the input.

## Output

- Do not paste the entire body before saving unless the user asks to preview it.
- Give a short result after saving; do not ask the user to copy files manually.
- Advice alone is appropriate when the user only asks how to write a Skill. Entry through the capability page's chat creation action implies saving a local user Skill.
