# 持久化 Goal

状态：已实施。

本文记录 Setsuna Desktop 持久化 Goal 的产品语义、跨层实现、恢复策略和与 [`pi-goal` 0.1.7](https://pi.dev/packages/pi-goal) 的取舍。

## 目标

- 用户显式进入 Goal 模式后，目标可以跨多个 turn 自动推进，不需要反复输入“继续”。
- 目标、累计耗时、Token 用量、停止原因和安全状态都持久化到线程事件中。
- 用户始终可以暂停、继续、编辑或删除目标。
- 模型只能在完整审计后把 active Goal 标记为 `complete`；暂停、继续和删除归用户/runtime 控制。
- runtime 重启、取消、provider 错误或无进展循环不能静默恢复成无限自动执行。

## 非目标

- 普通单轮请求不会因为任务复杂而自动变成 Goal。
- 本地产品不提供 Goal Token 预算设置、预算进度或预算耗尽续轮策略。
- Goal 不是并行任务队列；一个线程同一时间只有一个当前 Goal，新 Goal 会显式替换旧 Goal。

## `pi-goal` 对齐结论

调研基线是 `pi-goal` 0.1.7。它的核心不是 `/goal` 命令本身，而是以下闭环：持久化单一目标、显式创建/替换、受限模型工具、turn 结算、空闲续轮、用户控制和 reload 后暂停。

| 语义 | Setsuna Desktop |
| --- | --- |
| 单线程单 Goal，创建可替换 | 对齐；每次替换生成新的 `goal.id` |
| `create_goal` 仅响应显式 Goal 请求 | 对齐；工具说明与 `goal-writer` Skill 同时约束 |
| active 时暴露 `get_goal` / `update_goal` | 对齐；非 active 只保留 `create_goal` |
| `update_goal` 只能提交 `complete` | 对齐 |
| 完成前按真实证据审计 | 对齐；续轮 prompt 明确要求逐项映射证据 |
| 紧凑状态与最终用量 | 语义对齐；过程状态只进线程投影，退出后才写一次精确用量总结 |
| 最终 turn 仍计入用量/耗时 | 对齐 |
| reload 不静默续跑 | 对齐；恢复为 `paused(runtimeReloaded)` |
| Token 预算 | 有意不对齐；产品不展示、不接受 Goal tool 预算，也不按预算停止 |
| 无限循环保护 | 本地加强；连续 3 轮无新证据或 25 个自动轮次后进入 `blocked` |

旧数据和 AppServer contract 中的 `tokenBudget` / `budgetLimited` 字段暂时保留为读取兼容面；新 Goal 固定写入 `tokenBudget: null`，renderer 不展示，自动续轮也不执行预算判断。删除兼容字段需要独立迁移，不与本次行为改动混在一起。

## 数据模型

`RuntimeThreadGoal` 是线程投影的一部分：

- `version`、`id`：识别持久化版本和替换边界；旧 Goal 在恢复时补齐。
- `objective`、`status`：当前目标与生命周期状态。
- `tokensUsed`、`timeUsedSeconds`：完成 turn 的累计计量。
- `stopReason`：暂停、取消、reload、provider 限制、runtime 错误或安全保护的结构化原因。
- `safety`：自动轮次数、连续无进展次数和最近进展指纹。
- `execution`：初始附件、Skill、thinking 配置和 source message，供后续续轮复用。

Goal 仍以 append-only `thread.goal_updated` / `thread.goal_cleared` 事件为真源。`goal.id` 让旧 turn 的迟到结算无法覆盖已经替换的新 Goal。

## 生命周期

| 当前状态 | 用户动作 | 下一状态 | runtime 行为 |
| --- | --- | --- | --- |
| 无 Goal | 创建 | `active` | 写状态，线程空闲时启动首轮 |
| 任意 Goal | 创建新 Goal | `active`（新 ID） | 取消旧 Goal turn，替换状态并重新开始 |
| `active` | 暂停 | `paused` | 写 `userPaused`，取消 active Goal turn |
| `paused` / `blocked` / `usageLimited` | 继续 | `active` | 清除停止原因与安全计数，启动续轮 |
| 非 `complete` | 编辑 | 状态不变 | 保留 ID、累计计量、创建时间和 execution；下一轮按新 objective 执行 |
| 任意 Goal | 删除 | 无 Goal | 取消 Goal turn，只写 clear 事件，不保留 transcript 墓碑 |
| `active` | 模型完成审计 | `complete` | 停止续轮，最终 turn 结算后写一次退出总结 |
| `active` | runtime reload | `paused` | 写 `runtimeReloaded`，等待用户继续 |
| `active` | 连续无进展/轮次上限 | `blocked` | 写结构化 stop reason，不再自动续轮 |

`blocked` 是可恢复状态，不代表 Goal 已删除。用户确认新条件后可以继续，也可以编辑或替换目标。

## 自动续轮与优先级

每个 Goal turn 结束后，协调器重新读取线程投影、结算该 turn 的时间和 Token，并判断是否继续。续轮只在以下条件同时成立时创建：

- Goal 仍是同一个 `goal.id` 且状态为 `active`；
- 线程没有 active task；
- 没有显式 queued input；
- runtime 未关闭，线程未进入删除屏障；
- 安全保护没有把 Goal 转成 `blocked`。

显式用户输入优先于后台 Goal。普通消息可以在 Goal turn 的安全检查点作为 steer 消费；新 Goal 保持独立轮次语义。

进展指纹只使用成功的非 Goal tool 结果。没有工具证据，或连续重复相同工具参数与结果，都算一轮没有新证据。这个规则宁可暂停让用户判断，也不允许模型用重复文本维持无限循环。

## 模型上下文与工具

每个自动续轮注入两条仅对模型可见的消息：

1. developer policy：说明继续规则、真实证据审计和唯一完成入口。
2. synthetic user context：携带当前 objective 和累计用量。

开始、继续、暂停和恢复只更新 Goal 状态，不再生成 transcript 消息。完成、阻塞或用量受限后，runtime 才把已经结算最终 turn 的 Token 与耗时写成结构化退出数据；renderer 将它合并到该 turn 的最后一条助手消息，该数据不进入模型窗口。删除 Goal 不生成退出数据。工具暴露规则：

- 无 active Goal：`create_goal`。
- active Goal：`create_goal`、`get_goal`、`update_goal`。
- `create_goal` 是 replace/upsert；必须来自用户显式 Goal 请求。
- `update_goal` 只接受 `{ status: "complete" }`。

内置 `skills/goal-writer/` 帮助模型把显式请求改写成经压缩后仍可执行、可验证的目标，并明确禁止补入 Token 预算。

## Renderer 交互

当前 Goal（除 `complete`）显示在输入框上方的常驻状态栏：

- 状态与单行 objective；
- 累计耗时，active turn 期间每秒更新；
- 编辑按钮，打开 textarea 弹窗并通过现有 `setThreadGoal` 更新 objective；
- active 时显示暂停，其他可恢复状态显示继续；
- 删除按钮清除 Goal。

开始、继续、暂停和恢复不在 transcript 留行。Goal 完成、阻塞或受用量限制后，在最后一条助手消息末尾追加一行准确耗时和 Token；删除 Goal 不留任何总结。线程总用量继续由“用量与诊断”展示。

## 错误与恢复

- renderer i18n 对未知动态 key 回退为 key 文本，不能再因单个缺失翻译触发整页 `undefined.replace` 崩溃。
- runtime 启动完成旧 turn 收尾后统一执行 Goal reconcile；旧 active Goal 转为 paused。
- provider usage/quota 错误进入 `usageLimited`，其他 runtime error 进入 `blocked`，错误内容写入 `stopReason`。
- 取消 active Goal turn 进入 `paused(turnCancelled)`；用户主动暂停使用 `userPaused`。
- 清除或替换时通过 Goal ID 绑定忽略旧 turn 的迟到结算；编辑后再用 objective
  绑定拒绝旧采样轮次完成或替换新版 Goal，旧轮次只保留已经产生的耗时和用量。

## 验证覆盖

- contract/store：Goal identity、stop reason、safety 和退出 notice 的 clone/projection，并兼容读取旧 lifecycle notice。
- runtime integration：自动续轮与最终计量、取消暂停、用户 steer、编辑保留状态、reload 暂停、无进展保护、队列 Goal 替换。
- renderer unit：状态栏耗时、继续/编辑/删除操作、退出数据合并到助手文本、旧过程及 cleared notice 隐藏和缺失 i18n key 不崩溃。
- Skill：`quick_validate.py` 校验 frontmatter 和 interface metadata；registry integration 负责实际发现与加载。

## 相关文件

- `packages/contracts/src/threads.ts`
- `packages/desktop-runtime/src/loop/lifecycle/runtime-goal-coordinator.ts`
- `packages/desktop-runtime/src/loop/lifecycle/runtime-goal-state.ts`
- `packages/desktop-runtime/src/loop/lifecycle/runtime-goal-prompts.ts`
- `packages/desktop-runtime/src/loop/lifecycle/runtime-goal-tools.ts`
- `apps/desktop/renderer/src/features/chat/composer/ChatGoalStatusBar.tsx`
- `apps/desktop/renderer/src/features/chat/conversation/chatMessageDisplay.ts`
- `apps/desktop/renderer/src/features/chat/goalFormatting.ts`
- `skills/goal-writer/SKILL.md`
