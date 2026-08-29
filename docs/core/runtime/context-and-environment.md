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
- `workspaceRoots` 描述层级，不自动扩大权限。
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

- Builtin `git_status` / `read_diff` / `git_log` / `git_show` 用 pathspec 限制到 workspace。
- 输出统一为 workspace-relative。
- Shell 中其他 Git 命令可能返回 repository-relative path。
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

主要文件：

- `context-compaction.ts`
- `runtime-context-compactor.ts`
- `runtime-compaction-turn-coordinator.ts`

### 触发

- 根据字符数估算 token。
- 默认上限对应约 256K token。
- 每次 sampling 前检查。
- 用户也可显式 compact。

### 边界

- Transcript-only message 不计入模型窗口。
- Runtime system prompt 不被压缩。
- 保留最近的模型可见消息。
- 不能拆开 assistant tool call 与对应 tool result。
- 中间有 steer 时仍按同一工具 transaction 处理。
- 旧 portable summary 可以再次合并。

### 双产物

所有 provider 都生成 portable summary。

OpenAI Responses 还可以：

- 把真实旧模型窗口发送 `/responses/compact`。
- 保存完整 replacement native items。

Native items 只在 provider/协议/model/endpoint/semantic fingerprint 都兼容时回放；否则使用 portable summary。不能从 native replacement 反推 portable summary。

### 投影

- 旧消息保留但变为 transcript-only。
- 新 summary message 模型可见。
- Notice 记录原始/压缩 token、保留消息数和触发范围。
- Lifecycle 通过 events 写入。

## Debug trace

Context 层可以 best-effort 记录：

- Model history normalization。
- Native/semantic replay 选择。
- Compaction阶段和边界。

Trace 失败不能影响 context build；内容先脱敏/截断，且只在 developer features 开启时采集。

## 测试

`test/loop/context/`：

- Compaction。
- Prompt compiler/assembler。
- Base instructions。
- Environment/permissions/workflow prompt。
- Attachment context。

`test/adapters/workspace/`：

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
