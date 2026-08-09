# Claude Rules 兼容：设计参考与许可说明

本插件使用 Setsuna 原生扩展 API 实现，行为设计参考 Pi 官方 `claude-rules.ts` 示例，固定参考提交：

- Source: <https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/examples/extensions/claude-rules.ts>
- Upstream project: <https://github.com/earendil-works/pi>

Setsuna 实现：在 `session.start` 中扫描 `.claude/rules`，忽略符号链接并限制遍历深度和文件数，再把规则路径作为外部上下文加入会话。不包含 Pi 的 `before_agent_start` system prompt 修改接口。

## Upstream license

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
