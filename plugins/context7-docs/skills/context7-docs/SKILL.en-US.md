---
name: "Context7 Documentation"
description: "Look up current, version-specific documentation and code examples for third-party libraries and frameworks."
auto-activate:
  - Context7
  - library documentation
  - framework documentation
  - 第三方库文档
  - 第三方框架文档
  - 依赖库文档
---

# Context7 Documentation

Use this Skill when the user needs current APIs, configuration, migration guidance, or version-specific examples for a third-party library, framework, or SDK.

## Workflow

1. Confirm the `context7` MCP dependency is ready; otherwise use the Skill dependency installation flow.
2. Identify the library, target version, and concrete task from the question and project manifests. State the version range used when the exact version is unknown.
3. Resolve the correct Context7 library ID first, then query documentation with the complete question instead of broad keywords alone.
4. Compare the returned information against the project's dependency versions before recommending an implementation, and identify version mismatches.

## Constraints

- Context7 aggregates third-party material. For security, deprecations, or behavioral differences, prioritize the upstream project documentation linked in its results.
- Do not apply another version's API directly to the current project.
- If MCP is unavailable, explain the dependency state. Do not bypass installation approval by modifying MCP configuration through Shell or File.
