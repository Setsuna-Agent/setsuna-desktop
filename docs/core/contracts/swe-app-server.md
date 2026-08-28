# SWE / App-server Contracts

源码：

- `packages/contracts/src/swe-events.ts`
- `packages/contracts/src/swe/`
- `packages/desktop-runtime/src/server/app-server/`

App-server 是与普通 renderer REST 平行的 JSON-RPC/SSE 协议面，用于 Codex/SWE 客户端语义。Contracts 负责把 runtime thread/event 映射为稳定 notification 和 item。

## 目录职责

| 文件 | 职责 |
| --- | --- |
| `swe-events.ts` | 公共门面和兼容导出 |
| `swe/types.ts` | SWE notification/item 基础类型 |
| `swe/mapper.ts` | 总体 event → notification 映射 |
| `swe/mapper-state.ts` | 跨事件映射状态 |
| `swe/mapper-utils.ts` | 共享纯 helper |
| `swe/stream-mapper.ts` | Assistant/reasoning/tool stream |
| `swe/turn-mapper.ts` | Turn 生命周期 |
| `swe/items.ts` | Item 形状与转换 |
| `swe/capabilities.ts` | 客户端 capability 分支 |
| `swe/tool-names.ts` | Runtime tool 与协议展示名 |

## 两个协议面

### Runtime REST / Thread SSE

- 面向本项目 renderer。
- Snapshot + `RuntimeEvent`。
- 使用 thread `seq` 恢复。

### App-server JSON-RPC / notification SSE

- 面向 SWE client。
- 方法、item 和 notification 语义。
- 有独立 connection/session capability。
- Command exec、fs、dynamic tools 有独立生命周期。

App-server mapper 可以读取 runtime event，但 notification 不是新 `RuntimeEvent`，也不写 thread store。

## Mapper state

单个 runtime event 不一定包含生成 SWE notification 所需的全部上下文。Mapper state 可以跟踪：

- Turn/item identity。
- Assistant stream segment。
- Tool call/result pairing。
- Review/collaboration/goal metadata。
- Client capability。

它只能用于协议投影，不能成为业务状态真源。重连/历史投影必须能从 runtime thread/events 重建。

## Stream 映射

需要处理：

- Assistant item start/delta/complete。
- Reasoning/commentary/final phase。
- Tool call 与 output。
- File change。
- Shell/background process。
- Approval / user input。
- Collaboration/mailbox。

Runtime provider 内部 item ID 可能跨 sampling transaction 复用；mapper identity 必须结合 turn/transaction，避免把两次工具调用合并。

## Client capabilities

不同 app-server client 可能支持不同 experimental API。Capability 影响：

- Notification 形状。
- Item 是否拆分。
- Dynamic tools。
- Stream event 粒度。

Capability 分支集中在 `swe/capabilities.ts` 和 server connection registry，不能散落到 runtime AgentLoop。

## Server 实现对应

`packages/desktop-runtime/src/server/app-server/`：

- `rpc.ts` / `dispatcher.ts`：JSON-RPC 分发。
- `thread-protocol.ts`：线程、turn、steer、review。
- `config-protocol.ts`：配置读写、模型、memory 与 sandbox 映射。
- `feature-protocol.ts`：experimental feature 目录、默认值与 enablement。
- `approval-protocol.ts`：审批。
- `command-exec.ts`：command/exec session facade 与兼容导出。
- `process-manager.ts`：process session、background terminal 与连接生命周期。
- `command-process-runtime.ts`：PTY、stdin/output、env 和 termination 共享基础设施。
- `command-sandbox.ts`：权限策略、Seatbelt profile 与 fail-closed spawn 包装。
- `fs-protocol.ts`：文件协议。
- `hooks-protocol.ts` / `skills-protocol.ts`：能力。
- `dynamic-tools.ts`：动态工具目录。
- `connections.ts`：连接 capability/lifecycle。
- `errors.ts` / `input.ts` / `pagination.ts` / `platform.ts`：边界 helper。

协议 handler 做解析和映射；核心行为仍调用 runtime container/AgentLoop。

## 修改规则

新增 app-server 能力时：

1. 确认是否已有 runtime contract/action。
2. 在 contracts 定义 notification/item。
3. 更新纯 mapper 与 capability 分支。
4. 在 server protocol/dispatcher 注册方法。
5. 保持 JSON-RPC error 与 runtime error 的映射。
6. 添加 contracts mapper tests 和 runtime server integration。

不要为 app-server convenience 绕过 event store直接改 thread snapshot。

## 测试

Contracts：

- `packages/contracts/test/swe-events/`
- `support/swe-events.ts`

Runtime：

- `packages/desktop-runtime/test/server/app-server/`
- `packages/desktop-runtime/test/integration/runtime-server/app-server-*.test.ts`
- `test/support/runtime-server/app-server-*`

测试需覆盖历史 projection、live stream、不同 capabilities、connection teardown、approval、file changes、shell 和 collaboration。
