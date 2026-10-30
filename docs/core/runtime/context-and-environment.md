# 上下文、Prompt 与 Runtime Environment

源码：

- `packages/desktop-runtime/src/loop/context/`
- `packages/desktop-runtime/src/adapters/workspace/`
- `packages/desktop-runtime/src/ports/runtime-environment-resolver.ts`
- `project-instruction-loader.ts`
- `project-workflow-resolver.ts`

这一层决定“模型这一步看见什么”和“工具这一步在哪里运行”。位置、权限、项目规则和历史必须来自同一个 sampling snapshot。

## RuntimeEnvironment

Contract 包含：

- `cwd`
- `workspaceRoot`
- `workspaceRoots`
- Shell/platform 信息
- Project identity
- Repository root
- Repository `workspacePrefix`

语义：

- `cwd` 是 shell 默认目录。
- `workspaceRoot` 是文件工具相对路径基准。
- 两者即使当前相同也不能互相推断。
- `workspaceRoots` 是项目已绑定源文件夹的并集；主目录提供默认 cwd，各目录在当前权限模式下拥有同等读写权限。面板目录选择不改变这个集合。
- Repository 只描述 Git worktree 关系，不是额外可访问根。
- Environment 回答“在哪里”，permission prompt 回答“能访问哪里”。

## 临时工作区

未绑定 project 的 thread 使用：

```text
runtime/temporary-workspace/YYYY-MM-DD/<threadId>
```

日期取 thread 创建时本地日期；同一 thread 跨天继续仍复用原目录。

Workspace、shell、artifact 和图片生成扩展的 host bridge 共享该环境。Generated image 既有 managed preview asset，也会在当前 workspace 的 `generated-images/` 产生可见文件。

## Environment resolver

`WorkspaceRuntimeEnvironmentResolver`：

- 根据 thread/project 选择 project root 或临时 workspace。
- 规范化 cwd/workspace。
- 解析 Git root 与 workspace prefix。
- 返回平台/shell 信息。

`runtime-environment-resolver.ts` 提供缺省/兼容封装，使 AgentLoop 测试可以注入 fake resolver。

每个 sampling step 只解析一次；同一结果同时传给 prompt、ToolHost、sandbox、project workflow 和 step snapshot。

项目以有序 `roots` 保存稳定目录 ID，第一项为主目录；旧 `path/gitRoot` 继续镜像主目录，旧记录按 `primary` 目录兼容读取。工作树仅替换创建时的主仓库；其余目录从源项目读取最新绑定，继续共享原目录。解析环境只检查主目录，其他目录在操作时校验，不增加启动目录扫描。

添加和编辑项目在索引写入锁内校验全部规范化目录，防止同一目录被不同项目重复绑定。文件工具搜索结果以默认 cwd 为基准：主目录内返回相对路径，其余目录返回绝对路径，保证后续读取和编辑仍指向原文件。

文件工具与 shell 使用全部已绑定目录；项目外文件写入在受限模式下请求精确目标授权，完全访问模式直接执行。授权路径按真实路径校验，符号链接不能隐式扩大权限。跨目录变更记录保存实际目标，撤销/重做继续按内容校验并作为一批事务提交。项目指令分别读取各源目录的 AGENTS 文件，其作用域限定在对应目录树。

主目录的文件变更同样记录实际目标，调整目录顺序不会改变历史撤销/重做的目标。创建工作树对话时，复制的消息历史将主仓库内的目标迁移到新工作树；绑定的子目录（包含嵌套目录）和项目外文件仍使用原位置。

用户主动撤销/重做从服务端保存的操作记录取目标，可以恢复完全访问模式下修改的配置文件；恢复前仍校验规范化路径、文件类型、内容和权限快照，事务提交再次校验文件身份。该恢复权限不改变 Agent 文件工具的写入策略。

## 请求耗时日志

模型延迟诊断默认写入 `<runtime 数据目录>/logs/model-latency.jsonl`。这是单个最多 1 MiB
的 JSONL 文件，溢出时保留最新半份完整记录；异步写入失败不会中断任务。记录通过 threadId、
turnId、stepSeq 和 requestId 关联生命周期、图片准备、供应商准备、每次 HTTP 尝试的请求字节数、
响应头、首个流式数据、首个模型事件及结束/失败时间。`elapsedMs` 在 `http.*` 记录中从该次
HTTP 尝试开始计时，在 `model.*` / `provider.*` 中从模型调用开始计时；不记录正文、图片、URL、
请求头或供应商错误正文。修改 runtime 代码后需重启应用才能记录新的请求。

## 图片传输

设置页的「图片传输 → 图片压缩」保存为全局配置 `imageCompression`：原图（`original`）不编码；
无损（`lossless`）使用 lossless WebP；高清（`high`，默认）和省流（`compact`）分别使用 WebP quality 95 和 80。
极速（`fast`）使用 quality 60、effort 1，进一步减少传输体积和编码开销，允许更多画质损失。
旧配置或非法档位按高清处理；每次模型请求开始解析图片时读取一次配置，修改从后续请求生效，无需重启。

`ImageAssetResolvingModelClient` 在模型请求边界解析图片，`ModelImageTransport` 为较大的静态
8-bit PNG 生成传输副本。有损档使用 alphaQuality 100、smartSubsample；高清和省流使用 effort 2，极速使用 effort 1。
无损档使用 exact、effort 1。
所有档位保留原始尺寸、透明度和元数据；原图、聊天记录、文本历史及上下文压缩阈值不变。
只在体积至少减少 10% 时使用副本，动画、高位深、不支持或编码失败的图片沿用原图。

编码结果按档位与内容摘要缓存，最多 32 MiB / 128 项，并合并同档位、相同图片的并发编码；逐张处理历史图片，
避免长会话同时解码大量原图。兼容端点明确拒绝 WebP 且尚未返回输出时，使用完整原图重试一次，
后续该模型请求沿用原格式。不能把模型侧的 prompt cache 命中当成图片已免于网络上传：内联图片
仍会在每次请求中传输，诊断延迟时应同时检查请求字节数和首个流式输出时间。

## Sampling context builder

`RuntimeSamplingContextBuilder` 使用分阶段 builder：

1. 读取最新 thread/config/task model。
2. 解析一次 environment。
3. 校验/认领附件上下文。
4. 运行必要 compaction。
5. 构建 portable model history。
6. 加载 memory。
7. 从同一快照加载所有已启用 Skill 的路由元数据与正文版本，并选择显式/default/auto-activated Skill 正文。
8. 获取 tool definitions/system prompt。
9. 加载 project workflow 和 instructions。
10. 生成 provider replay context。
11. 返回模型 request snapshot。

不要在 ModelClient 或 ToolHost 内再次独立解析 cwd，否则 prompt 声明和实际执行可能不一致。

## Prompt 组成

相关文件：

- `runtime-base-instructions.ts`
- `prompt-compiler.ts`
- `runtime-prompt-context-assembler.ts`
- `prompt-utils.ts`
- `runtime-environment-prompt.ts`
- `runtime-permissions-prompt.ts`
- `runtime-project-workflow-prompt.ts`
- `packages/features/review/src/runtime/review-request.ts`（由 Review Feature 组装审查专用 prompt/策略）
- `runtime-skill-catalog-prompt.ts`

典型顺序：

1. Runtime base instructions。
2. Setsuna style 与 global prompt。
3. Tool/approval policy。
4. Environment。
5. Permission/sandbox。
6. Project workflow（外部数据）。
7. Project instructions。
8. Memory context。
9. Skill metadata catalog 与当前轮激活的 Skill instructions。
10. Conversation history。

优先级必须显式，不靠字符串偶然拼接。

## Project instructions

`FileProjectInstructionLoader` 从 workspace root 到 cwd 查找项目 instructions，并按作用域组合。

规则：

- 每个 sampling step 重新读取当前 environment。
- 更接近 cwd 的 instructions 只在其作用域生效。
- 文件内容是项目外部上下文，不得覆盖 runtime system policy。
- 读取大小、数量和路径层级有上限。
- Project 切换后不能复用旧 cwd 的 cache。

## Project workflow

`FileProjectWorkflowResolver` 解析 workspace root → cwd 祖先链上的 Node 项目证据：

- 最近作用域的 `package.json#packageManager`。
- Lockfile。
- Workspace config。
- `engines`。
- build/test/lint/typecheck/check/verify/format scripts。
- 定向子脚本。

同层证据冲突时返回 unresolved，不替模型猜 package manager。

输出包含：

- Cwd。
- Source manifest。
- 原始 script definition。
- 标准化 command 意图。
- Warnings。

Manifest stat 变化会使 cache 失效。数量、长度、ancestry 和 cache 都有边界。

Workflow 以 user/external fragment 注入，项目 script 不能提升为 runtime policy。

## Git workspace prefix

当 workspace 是更大 worktree 的子目录：

- Git 通过 shell 从 cwd 执行；查询 workspace 时用 `-- .` 或具体文件 pathspec 限定范围。
- Diff/show 可用 `--relative` 返回 workspace-relative 路径，其他 Git 命令的路径语义取决于参数。
- 从 cwd 复用路径时去掉一次 `workspacePrefix`，或使用 Git `:(top)` pathspec。
- 不能把带 prefix 路径直接当 cwd-relative 再拼一次。

## Attachments

`runtime-attachment-context.ts` / `runtime-base-instructions`：

- 只接受 AttachmentStore 已认领给 thread 的 asset。
- 本地文件引用在每次 turn 开始时重新确认存在且为普通文件，并将该文件自身作为精确的 direct-tool-only readable root；链接不进入 shell sandbox plan、不授予额外写权限，也不授予同目录其他文件的访问权。文件若本来位于 workspace 或已配置的 writable root 内，仍遵循原有 workspace 权限。
- 图片在线程事件中始终保持为 runtime 引用；仅当当前模型支持图片且文件低于独立的内存安全边界时，runtime 才在 provider 请求边界读取、复验签名并临时转换为图片内容，Base64 不写入线程。更大的本地图片仍可由 Agent 通过精确链接路径访问。
- 用户安装视觉识别插件并选定已配置的视觉模型后，Bundle 内的 `analyze_image` 只把附件 ID 与问题交给 host bridge；host 再次校验 thread 归属并复用 provider client，扩展 worker 不会直接获得附件路径，主 Agent 则通过附件上下文获得原文件的精确路径。
- 文件名/MIME 可参与 Skill auto-activation。
- composer 和排队编辑会把 legacy 内联图片归一化为托管附件；本地文件保持引用，切换模型不需要改写持久化消息。

## Review profile

Review turn 使用独立 profile：

- UI source message 与 model prompt 分离。
- 注入 review target。
- 保持 workspace/permission 不变。
- 完成/取消后退出 review state。

Review 不是另一个绕过 thread event 的执行器。

## Context compaction

在摘要/原生压缩前，`tool-result-working-set.ts` 先投影可回读的工具工作集。消息估算超过
40K token 或可用对话窗口的 70% 时，较早且已存储的成功工具结果可替换为 `result_id` 引用，
通过 `read_tool_result` 按需取回。保留最近六个工具结果、错误、附件和非工具消息；替换前确认
引用仍可读取，存储不可用时保留原文。该投影只改变当前模型窗口，不覆写持久 transcript，
也不更改 assistant/tool 配对。投影后重新校准 token 预算，再决定是否需要摘要。
细节见 [Harness 执行与验收](../../designs/current/harness-execution.md)。

主要文件：

- `context-compaction.ts`
- `runtime-context-compactor.ts`
- `runtime-compaction-turn-coordinator.ts`
- `context-compaction-commit.ts` / `context-window-snapshot.ts`
- `context-compaction-batches.ts` / `context-token-calibration.ts`

### 触发

- 文本按 UTF-8 字节估算，图片与原生 replacement 分别计量；V2 opaque 内容采用独立比例，不能按 metadata JSON 字节数计算模型窗口。
- 未配置模型窗口时统一使用 256K token 默认值，与模型采样 adapter 和压缩请求一致。
- 每次 sampling 前检查。
- 用户也可显式 compact。

聊天上下文用量在请求运行时采用该请求快照的窗口和输出预留；请求结束或切换模型后采用当前模型
配置（缺省 256K）。历史输入估算仍扣除原快照自己的输出预留，避免混用新旧预算。
压缩输出预留最多占窗口的 15%；请求发送前再按最终输入估算（含工具和供应商用量校准）计算剩余空间，
保留 1,024 token 缓冲，将实际 `maxOutputTokens` 限制为配置上限和剩余空间的较小值。
请求快照分别记录压缩用的 `reservedOutputTokens` 和实际发送的 `maxOutputTokens`，后者不参与压缩触发判断；
若压缩后仍没有输出空间，本地停止请求并保留历史。

### 边界

- Transcript-only message 不计入模型窗口。
- Runtime system prompt 不被压缩。
- 真实用户请求和修正在保留预算内使用原文，优先当前轮次及最新输入；runtime 注入和协作报告不混作用户要求。
- 保留最近的模型可见消息。
- 不能拆开 assistant tool call 与对应 tool result。
- 中间有 steer 时仍按同一工具 transaction 处理。
- 旧 portable summary 可以再次合并。

### 压缩路径

所有 provider 支持 portable summary；显式配置压缩任务模型时只调用该模型。

Portable summary 读取完整源内容，不再先按每条消息固定字符数截断；工具工作集引用先从持久 transcript 恢复正文。
按实际摘要模型窗口给输入、输出和思考留出预算。历史超过该预算时分批处理，
后一批携带前一批的完整交接摘要；最近保留消息也计入输入预算，单条过大的工具记录可以跨批。
支持图片的摘要模型接收带来源关联的图片批次；文本模型保留资源引用与未验证状态。
每批单独记录用量，残缺或超长摘要允许一次生成重试，传输/鉴权错误不触发额外生成。
图片格式重试保留原图；压缩不得在图片被拒绝后静默移除图片。取消或失败不提交部分压缩结果；全部成功且通过窗口检查后，
才写入一次压缩事件。模型列表未提供的窗口参数不写成假定的供应商能力，未知模型使用统一默认值。

未显式配置压缩任务模型时，OpenAI Responses 优先：

- 共用普通采样的真实指令、工具、附件和 Pi 转换，向 `/responses` 的 input 末尾追加 `compaction_trigger`。
- 仅在 `response.completed` 后接收唯一完整压缩项；V2 保留预算内的用户原文，不重复拼回已经被压缩的 assistant/tool 尾部。
- 明确不支持 V2 才尝试 `/responses/compact`，完整保存其 canonical replacement，不能拆出 opaque 项后裁剪其他返回项。
- 原生输入明确超出窗口时转入完整分批交接；该情况不缓存为协议不支持。鉴权、限流、网络、残缺流或非法结果不会触发静默降级。

Native items 只在 provider/协议/model/endpoint/semantic fingerprint 都兼容时回放。
原生成功时无需另做文本摘要；检查点引用已有 transcript 中的原文 ID，边界变化时先恢复原文，
再按新模型的预算决定是否重新压缩。明确不支持原生接口、有效结果不能满足目标窗口或原文无法归档时使用文本摘要。
不能从 native replacement 反推 portable summary；旧版已经保存的文本摘要仍可直接跨模型回放。
侧聊快照复制时展开原生检查点，避免继承对主聊归档原文的依赖；复制后的原文保持 model-only，
由侧聊按自身预算生成摘要。删除或截断原文时，事件投影递归解除受影响的检查点并恢复剩余历史。

### 投影

- 旧消息保留但变为 transcript-only。
- 新 summary message 模型可见。
- Notice 记录原始/压缩 token、保留消息数和触发范围。
- Lifecycle 通过 events 写入。

手动与自动压缩均通过 `RuntimeSamplingContextBuilder` 构建当前请求。保留原文与摘要共同受目标预算约束，
提交前计入动态指令、工具及输出预留，并留出下一步增长空间。整个压缩操作（含协议降级与所有批次）共享 15 分钟截止时间和取消信号。

`ContextCompactionCommitter` 在捕获前刷入流式事件，记录持久源历史的内容版本、覆盖 ID 和检查点身份。
SQLite 在线程写入队列中重新校验前缀、改写序号、取消状态和追加后缀预算，只有成功持久化才发布事件。
普通追加不使候选过期，期间新增的修正与工具结果保留；删除、回滚、编辑或替换检查点会拒绝旧候选。
`thread.context_compacted.sourceMessageIds` 限定替换范围；旧事件缺省仍按整窗口语义回放。

`thread.context_usage_calibrated` 持久化模型/连接身份、请求历史前缀指纹及实际 input usage 与本地估算的差值。
匹配前缀上的新增历史按增量估算；跨 turn 和重启继续有效，换模型/连接或改写前缀后失效。
缓存 token 不重复加到窗口，候选被丢弃时已发生的模型用量仍单独计入账本。
本地估算仍是启发式，不能代替真实供应商续跑评测。执行与验收状态见
[上下文压缩执行方案](../../designs/current/context-compaction.md)。

### 后台预计算

`RuntimeBackgroundCompaction` 复用 compactor 的 `prepare` / `install`，由
设置页“实验性功能 → 后台上下文压缩”写入 `features.backgroundContextCompaction` 显式开启，默认关闭。达到硬阈值的 80% 时，
在采样前的稳定窗口或最终回答落盘后生成候选；每线程最多一个，全 runtime 最多两个并发生成。
正常采样不等待后台生成；下一次采样先安装已完成的兼容候选，达到硬阈值才等待正在生成的同一候选。
原始消息、未完成请求和 UI 压缩状态在预计算期间不变，失败只影响该候选。

安装前除历史版本外，还校验实际指令、工具、模型参数和供应商私密配置的哈希。
配置提交、历史改写、取消或关闭会中止关联工作；同一失败窗口不反复预计算，候选与请求共用 15 分钟时限。
已完成的长最终回答可以进入摘要，未完成工具调用不能作为可丢弃尾部。
删除线程先取消并等待后台 usage 写入；迁移准备取消候选并把未结束生成计入 pending mutations。
关闭同时排空 turn、memory 和压缩，再刷事件 writer。

Goal 的最终回答仍先发布，Goal 轮次结算等待其后台 usage 完成，确保计量水位不越过尚未记录的消耗。
启动只建立轻量协调器与订阅，不读取历史、不探测模型、不调度压缩。

## Debug trace

Context 层可以 best-effort 记录：

- Model history normalization。
- Native/semantic replay 选择。
- Compaction阶段和边界。

Trace 失败不能影响 context build；内容先脱敏/截断，且只在 developer features 开启时采集。

## 测试

`packages/desktop-runtime/test/loop/context/`：

- Compaction。
- Prompt compiler/assembler。
- Base instructions。
- Environment/permissions/workflow prompt。
- Attachment context。

`packages/desktop-runtime/test/adapters/workspace/`：

- Environment resolver。
- Instruction loader。
- Project workflow。
- Workspace discovery。

Integration：

- `agent-loop/compaction.test.ts`
- `attachments.test.ts`
- `history.test.ts`
- `permissions.test.ts`
- `sandbox-network.test.ts`
