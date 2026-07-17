---
name: "OpenAI 官方文档"
description: 查询 OpenAI 平台、API、模型与 Codex 的最新官方开发文档。
auto-activate:
  - OpenAI API
  - OpenAI SDK
  - OpenAI 文档
  - Codex
  - Codex 文档
metadata:
  short-description: 通过官方 MCP 查询 OpenAI 文档
---

# OpenAI 官方文档

当用户询问 OpenAI API、模型、SDK、Codex 或平台能力，并且答案需要以当前官方文档为准时使用本 Skill。

## 工作流

1. 先确认 `openai_docs` MCP 依赖已经就绪；未就绪时使用 Skill 依赖安装链路，不要让用户手写 MCP 配置。
2. 优先通过 `openai_docs` 提供的工具或资源检索与问题直接相关的官方页面。
3. 对版本、参数、限制、弃用状态和模型可用性等易变化内容，以检索结果为准，不依赖记忆猜测。
4. 回答时区分文档明确说明的事实与根据文档作出的推断，并附上可定位的官方页面链接。

## 约束

- 只把该 MCP 返回的 OpenAI 官方内容当作 OpenAI 产品事实来源。
- 不要编造不存在的参数、模型名称、发布日期或兼容性结论。
- MCP 不可用时明确说明缺失状态；不要用 Shell、File 或任意第三方网页绕过依赖安装与授权流程。
