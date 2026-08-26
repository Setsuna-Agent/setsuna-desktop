# Model Provider Feature 与 Pi 协议迁移执行文档

状态：已实施（包含 Pi 厂商目录与简化配置表单）

目标：在一个完整变更中，用 `@earendil-works/pi-ai` 替换 runtime 自维护的 OpenAI Completions、OpenAI Responses、Anthropic Messages 三套普通采样协议，并把模型供应商管理收拢为一个纵向 Feature。最终不保留 AI SDK、旧采样实现或切换双栈的环境变量。

## 决策摘要

1. 不直接依赖 `pi-agents`。它通过 `pi` CLI/RPC 编排多 Agent 工作流，不是模型协议实现。底层协议依赖锁定为 `@earendil-works/pi-ai` 的精确版本。
2. 新增 required Feature `@setsuna-desktop/feature-model-provider`，只创建 `contracts`、`runtime`、`renderer` 三个真实入口。
3. Core 继续拥有 thread、turn、`RuntimeMessage`、`ModelRequest`、`ModelStreamEvent` 和 `ModelClient` 语义；Feature 只拥有供应商配置用例、模型发现、采样 adapter、回放 codec 和设置视图。
4. Pi 只存在于 Feature runtime 实现中。Pi 类型不能进入共享 contracts、持久事件、SQLite 或 renderer。
5. 普通采样限定为 Pi 的 `openai-completions`、`openai-responses`、`anthropic-messages` 三种 API。Pi 预置服务使用官方 built-in provider/catalog 的模型元数据、compat 与 provider dispatch；历史和自定义服务继续走同 API 的直接 adapter。Setsuna 负责密钥、代理、取消、总超时、空闲超时和配置持久化。
6. `/responses/compact` 没有 Pi 等价能力，因此保留一个只负责 compaction 的窄原生 HTTP adapter；不保留 Responses 普通 streaming/SSE parser。
7. 配置磁盘位置不搬迁。`FileConfigStore` 仍是 `config.json`/`secrets.json` 的物理 owner，Feature 通过窄 host capability 读写，避免新增第二份供应商状态。
8. Provider replay metadata 升级为 Setsuna 自有的通用 v3 block 格式；历史 v2 数据只读兼容，不批量重写数据库。

## 目标结构

```text
AgentLoop / Review / Vision / Thread title / Memory
                         │
                 ModelClient port
                         │
                 BindableModelClient
                         │
        modelProviderSamplingCapability
                         │
packages/features/model-provider
  ├─ contracts  identity、capability、operation、DTO/codec
  ├─ runtime    PiModelClient、stream bridge、replay、discovery、compact
  └─ renderer   provider controller、typed client、settings view
                         │
             @earendil-works/pi-ai
```

`model-provider` 是 required Feature。它或其必需依赖激活失败时 runtime/renderer 不进入 ready，不能退回旧实现。

## 所有权与依赖

### Core 保留

- `packages/contracts`：`RuntimeMessage`、`RuntimeEvent`、`ModelRequest`、`ModelStreamEvent`、provider 公共 DTO 与持久 metadata schema。
- `packages/desktop-runtime/src/ports/model-client.ts`：Agent loop 使用的稳定端口。
- `FileConfigStore`：配置/secret 文件的锁、原子写入、权限和其他 Core 配置。
- `ImageAssetResolvingModelClient`：本地生成图片解析是 runtime 基础设施，不属于远端供应商协议。
- Agent loop 的 usage、事件先落盘再发布、取消、审批、上下文压缩和工具执行语义。

### Feature 拥有

- provider CRUD、激活、模型列表发现和相应 typed operation。
- 从 provider 配置到 Pi `Model`/`Context`/`Tool` 的转换。
- 从 Pi stream 到 `ModelStreamEvent` 的转换。
- provider replay metadata 的写入和恢复。
- OpenAI Responses 原生 compaction。
- renderer 的本地模型设置页、编辑/自动保存/模型发现 controller。

### 宿主注入

Runtime host capability 只提供：

- provider state/config 查询与保存；
- 按 provider ID 解析 API key；
- 按 proxy route 获取 `fetch`。
- 向宿主的可选会话调试 sink 上报回放决策，不直接依赖 Conversation Debug Feature。

Feature 不导入 `desktop-runtime` 实现。其他 Feature 只能从 `model-provider/contracts` 依赖采样 capability，不能导入其 runtime 实现。

## 配置兼容

本次迁移以兼容现有用户数据为硬门槛，不把字段重命名和协议替换同时放大为无收益的全仓库 DTO 改写：

- 磁盘 schema 保持现有 provider 字段及三个稳定值：`openai-compatible`、`openai-responses`、`anthropic`。
- Feature 内部在单一函数中映射为 Pi API：
  - `openai-compatible` → `openai-completions`
  - `openai-responses` → `openai-responses`
  - `anthropic` → `anthropic-messages`
- provider ID、active provider、模型引用、图标、base URL、代理路由和 API key 均不迁移、不改名。
- 新增可选 `catalogProviderId`，只记录 Pi built-in provider 身份。旧配置缺失该字段时，runtime 用协议与 Base URL 的唯一匹配恢复 Pi compat，renderer 再结合模型目录无损识别预置厂商；无法唯一匹配时保持自定义配置语义。
- provider 写操作改由 Feature typed operation 承担；Core `/config` 在本次变更中继续承载其余 runtime preferences，避免同时重构所有 Core config 消费者。

不将 `provider` 重命名为 `api`：现有值已经是持久公共 contract，改名对替换协议实现没有直接收益，却会扩大 WebDAV、app-server、usage、task model 和历史数据兼容面。

## Pi 采样适配

### Model 构造

每次采样根据已解析的 runtime provider 构造 Pi `Model`。预置服务先从 Pi built-in catalog 取得原始模型；同步到静态目录之外的新模型时则从同 provider/API/方案模板继承 provider identity、compat 与 headers，再叠加用户允许覆盖的 base URL 与模型配置。自定义服务构造等价的最小 Pi model。

采样显式传入：

- Pi provider identity、Pi API 名称、model ID、base URL；
- 输入能力、context window/max tokens 及必要 compat flags；
- 由 Setsuna secret store 解析的 API key；
- `networkProxyFetch.forRoute(provider.proxyRoute)`；
- caller abort signal；
- `maxRetries: 0`，避免 Pi 与 Setsuna 双重重试。

预置服务通过 Pi built-in `Models` collection 分发到厂商自有 adapter，并显式传入 Setsuna secret store 的 API key 与 proxy-aware fetch；不使用 Pi credential store。自定义服务使用三个直接 API 入口。两条路径都只接受本 Feature 支持的三种协议，不把 Pi 的其他协议隐式暴露给现有 runtime contract。

### Request 转换

- system/developer 消息按原顺序进入 system prompt。
- user 文本和图片转为 Pi user content。
- exact provider/model/endpoint 边界内的 assistant replay signature、signed thinking、可见文本和 tool calls 转为 Pi assistant content；语义降级只回放可见正文与 tool calls，不跨模型泄露隐藏 reasoning。
- tool result 保持 call ID 关联；无法精确 replay 时使用语义内容。
- Setsuna JSON Schema 以不改写 schema 的 TypeBox unsafe wrapper 传给 Pi Tool。
- `auto`、`none` 和 named tool choice 在三个 API adapter 中分别转为原生选项。
- structured output 通过 `onPayload` 分协议注入，保持现有 response format contract。

### Stream 转换

Pi event 映射为现有 item lifecycle：

| Pi event | Setsuna event |
| --- | --- |
| `text_start/delta/end` | `agent_message` item started/delta/completed |
| `thinking_start/delta/end` | `reasoning` item started/delta/completed |
| `toolcall_start/delta/end` | tool-call item lifecycle、arguments delta、最终 tool calls |
| terminal assistant message | assistant metadata、usage、done |
| error/abort | 抛出归一化 Error/AbortError，由 AgentLoop 处理 |

Responses 原生的 `safety_buffering`、`model_verification` 和独立 summary/raw 诊断不再模拟。它们没有下游业务 owner；保留整套手写 SSE parser 只为这些事件会抵消迁移价值。普通 reasoning、tool call、usage、response ID 和 replay 仍保留。

### 超时与重试

- 保留 Setsuna 的总超时和 idle timeout wrapper；Pi 自带 timeout 不等价于 idle 语义。
- provider adapter 首次请求不自行重试。
- 只有尚未发布可见事件且错误可判定为 temperature 不兼容时，保留一次无 temperature 重试。
- abort 必须一路传到 Pi 和自定义 fetch。

## Replay metadata v3

新增与第三方库解耦的持久格式：

```ts
type ProviderReplayMetadataV3 = Readonly<{
  schemaVersion: 3;
  source: {
    providerId: string;
    providerKind: ModelProviderKind;
    model: string;
    endpointFingerprint: string;
  };
  semanticFingerprint: string;
  assistantReplay?: {
    responseId?: string;
    blocks: readonly (
      | { type: 'text'; text: string; signature?: string }
      | { type: 'thinking'; text: string; signature?: string; redacted?: boolean }
      | { type: 'tool_call'; id: string; name: string; arguments: unknown; itemId?: string; thoughtSignature?: string }
    )[];
  };
  openAiResponsesCompaction?: {
    responseId?: string;
    items: readonly unknown[];
  };
}>;
```

- 新采样只写 v3。
- v2 Anthropic content blocks、Responses items/compaction 继续由 legacy decoder 读取并转换。
- source 与 semantic fingerprint 均匹配才恢复签名/原生 item；否则退化为可见文本和 tool calls。
- metadata 继续执行 JSON 清洗、深度/体积限制；Responses v2/v3 envelope 还要通过共享的 item 白名单和 compaction 数量约束。
- compaction payload 作为 opaque provider data 保留在专有字段，不伪装成普通 assistant message；合法的 user `input_image`/`input_file` 会原样安全回放。

## Renderer Feature 化与简化配置

- 将 `apps/desktop/renderer/src/features/settings/providers` 的 provider UI/controller 迁入 Feature renderer。
- Feature 注册 `model-provider` settings view，并自己调用 typed provider operations。
- 设置页宿主只提供标准 `SettingsViewUi`、品牌图标渲染和 operation transport，不传 provider CRUD callbacks。
- Feature 通过只读 typed operation 暴露经过筛选的 Pi built-in 厂商目录：只包含具有 API key auth、具体 HTTP URL 且协议在本 Feature 支持范围内的方案。
- 默认流程固定为“选择厂商 → 必要时选择接入方案 → 填 API Key → 从 Pi 目录添加模型”。预设厂商不在卡片头部渲染可能包含数十项的模型下拉，而是通过可搜索、多选、批量确认的目录弹窗添加；协议、Base URL、代理、显示名称、图标和模型 token/capability override 收入高级配置。
- 自定义兼容服务继续显示协议、Base URL、模型同步和手动模型编辑，不牺牲已有兼容能力。每次模型同步成功获取结果后都必须展示当前列表与同步后列表的对比确认，只有用户确认才完整替换当前模型列表；结果相同或当前列表为空也不跳过确认。
- 视觉结构保留原设置页的服务 rail、服务 header、连接卡片和模型表格；通过 settings view 的 `wide` 布局契约使用 1120px 宽版画布，模型内部字段只在紧凑的独立编辑弹窗中出现，不平铺进模型列表。宿主通过 `SettingsViewUi.Dialog` 提供唯一的设置弹窗外壳，统一遮罩、标题、关闭、密度、滚动、footer 和焦点行为；模型编辑、厂商目录与品牌图标选择只维护各自的业务内容。思考档位使用可多选的预设标签、受已选项约束的默认档位和补充式自定义入口，不要求用户编辑逗号字符串。服务标题图标和模型行图标继续作为编辑入口，宿主通过 Feature capability 注入原有的自动识别、完整品牌宫格和自定义上传选择器。
- provider/model 只读 catalog 作为 renderer capability 提供给聊天模型选择和任务模型设置；在切换完消费者前不能删除 Core config 中的 provider projection。
- provider 样式迁入 Feature scoped CSS；Core 设置页只保留布局 token，不保留 provider 业务样式。

## 删除清单

完成替换后删除：

- `ai`、`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/openai-compatible`；
- AI SDK model client、prompt builder、stream bridge、raw event ordering；
- 手写 OpenAI chat、Responses streaming/SSE、Anthropic streaming clients；
- 仅服务旧 streaming 实现的 provider message/parser/replay helper；
- `SETSUNA_USE_LEGACY_OPENAI_COMPATIBLE_ADAPTER` 及对应分支；
- 只验证已删除实现内部细节的测试。

保留或迁移：

- model request timeout；
- response format contract；
- provider source/semantic fingerprint；
- Responses compact；
- model discovery；
- image asset resolving wrapper；
- 对外错误归一化和 surviving behavior tests。

## 实施顺序

下面只是同一变更内的施工顺序，不定义可发布中间态：

1. 建立 Feature package、contracts、host capability 和 composition 静态图。
2. 引入精确版本 Pi 依赖；实现 message/tool/request 和 stream bridge。
3. 绑定 required runtime sampling capability，切换 AgentLoop、Review、Vision 等真实消费者。
4. 实现 provider operations/model discovery，迁移 renderer provider 设置并注册 `model-provider` view。
5. 写入 replay v3，保留 v2 decoder；把 Responses compact 收窄到独立 native adapter。
6. 删除旧 clients、旧 tests、AI SDK 依赖和 legacy flag。
7. 更新模块文档、Tree 和第三方声明，运行完整验收。

任何步骤发现 Pi 无法满足下方保留语义时，优先修复 Feature adapter；不恢复双栈。只有 `/responses/compact` 属于已批准的窄例外。

## 高收益验证

聚焦测试覆盖：

1. 三种 API 各一组 text + thinking + tool call + tool result + continuation + usage。
2. OpenAI-compatible partial tool arguments 与 reasoning signature replay。
3. Anthropic signed/redacted thinking replay。
4. Responses response/item ID、phase、encrypted reasoning 和 native compact。
5. 三种 structured output payload。
6. proxy fetch、abort、idle timeout 和无可见输出时的 temperature retry。
7. 历史 v2 metadata 读取与新 v3 round trip。
8. Pi built-in catalog 投影、provider identity 持久化、简化选择流程、自动保存、模型发现、active provider，以及自定义模型弹窗的确认后提交语义。

不增加组件快照、只覆盖单个 if 分支或只证明第三方库自身行为的低收益测试。

最终命令顺序：

```bash
pnpm test:unit -- <相关测试过滤参数>
pnpm typecheck
pnpm test
pnpm lint
pnpm build
git diff --check
```

完整 build 只在最终阶段运行一次。

## 完成定义

- `model-provider` 在 runtime 与 renderer 均为 required Feature，设置页通过注册视图呈现。
- 只有该 Feature runtime 导入 `@earendil-works/pi-ai`。
- AgentLoop、Review、Vision、Memory 和 thread title 只依赖 `ModelClient`/sampling capability。
- 三种现有 provider 配置无需用户操作即可继续工作，API key 不丢失。
- 新增服务可以仅通过厂商、API Key 和模型完成配置；预置模型运行时保留 Pi provider identity 与 compat metadata。
- 模型服务使用 settings Feature 的宽版布局，主列表保持紧凑，模型高级字段在独立弹窗中编辑。
- 普通采样、工具调用、thinking、usage、取消、超时、replay 和 Responses compact 均通过验证。
- `rg "@ai-sdk|from ['\"]ai['\"]|SETSUNA_USE_LEGACY_OPENAI_COMPATIBLE_ADAPTER"` 在生产源码中无结果。
- 旧 streaming adapters 与只服务它们的辅助表示被删除；没有环境变量或运行时分支可以切回旧栈。
- Pi 类型不出现在共享 contract 或持久数据类型中。
- `pi-ai` 只作为构建期依赖进入 esbuild/Vite bundle，不进入 Electron Builder 的 production node_modules 收集，避免携带未使用的 Google/AWS provider SDK。
- architecture、typecheck、test、lint、build、diff check 全部通过。

## 实施验收结果

2026-08-26 已按本文档一次性实施完成；同日补齐 Pi built-in 厂商/方案目录并恢复原有设置页视觉层级：

- `pnpm typecheck`：通过，包含 architecture 与 Tree 一致性检查。
- `pnpm test:unit`：通过。
- `pnpm test:integration`：通过。
- `pnpm lint`：零 warning、零 error。
- `pnpm build`：contracts、Feature packages、runtime、Electron 与 renderer 生产构建全部通过。
- 定向测试额外覆盖真实 Pi provider dispatch、built-in 厂商目录投影、`catalogProviderId` 持久化、简化表单流程、自定义模型弹窗确认提交、Anthropic budget/adaptive thinking、三种 endpoint 规范化、Responses replay metadata 与原生 compact。
