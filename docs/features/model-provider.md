# Model Provider Feature

模型供应商实现位于 `packages/features/model-provider/`。Desktop runtime 只保留稳定的 `ModelClient` port、图片资产解析 wrapper 与 Feature composition 绑定，不再维护协议客户端。

完整迁移决策与验收线见 [Model Provider Feature 与 Pi 协议迁移](../designs/history/model-provider-pi-migration.md)。

## 组装入口

```text
AgentLoop / Review / Vision / Thread title / Memory
                         │
                  ModelClient port
                         │
             ImageAssetResolvingModelClient
                         │
                 BindableModelClient
                         │
        modelProviderSamplingCapability
                         │
       feature-model-provider/runtime
                         │
          @earendil-works/pi-ai 0.85.1
```

`model-provider` 是 required runtime/renderer Feature。Runtime factory 先创建 `BindableModelClient`，Feature 激活完成后把 sampling capability 绑定进去；激活失败不会退回旧协议栈。

## Feature 所有权

### Contracts

`packages/features/model-provider/src/contracts/` 定义 Feature identity、runtime host/sampling capability、provider settings/model discovery typed operations 与 renderer state capability。Pi 类型不得进入这些 contracts、`RuntimeEvent` 或持久存储。

### Runtime

`packages/features/model-provider/src/runtime/` 拥有：

| 文件 | 职责 |
| --- | --- |
| `feature.ts` | 注册 typed operations 并提供 sampling capability |
| `pi-model-client.ts` | Provider 解析、Pi built-in/custom 分发、超时、取消和温度兼容重试 |
| `pi-context.ts` | `ModelRequest`/tool/image/history 到 Pi context，v2/v3 replay |
| `pi-stream-bridge.ts` | Pi stream 到 `ModelStreamEvent`、usage、v3 metadata |
| `provider-catalog.ts` | 窄注册表筛选 Pi built-in 厂商/方案/模型，并恢复预置模型 compat metadata |
| `remote-model-catalog.ts` / `remote-model-catalog-data.ts` | 远程目录校验、按厂商更新、缓存恢复及内存合并 |
| `model-discovery.ts` | 模型列表、能力解析、请求取消和超时上限 |
| `responses-compactor.ts` | 唯一保留的窄原生协议调用：`/responses/compact` |
| `model-request-timeout.ts` | 总超时与 idle timeout |
| `provider-request-headers.ts` | 合并用户请求头或厂商预置，填入应用版本和会话 ID |

预置厂商从 Pi provider factories 建立仅包含下列三种 API 的窄注册表，避免把 AWS、Google 等未支持协议的 SDK 打进桌面 runtime；自定义兼容服务直接使用对应 adapter：

- `@earendil-works/pi-ai/api/openai-completions`
- `@earendil-works/pi-ai/api/openai-responses`
- `@earendil-works/pi-ai/api/anthropic-messages`

Setsuna provider ID 是配置和 metadata 身份。预置配置的 Pi model 保留 `deepseek`、`openrouter`、`openai`、`anthropic` 等真实 provider identity 和模型 compat；自定义配置使用 canonical `openai`/`anthropic` fallback。

### Renderer

`packages/features/model-provider/src/renderer/` 持有 provider settings state、Pi 目录 typed client、自动保存、模型发现和 `model-provider` 设置视图。Host 设置页只负责 contribution 布局与品牌图标渲染，不再拥有 provider CRUD controller。

预置服务的主流程是厂商、接入方案、API Key 和模型目录；协议、Base URL、代理、请求头、图标与模型 token/capability override 位于高级配置。选择“自定义兼容服务”后才展开协议、URL、同步模型和手动模型入口。

Provider projection 仍合入共享 `RuntimeConfigState`，供聊天模型选择和 Core task-model 设置读取；写 provider 配置只走 Feature operation。

## 远程模型目录

每个 runtime Feature 实例持有一个 `RemoteModelCatalog`。启动只读取本地缓存，`GET /v1/features/model-provider/catalog` 返回内置目录与缓存的合并结果。进入厂商设置时通过 `POST /v1/features/model-provider/catalog/refresh` 按需更新；“刷新目录”按钮可强制更新。公开数据来自 Pi CLI 同样使用的 `https://pi.dev/api/models/providers/<厂商 ID>`，保持现有支持的厂商与三种协议范围。

目录更新使用配置连接的代理路由（未保存连接使用全局路由），只发送应用 User-Agent、Accept 和缓存 ETag。模型服务的 API Key 和自定义请求头不发往目录服务。普通刷新间隔为 4 小时，单次请求最多 8 秒，同一厂商的并发刷新合并；失败保留上次有效数据，自动刷新失败后短暂退避，手动刷新可立即重试。

远程记录按模型 ID 覆盖内置记录，同时保留内置目录中其余模型。完整元数据包含 `api`、`compat`、`thinkingLevelMap`、图片能力和 token 上限；设置投影、Pi 采样及原生压缩共享同一份 Provider 列表。目录刷新只更新元数据，不修改用户已选模型、自定义能力值或未保存的设置。

缓存按厂商原子写入 `runtime/features/model-provider/catalog-cache/`，属于可重建数据，不进入用户设置。缓存损坏时回退内置目录，应用版本变化后重新获取；更新会校验字段和响应体积，错误响应不发布部分模型。Feature 关闭时取消进行中的目录请求。

## 配置与 Secret

原磁盘字段和值保持不变：

- `openai-compatible` → Pi `openai-completions`
- `openai-responses` → Pi `openai-responses`
- `anthropic` → Pi `anthropic-messages`

可选 `catalogProviderId` 记录 Pi built-in provider identity。历史配置缺少该字段时，runtime 和 renderer 用协议和规范化 Base URL 做唯一匹配以恢复 Pi compat 和预置配置；无法唯一匹配或显式切换到自定义服务时仍按自定义服务处理。API key 输入框的值只保存在 `secrets.json`，切换厂商会先确认并清除旧端点的凭据、自定义请求头与模型。切换到“自定义兼容服务”保留当前连接和生效的请求头。

`requestHeaders` 保存在 `config.json`，通过设置投影供用户编辑。省略该字段表示使用厂商预置，显式空对象表示取消预置头；用户提供的 map 完整替换预置并覆盖同名 SDK 请求头。保存输入中省略字段保留原值，传 `null` 恢复默认。高级设置按每行 `名称: 值` 编辑，校验名称、重复头和非法控制字符，合法编辑复用自动保存。

`FileConfigStore` 继续拥有 `config.json`/`secrets.json` 的锁与原子写入。Feature host 暴露 provider 查询/保存、按 proxy route 解析的 fetch 和原生剪贴板写入；已保存的 API key 不进入 renderer state。

API Key 输入框右侧提供复制按钮，优先复制当前输入，否则复制该服务已保存的密钥。`model-provider.api-key.copy` 通过已认证的 native bridge 直接写入系统剪贴板，仅返回成功状态；复制不会保存输入草稿。按钮在无密钥时禁用，成功后短暂显示对勾，失败显示可重试提示。

## Replay metadata

新请求只写 `schemaVersion: 3`：

- `source`：Setsuna provider ID/kind、model、endpoint fingerprint。
- `semanticFingerprint`：由 runtime 在 assistant 完成时绑定。
- `assistantReplay.blocks`：text、thinking/signature、tool call/item ID。
- `openAiResponsesCompaction.items`：Responses compact opaque replacement。

只有 source 和 semantic fingerprint 都匹配时才恢复签名或 native item；否则退回 portable text/thinking/tool calls。历史 v2 Anthropic/Responses envelope 仍只读兼容。

所有 metadata 经过 JSON 清洗、2 MiB 单消息上限和持久化预留检查，不保存 header、API key 或完整 raw response。

## 请求头与会话身份

`ModelRequest.sessionId` 表示稳定的对话或独立任务身份，Pi 采样优先使用该字段，旧调用可回退到 `stepSnapshot.threadId`。主对话、工具续跑、标题、压缩、记忆提取、自动审批和图片识别使用所属线程 ID；独立记忆整合、提交信息生成和图片识别测试在任务开始时确定自己的 ID，并在多轮采样及内部重试中复用。

OpenCode Go 的默认请求头在 Feature contracts 中定义为 `User-Agent: setsuna-desktop/{{appVersion}}` 和 `x-opencode-session: {{sessionId}}`。高级设置显示这些默认值，用户可以修改、删除或恢复默认。其他厂商使用相同的自定义请求头能力。

`PiModelClient` 在共用 fetch 边界解析这两个占位符，三种协议及 `/responses/compact` 使用相同处理。模型列表同步也复用请求头 helper，但没有所属对话，因此跳过包含 `{{sessionId}}` 的请求头。版本由 Electron `app.getVersion()` 经 `SETSUNA_DESKTOP_APP_VERSION` 传入 runtime host，直接嵌入 runtime factory 的源码调用默认标识为 `dev`。

## Compaction

所有协议都有 portable summary。OpenAI Responses 额外支持原生 compact：

1. 把真实待替换旧窗口转成 Responses input。
2. POST `{baseUrl}/responses/compact`。
3. 只接受恰好一个可回放 `compaction` item。
4. 写入 v3 `openAiResponsesCompaction`。
5. 同 replay boundary 才原生续写，否则使用 portable summary。

## 新增协议或 Provider

1. 先扩展共享 provider kind/request contract，确认磁盘兼容策略。
2. 在 `piApiForProvider` 与 `streamForProvider` 增加明确映射；不要新建 Core client。
3. 定义 Pi model/context、tool choice、structured output 与 semantic fallback。
4. 明确 replay 白名单、source 边界和 metadata 上限。
5. 更新 Feature model discovery/settings。
6. 添加 context、stream bridge、replay/compaction 与 runtime integration 测试。

## 高收益测试

- `packages/features/model-provider/test/runtime/pi-context.test.ts`
- `packages/features/model-provider/test/runtime/provider-catalog.test.ts`
- `packages/features/model-provider/test/renderer/provider-catalog.test.ts`
- `packages/features/model-provider/test/runtime/pi-stream-bridge.test.ts`
- `packages/features/model-provider/test/runtime/responses-compactor.test.ts`
- `packages/desktop-runtime/test/integration/runtime-server/rest-config-models.test.ts`
- `packages/desktop-runtime/test/adapters/model/image-asset-resolving-model-client.test.ts`
- `packages/contracts/test/message-metadata.test.ts`
- AgentLoop history、tool continuation 与 context compaction integration。
