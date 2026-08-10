# Cross-module Designs

这里保存跨越多个源码模块的完整状态机或协议设计。模块文档只说明本模块的职责，并链接到这里，避免重复维护。

## 当前设计

- [Active turn 发送队列](queued-turn-inputs.md)：Contract event、runtime FIFO/steer/Goal 调度、REST 和 renderer composer 的完整链路。
- [持久化 Goal](persistent-goals.md)：`pi-goal` 对齐、状态机、自动续轮、安全停止、恢复和 composer 控制。
- [WebDAV 自动备份与手动还原](webdav-backup-and-restore.md)：已实施的数据白名单、API Key 端到端加密、不可变快照、还原损失清单和崩溃回滚协议。

## 评审与治理

- [架构复杂度收敛评审](architecture-complexity-review.md)：协议边界与事件完整性实施状态、协调层热点和分阶段治理计划。
- [Runtime 边界与事件矩阵](runtime-boundary-matrix.md)：`DesktopRuntimeClient` 当前传输清单和 46 类 RuntimeEvent 的显式投影边界。

## 何时新增设计文档

适合：

- 同一状态机跨 contracts、runtime、main/preload、renderer。
- 有明显并发、恢复、取消或兼容边界。
- 单个模块文档无法完整解释因果关系。

不适合：

- 单个目录的文件说明，应写到对应模块文档。
- 尚未实现的模糊想法；提案必须明确标记状态和决策。
- 对源码逐行复述。

设计文档至少包含：

- 目标与非目标。
- 数据模型/事件。
- 状态转换。
- 并发与失败。
- 各模块职责。
- 验证覆盖。
- 相关文件。
