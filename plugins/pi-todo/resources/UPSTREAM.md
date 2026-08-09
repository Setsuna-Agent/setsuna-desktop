# 任务清单：设计参考与许可说明

本插件使用 Setsuna 原生扩展 API 实现，操作语义参考 Pi 官方 `todo.ts` 示例，固定参考提交：

- Source: <https://github.com/earendil-works/pi/blob/936aff00918de1187f085f123c2812d8f2d67745/packages/coding-agent/examples/extensions/todo.ts>
- Upstream project: <https://github.com/earendil-works/pi>

Setsuna 实现：提供 `list`、`add`、`toggle` 和 `clear`；任务通过 Setsuna Extension State 按会话保存。不包含 Pi 的 `/todos` 命令、自定义 TUI renderer 和分支消息回放，因此分叉会话不会自动回到分叉点的任务状态。

## Upstream license

MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
