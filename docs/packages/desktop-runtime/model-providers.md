# 模型适配器

源码目录：`packages/desktop-runtime/src/adapters/model/`

模型层把 runtime 的 portable `ModelRequest` 和 stream event contract 适配到不同供应商，同时保留安全、可验证的协议原生续写信息。

## 入口

### `configured-model-client.ts`

`ConfiguredModelClient`：

- 读取 active provider/model config。
- 选择 provider client。
- 处理无可用 provider 的 `TestModelClient` fallback。
- 注入 debug trace。

AgentLoop 只依赖 `ModelClient` port，不判断 provider kind。

### `image-asset-resolving-model-client.ts`

在请求供应商前把 runtime managed image asset 解析为模型可见内容。它不扩大文件访问范围，也不接受任意本地路径。

## Provider clients

### OpenAI-compatible Chat

- `openai-chat-model-client.ts`
- `openai-provider-messages.ts`
- 共用 `provider-http.ts` / `provider-stream.ts`

Portable semantic messages/tool calls/results 转成 `/chat/completions` 语义。未知厂商原始字段不持久化，Chat history 保持 semantic-only。

### OpenAI Responses

- `openai-responses-model-client.ts`
- `openai-responses-extension-fetch.ts`
- `openai-responses-native-events.ts`
- `openai-responses-provider-metadata.ts`
- `openai-responses-tool-arguments.ts`

官方 AI SDK 负责标准 `/responses` request/stream；扩展 fetch/side-channel 处理 SDK schema 外但经过白名单的：

- Encrypted reasoning。
- Commentary/final phase。
- Collab/extra item。
- Native compaction replacement。
- Response ID 和 replay metadata。

Response ID 当前只持久化，不发送 `previous_response_id`。

### Anthropic Messages

- `anthropic-messages-model-client.ts`
- `anthropic-provider-messages.ts`
- `anthropic-native-metadata.ts`

官方 AI SDK 负责 Messages transport。Raw chunk 只用于提取 signed/redacted thinking 和兼容 content blocks；未知 payload 不直接落盘。

## AI SDK bridge

### `ai-sdk-prompt.ts`

统一：

- Semantic messages。
- System/developer instruction。
- 图片。
- Tool schema。
- Tool choice。

### `ai-sdk-stream-bridge.ts`

把 `fullStream` 映射为 runtime：

- Item start/delta/complete。
- Text/reasoning。
- Tool call。
- Usage。
- Done/error。

### `ai-sdk-raw-event-order.ts`

Responses 等扩展事件通过 side-channel 到达时，要在下一个 SDK raw 边界或流结束时释放，保持 provider 源顺序，不能让 native metadata event 超过对应 visible delta。

## 共用 helper

| 文件 | 职责 |
| --- | --- |
| `provider-http.ts` | Endpoint、auth、fetch、HTTP error |
| `provider-stream.ts` | Legacy SSE framing/JSON stream |
| `provider-values.ts` | 不可信 payload 值收窄 |
| `provider-message-content.ts` | 指令和图片内容 |
| `provider-thinking.ts` | Thinking effort normalize |
| `provider-usage.ts` | Usage normalize |
| `provider-replay-context.ts` | Provider/source/semantic compatibility |
| `provider-replay-debug.ts` | 脱敏 replay 诊断 |
| `model-request-timeout.ts` | Request/stream timeout |
| `model-discovery.ts` | 模型列表与 capability |

## Semantic history 与 native replay

Portable history 始终来自 `RuntimeMessage`：

- Text。
- Tool calls。
- Tool results。
- Portable compaction summary。

Native metadata 只有在以下全部匹配时使用：

- Provider ID。
- Provider kind/protocol。
- Model。
- Normalized endpoint fingerprint。
- Semantic fingerprint。

任何不匹配都静默回退 semantic conversion，不能同时发送 native 与 semantic 两份 assistant/tool。

## Metadata 白名单

### Anthropic

保存可验证的 signed/redacted thinking/content blocks；legacy blocks 只在 Anthropic adapter 内兼容。

### Responses

只保存白名单且嵌套结构通过校验的：

- Message/output text/annotation。
- Reasoning/encrypted content。
- Function call。
- Native compact 中必要的 function call output。
- Compaction item。
- Response ID。

合法 `phase` 可保留；非法 phase 或任何 item 无法完整清洗时整条 envelope 降级。

### 限制

- JSON-safe 深拷贝。
- 不保存 headers、API key、request metadata、完整 raw response。
- 单 message metadata 上限 2 MiB。
- 超限省略 metadata，并记录 verification warning。

## Tool call IDs

Provider vendor ID 可能跨轮复用。Runtime 在模型请求副本中：

- 计算 transaction identity。
- 生成 window-unique wire ID。
- 同步改写 result。
- 不修改持久化 portable message ID。

无法消歧的同 transaction 重复 ID 在请求前失败，避免执行错误工具。

## Compaction

所有协议使用 portable summary。

OpenAI Responses 可以额外调用 native compact：

- 输入是真实待替换旧模型窗口。
- 输出完整 replacement item list。
- 保存到 provider metadata。
- 只在同 replay context 使用。

Portable summary由独立摘要请求生成，两者不能互相推导。

## Model discovery

`model-discovery.ts`：

- 拉取 provider 模型列表。
- 归一化 ID/name。
- 推断/读取 thinking efforts、max output、vision。
- 应用 timeout 和 payload limit。
- 返回 contracts 的 capability state。

Renderer provider settings 依赖这里的结果，不应维护另一套厂商模型表。

## Timeout、取消与错误

- 所有 provider request 接受 `AbortSignal`。
- Request timeout 与用户 cancel 可区分。
- HTTP error 截断不可信 body。
- Stream 结束前 flush 有序 side-channel。
- Partial assistant 状态由 AgentLoop termination 结算。
- Usage 缺失时不伪造。

## 新增 provider

1. 扩展 contracts provider kind/capability。
2. 实现 `ModelClient` adapter。
3. 分开 prompt、transport、stream、usage、replay。
4. 在 `ConfiguredModelClient` 注册。
5. 在 discovery 支持。
6. 定义 semantic fallback。
7. 明确 metadata 白名单和上限。
8. 更新 settings/provider branding。
9. 添加 adapter、stream ordering、replay 和 integration tests。

## 测试

- `test/adapters/model/provider-adapters.test.ts`
- `provider-replay-context.test.ts`
- `model-request-timeout.test.ts`
- `image-asset-resolving-model-client.test.ts`
- `test/loop/core/runtime-provider-metadata.test.ts`
- `runtime-model-message-order.test.ts`
- AgentLoop history/compaction integration。
- Contracts `message-metadata.test.ts`。

