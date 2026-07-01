# Setsuna Desktop Docs

这组文档把 `Tree.md` 里的目录级信息沉淀成可维护的模块设计说明。

- `architecture-overview.md`：系统边界、启动链路、请求/SSE、事件模型、安全边界。
- `desktop-app.md`：Electron main、preload、renderer、页面和 UI 状态组织。
- `local-runtime.md`：runtime server、agent loop、ports/adapters、模型、工具、MCP、Skill、memory。
- `contracts-and-data.md`：共享契约、本地数据、线程事件投影、变更扩散点。
- `build-release.md`：构建、测试、打包、CI 和 release 产物。

如果只想快速定位文件，读根目录 `Tree.md`；如果要改代码，先读 `AGENTS.md` 的约束，再进入对应模块文档。
