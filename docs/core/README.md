# Core

Core 保存多个无关业务共同依赖、不能随单个 Feature 一起删除的技术与领域基础。当前由三个主要 package 组成：

| Package | 文档 | 职责 |
| --- | --- | --- |
| `packages/contracts` | [Contracts](contracts/README.md) | Core 跨进程 DTO、线程事件、HTTP/bridge、SWE 映射 |
| `packages/feature-core` | [Feature Core](feature-core/README.md) | Feature identity、Capability、Scope、operation、settings、进程组合协议 |
| `packages/desktop-runtime` | [Desktop Runtime](runtime/README.md) | Agent loop、server、ports/adapters、Core stores 与 Feature 宿主组合 |

## Core 与 Feature 的判断线

一段能力应留在 Core，通常是因为它同时满足以下一项或多项：

- 多个彼此无关的业务 Feature 都依赖它。
- 它定义线程、turn、message、tool run、审批或进程安全边界等系统语义。
- 删除任意一个业务 Feature 时，它仍必须存在。
- 它是组合协议或 transport，而不是某个业务 use case。

一段能力应进入 `packages/features/<name>`，通常是因为它拥有稳定业务 identity，并能连同自己的 contracts、settings、operation、event、view 和 native bridge 一起删除。

不要为了“复用”把单一业务 owner 的 DTO 或 service 上提到 Core。只有第二个真实消费者出现、且双方依赖的是同一语义时，才抽出公共 primitive。

## 依赖方向

```text
contracts          feature-core
    │                   │
    ├──── Core runtime ─┤
    │                   └── Feature contracts/process entry
    ↓
desktop host composition
```

- `contracts` 不导入 runtime、Electron、React 或具体 Feature。
- `feature-core` 不导入具体 Feature，也不解释业务 event/settings/tool result。
- `desktop-runtime` 可以在唯一 composition root 导入 Feature runtime entry；通用 loop、port 和 adapter 不能反向依赖 Feature 实现。
- Feature 之间只导入 `/contracts`，不导入对方 runtime/renderer/main/preload。

精确规则由 `scripts/check-feature-boundaries.mjs` 与 `pnpm check:architecture` 校验。

## 修改 Core 前的检查

1. 这个类型或服务是否真的有多个无关业务消费者？
2. 它能否作为某个 Feature 的私有 contract 或 Capability 留在 owner 内？
3. 修改是否会扩散到 runtime、main/preload、renderer 或持久事件？
4. 是否改变通用安全、取消、序列、兼容或恢复语义？
5. 是否需要同步 [总体架构](../architecture/README.md) 或 [变更扩散图](../architecture/change-map.md)？
