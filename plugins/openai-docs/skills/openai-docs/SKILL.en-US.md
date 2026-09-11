---
name: "OpenAI Documentation"
description: "Look up current official developer documentation for the OpenAI platform, APIs, models, and Codex."
auto-activate:
  - OpenAI API
  - OpenAI SDK
  - OpenAI 文档
  - Codex
  - Codex 文档
---

# OpenAI Documentation

Use this Skill when a question about OpenAI APIs, models, SDKs, Codex, or platform capabilities requires current official documentation.

## Workflow

1. Confirm the `openai_docs` MCP dependency is ready. Otherwise use the Skill dependency installation flow; do not ask the user to write MCP configuration.
2. Prefer the tools or resources provided by `openai_docs` to retrieve official pages directly relevant to the question.
3. Verify changing details such as versions, parameters, limits, deprecations, and model availability against retrieved sources instead of guessing from memory.
4. Distinguish documented facts from inferences and link directly to the supporting official pages.

## Constraints

- Use only official OpenAI content returned by this MCP as the source of OpenAI product facts.
- Do not invent parameters, model names, release dates, or compatibility claims.
- If MCP is unavailable, explain the missing dependency. Do not bypass installation and authorization through Shell, File, or arbitrary third-party webpages.
