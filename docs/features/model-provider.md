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
          @earendil-works/pi-ai 1.3.0
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
| `pi-stream-recovery.ts` | 缺失结束标记时的有限重试、部分输出保护和可取消退避 |
| `provider-catalog.ts` | 窄注册表筛选 Pi built-in 厂商/方案/模型，并恢复预置模型 compat metadata |
| `remote-model-catalog.ts` / `remote-model-catalog-data.ts` | 远程目录校验、按厂商更新、缓存恢复及内存合并 |
| `model-discovery.ts` | 模型列表、能力解析、请求取消和超时上限 |
| `pi-request-preparation.ts` / `pi-provider-stream.ts` | 普通采样和原生压缩共享的 defaults、回放转换、兼容参数及 Pi stream |
| `responses-native-compactor.ts` | V2 trigger、完整原始事件收集与按连接身份缓存的协议选择 |
| `responses-compactor.ts` / `responses-compaction-result.ts` | 独立 `/responses/compact` 兼容路径、canonical output 校验与 usage |
| `model-request-timeout.ts` | 单次请求总超时与取消 |
| `provider-request-headers.ts` | 合并用户请求头或厂商预置，填入应用版本和会话 ID |

预置厂商从 Pi provider factories 建立仅包含下列三种 API 的窄注册表，避免把 AWS、Google 等未支持协议的 SDK 打进桌面 runtime；自定义兼容服务直接使用对应 adapter：

- `@earendil-works/pi-ai/api/openai-completions`
- `@earendil-works/pi-ai/api/openai-responses`
- `@earendil-works/pi-ai/api/anthropic-messages`

直接调用 provider/API stream 前，统一通过 Pi `normalizeContext()` 把系统提示词和工具声明转换为 transcript system message；不把 Pi transcript 类型扩散到共享 contracts 或持久存储。

Setsuna provider ID 是配置和 metadata 身份。预置配置的 Pi model 保留 `deepseek`、`openrouter`、`openai`、`anthropic` 等真实 provider identity 和模型 compat；自定义配置使用 canonical `openai`/`anthropic` fallback。

Pi 目录升级不改写已保存连接的协议和地址。若厂商已切换协议（例如 Kimi Code），旧连接仍使用原协议的通用 adapter；OpenCode Go 的历史 `/zen/go` 地址继续识别为该厂商，保留会话请求头。Pi 报告工具参数 JSON 无效时终止该次采样，不把其空对象占位值作为有效工具调用执行或保存到回放 metadata。

思考参数以选中模型的能力为准。OpenAI 兼容协议保留用户填写的 effort 字符串（包括 `none`），只去除首尾空白，由供应商校验取值，不按 SDK 的类型枚举静默过滤。自定义 OpenAI 连接关闭思考时，精确匹配 OpenAI 目录或用户声明 `none` 的模型显式发送关闭参数，模型设置中的思考能力关闭也不丢失这个语义；其余未知模型不推断关闭值。不支持思考且没有明确关闭值的模型不发送思考控制。自定义 Anthropic 连接中精确匹配目录的模型复用思考模式、effort 映射和温度约束，不继承厂商请求头或原生工具能力。标题请求优先关闭思考，目录标记无法关闭的模型保留其默认模式。未知模型别名明确拒绝旧式 `enabled` 时改用 adaptive，拒绝 `disabled` 时省略思考控制；兼容重试覆盖 HTTP 参数错误和 HTTP 200 后 SSE 中的 `invalid_request_error`，仅发生在没有输出时，保留结构化输出 schema 和已选 effort。压缩使用压缩模型配置中的思考能力与默认 effort，不受聊天输入框的思考开关影响；其请求共用同一适配与兼容重试链路。

模型采样与原生压缩保留单次请求 15 分钟总超时，用户取消会立即中止等待。流式请求不再按 SDK 输出事件设置空闲超时：首个事件较慢、思考期间没有输出或心跳未透传为 SDK 事件，都不能单独触发轮次失败。该上限针对每次模型请求，不是整个任务的运行时长。

三种采样协议均启用 Pi 的请求重试：连接失败、HTTP 408/409/429 和 5xx 等临时错误最多重试 3 次，使用可取消的指数退避，并遵循服务端重试提示（单次等待上限 60 秒）。重试共享同一次采样的上下文、会话身份与总超时，期间不结束轮次或重新执行已完成的工具。

响应缺失协议结束标记（例如 `Stream ended without finish_reason`）时，如果尚未输出正文或工具调用，允许在同一采样内额外重试最多 2 次，分别等待 1 秒和 2 秒；思考输出不阻止恢复。失败尝试的思考条目标记为失败并保留，同时发布重试提示；只有成功尝试的 metadata 用于后续模型回放。重试与退避共享原有 15 分钟总超时，并响应用户取消。已经开始输出正文或工具调用、其他类型错误或重试耗尽时，仍向上层报告失败，避免重复输出或错误执行不完整的工具调用。

### Renderer

`packages/features/model-provider/src/renderer/` 持有 provider settings state、Pi 目录 typed client、自动保存、模型发现和 `model-provider` 设置视图。Host 设置页只负责 contribution 布局与品牌图标渲染，不再拥有 provider CRUD controller。

预置服务的主流程是厂商、接入方案、API Key 和模型目录；协议、Base URL、代理、请求头、图标与模型 token/capability override 位于高级配置。预置和自定义服务都提供同步模型和手动添加模型入口，目录外的型号沿用当前厂商和接入方案。选择“自定义兼容服务”后展开协议和 URL。

厂商下拉框的选项和当前选中值共用宿主品牌图标，根据目录厂商名称、ID 与接入地址匹配；不受正在编辑的服务名称或自定义头像影响。“自定义兼容服务”使用通用服务器图标。图标通过共享 Select 的独立装饰槽渲染，不进入键盘输入匹配和选项名称。

`state` 是设置草稿，`confirmedState` 是最近成功保存的配置。只有已确认的 Provider projection 合入共享 `RuntimeConfigState`，供聊天模型选择和 Core task-model 设置读取；写 provider 配置只走 Feature operation。service 持有 450ms 防抖、串行保存与离页 flush；同一版本的在途保存复用，旧回包不覆盖新草稿。保存失败后保留输入（包括未提交密钥），常驻 `ModelProviderSaveFeedback` 显示可重试、手动关闭的 Toast，离开设置不撤下，成功后清除。

同步模型时，runtime 从已加载的内置与缓存目录补齐接口未返回的上下文窗口、输出上限、思考档位和图片能力，不额外刷新目录或增加启动等待。已指定或唯一识别厂商的连接只查该厂商；自定义网关按完整模型 ID 精确匹配，多个目录记录的能力必须一致才使用，未知型号、别名及有歧义的记录不推断。接口明确返回的能力值优先于目录，包括 `false` 和空思考档位列表；只返回默认思考档位时，补全的档位列表会包含该默认值。补全不改变连接协议、厂商身份、请求头或模型 ID。确认同步时保留已有模型的名称与能力配置，仅补缺失字段，因此已保存的 `false` 和空档位列表也不会被目录覆盖。

同步结果与目录添加复用 `ModelPickerDialog`，默认不勾选，支持按名称/ID 搜索、单选、多选、全选搜索结果和清空选择。确认时仅合并勾选的模型；未勾选或接口未返回的已有模型保持原配置和顺序，重复同步同一远端模型 ID 不新增副本。同一 `code` 下的本地配置逐条补齐缺失能力，各自的配置 `id`、启用状态和覆盖值保持不变。原来没有启用模型时才启用首个新增模型。取消不会修改配置。

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

可选 `catalogProviderId` 记录 Pi built-in provider identity。历史配置缺少该字段时，runtime 和 renderer 用协议和规范化 Base URL 做唯一匹配以恢复 Pi compat 和预置配置；无法唯一匹配或显式切换到自定义服务时仍按自定义服务处理。API key 输入框的值只保存在 `secrets.json`。切换厂商或接入方案仅更新目录身份、协议与 Base URL，保留已有模型、已保存或正在输入的 API Key、自定义请求头、显示名称、图标和代理配置，复用普通编辑的自动保存链路。未自定义的请求头仍跟随所选厂商的预置。切换到“自定义兼容服务”保留当前连接和生效的请求头。

`requestHeaders` 保存在 `config.json`，通过设置投影供用户编辑。省略该字段表示使用厂商预置，显式空对象表示取消预置头；用户提供的 map 完整替换预置并覆盖同名 SDK 请求头。保存输入中省略字段保留原值，传 `null` 恢复默认。高级设置使用名称和值分列的可增删行编辑器；空白新行不写入配置，删除全部请求头保存空对象，恢复默认则重新使用厂商预置。校验名称、重复头和非法控制字符，非法或未完成的编辑留在本地草稿，合法编辑复用自动保存；保存后的规范化不会替换正在输入的行或打断焦点。

Chat Completions 厂商的高级配置提供 `Developer role`（自动 / 启用 / 禁用），保存为可选 `supportsDeveloperRole`。默认沿用 Pi 的目录和域名判断；显式布尔值覆盖该能力，禁用时将合并的 system/developer 指令以 `system` 发送，不改变模型思考能力。启用仍遵循 Pi 的 reasoning 模型条件。保存输入省略字段保留原值，`null` 恢复自动。该设置对 Responses 和 Anthropic 协议不生效。

`FileConfigStore` 继续拥有 `config.json`/`secrets.json` 的锁与原子写入。Feature host 暴露 provider 查询/保存、按 proxy route 解析的 fetch 和原生剪贴板写入；已保存的 API key 不进入 renderer state。

API Key 输入框右侧提供复制按钮，优先复制当前输入，否则复制该服务已保存的密钥。`model-provider.api-key.copy` 通过已认证的 native bridge 直接写入系统剪贴板，仅返回成功状态；复制不会保存输入草稿。按钮在无密钥时禁用，成功后短暂显示对勾，失败显示可重试提示。

同一输入框的清除按钮同时清空输入草稿和已保存标记，通过自动保存提交 `clearApiKey: true`，从 `secrets.json` 删除该服务的密钥。手动留空仍保留已保存密钥。清除沿用串行保存和页面离开时的 flush，较早的在途保存不能覆盖清除意图；随后输入新密钥会改为保存新值。

连接配置底部左侧展开高级配置，右侧“测试连接”复用模型发现接口，以当前表单的地址、协议、代理、请求头和密钥草稿请求模型列表；密钥留空时由 runtime 使用已保存值。明确清除后，测试连接和同步模型均携带 `clearApiKey: true`，即使自动保存尚未完成也不回退到旧密钥；该请求标记本身不修改持久化配置。测试只反馈连接结果，不同步模型或保存配置；编辑连接或离开页面会取消测试并忽略过期结果。沿用模型列表请求的 10 秒超时，不创建对话或发起模型生成。

## Replay metadata

新请求只写 `schemaVersion: 3`：

- `source`：Setsuna provider ID/kind、model、endpoint fingerprint。
- `semanticFingerprint`：由 runtime 在 assistant 完成时绑定。
- `assistantReplay.blocks`：text、thinking/signature、tool call/item ID。
- `openAiResponsesCompaction.items`：完整 Responses replacement；可选 `mode` 区分 V2 trigger 和独立 compact，缺省兼容旧数据。

只有 source 和 semantic fingerprint 都匹配时才恢复签名或 native item；否则退回 portable text/thinking/tool calls。历史 v2 Anthropic/Responses envelope 仍只读兼容。

所有 metadata 经过 JSON 清洗、2 MiB 单消息上限和持久化预留检查，不保存 header、API key 或完整 raw response。

## 请求头与会话身份

`ModelRequest.sessionId` 表示稳定的对话或独立任务身份，Pi 采样优先使用该字段，旧调用可回退到 `stepSnapshot.threadId`。主对话、工具续跑、标题、压缩、记忆提取、自动审批和图片识别使用所属线程 ID；独立记忆整合、提交信息生成和图片识别测试在任务开始时确定自己的 ID，并在多轮采样及内部重试中复用。

OpenCode Go 的默认请求头在 Feature contracts 中定义为 `User-Agent: setsuna-desktop/{{appVersion}}` 和 `x-opencode-session: {{sessionId}}`。高级设置显示这些默认值，用户可以修改、删除或恢复默认。其他厂商使用相同的自定义请求头能力。

`PiModelClient` 在共用 fetch 边界解析这两个占位符，三种协议及 `/responses/compact` 使用相同处理。模型列表同步也复用请求头 helper，但没有所属对话，因此跳过包含 `{{sessionId}}` 的请求头。版本由 Electron `app.getVersion()` 经 `SETSUNA_DESKTOP_APP_VERSION` 传入 runtime host，直接嵌入 runtime factory 的源码调用默认标识为 `dev`。

## Compaction

所有协议支持 portable summary；显式配置压缩任务模型时只走该模型的摘要路径。
否则 OpenAI Responses 优先尝试 V2 原生压缩，成功时不额外调用文本摘要模型：

1. 普通采样和压缩共用 `preparePiRequest`、`streamForProvider`，携带当前完整指令、工具、附件和回放状态。
2. 在实际 Responses payload 的 input 最后追加 `compaction_trigger`，取消普通回答的输出格式和工具选择约束。
3. 通过 Pi 原始事件 hook 收集压缩项和 usage，必须有 `response.completed` 且恰好一个可回放 `compaction` item。
4. 写入 v3 `openAiResponsesCompaction`，V2 模式由 runtime 保留预算内的用户原文。
5. 同 replay boundary 才原生续写。新的原生检查点记录归档原文 ID；边界变化时 runtime
   先恢复原文，再按新模型窗口决定是否生成文本摘要。已有 portable summary 保持可跨模型使用。

仅明确的协议不支持才降级到 `{baseUrl}/responses/compact`。独立接口复用 Pi 的
`convertResponsesMessages`，首次降级使用 V2 已捕获的 input，之后完整保存和回放返回的 canonical window。
包含 `configuration_update` 的历史不使用独立接口；不静默删除动态配置。协议能力缓存按 provider、model、endpoint、
凭据、请求头及代理配置身份隔离，仅请求时建立，没有启动探测。

鉴权、限流、传输错误、残缺流及非法结果直接失败；明确的 context overflow 返回独立状态，由 runtime
采用完整分批摘要，不污染能力缓存。usage 在结果校验之前报告，即使候选最终丢弃也保留实际消耗。
整个压缩操作共享取消和 15 分钟截止时间，协议切换或追加批次不重置截止时间。
摘要生成预算包含 reasoning tokens，按实际摘要模型的输入、窗口及输出上限计算；最终保存的文本长度单独限制。
设计、实施阶段与真实供应商评测门槛见 [上下文压缩执行方案](../designs/current/context-compaction.md)。

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
- `packages/features/model-provider/test/runtime/responses-native-compactor.test.ts`
- `packages/desktop-runtime/test/integration/runtime-server/rest-config-models.test.ts`
- `packages/desktop-runtime/test/adapters/model/image-asset-resolving-model-client.test.ts`
- `packages/contracts/test/message-metadata.test.ts`
- AgentLoop history、tool continuation 与 context compaction integration。


服务操作菜单支持复制配置和删除。复制生成新的 provider ID，保留协议、模型列表及普通配置，但清空 API Key presence/preview 和自定义请求头；副本默认关闭，原活动模型不变。服务顺序在左侧列表拖动调整，复用应用侧栏的拖动预览与占位让位；拖动期间不保存，松手后通过既有配置保存链路持久化。搜索结果中的移动保留未显示的服务，取消拖动或列表变化时丢弃未提交顺序；聚焦服务后也可用 Alt+上/下调整。高级配置保留连接卡片左下角的原有按钮，与测试连接处于同一行，关闭时保留表单草稿。
