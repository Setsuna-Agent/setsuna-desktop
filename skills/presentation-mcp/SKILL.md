---
name: presentation-mcp
description: Use when the user wants to generate, draft, export, inspect, or improve a PowerPoint/PPTX deck with the built-in Setsuna Presentation MCP.
metadata:
  short-description: Generate PPTX decks with the local Presentation MCP
---

# Presentation MCP

This built-in skill is packaged with Setsuna Desktop so the local runtime can discover and inject it without a backend Skill API.

Use the local `presentation` MCP to create editable `.pptx` files in the selected workspace. Prefer generating a real deck when the user asks for a PPT/PPTX.

Completion rules:

- Build a numbered slide plan before generation.
- Generate the file with enough slides to match the plan.
- Inspect the generated file before final response.
- Final response should include the returned path and inspected slide count.

Output location priority:

1. Use the user's Documents folder only when the runtime explicitly allows workspace-external output.
2. Otherwise use a visible workspace path such as `presentations/<safe-name>.pptx`.
3. Use `.setsuna/artifacts/presentations/<safe-name>.pptx` only for internal artifacts or when no visible path is available.

