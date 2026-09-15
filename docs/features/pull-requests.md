# Pull Request 工作台

源码：`packages/features/pull-requests/`。Feature ID 为 `pull-requests`，runtime 和 renderer 均为 optional feature。入口位于主侧栏搜索与插件之间。

## 范围与界面

- 从已添加项目的 Git remotes 发现 `github.com` 仓库，按 owner/repository 去重；本地 worktree、重复项目和 origin/upstream 不产生重复列表。
- 左侧保留单行搜索框，仓库、创建人和状态收进共享分级菜单；默认显示全部状态。创建人支持列表选择和手动输入用户名，清除筛选保留搜索文字。结果按更新时间排序，每个仓库独立分页和报错。
- PR 侧栏默认 340px，使用共享 ResizeHandle 拖动或通过方向键调整，当前会话保留偏好宽度；窗口变窄时为详情限制可用宽度。条目标题最多两行，作者头像、名字和仓库名共用一行；列表延伸到底部，不显示账号底栏。刷新按钮紧邻 Pull Request 标题，当前账号头像位于标题栏最右侧，悬停显示名字；点击刷新和窗口重新聚焦时检查连接状态。未安装、未登录时隐藏 PR 侧栏和拖柄，连接页占满内容区域。
- 详情包含描述、讨论、完整文件树与逐文件 Diff、checks、分支/审查/合并状态。普通评论、review、review thread、commit comment 分别分页，已解决和过时的讨论保留上下文。
- 概览、Diff、Checks 共用撑满右侧的内容宽度，页签靠左紧凑排列；操作区位于右上角，与状态和仓库编号同行。作者头像和名称位于标题下，分支、审查、检查状态及合并条件在头部横向排列，不显示讨论计数。状态与合并条件复用主题色：已合并紫色、进行中/可合并绿色、等待橙色、关闭/冲突红色、草稿灰色。标题与页签固定，正文直接阅读。Diff 的文件树和代码区独立滚动，连续单子目录压缩展示，窄内容区切换为上下布局。
- 没有审查者时隐藏整项；一位审查者显示名字和头像，多位只显示头像，悬停查看姓名。头像由 GitHub 审查记录和审查请求随详情及分页返回，复用共享头像组件的加载失败占位。PR 关闭或合并后隐藏合并条件与自动合并；进行中的 PR 仅在启用自动合并时显示“已启用”。
- 普通讨论支持引用回复；行级 review thread 使用 GitHub 原生回复。没有讨论时隐藏讨论标题和空提示；短内容的评论输入框靠底部，长内容则位于正文末尾随内容滚动。已合并或关闭的 PR 仍保留入口，发送遵循 GitHub 评论权限。输入框复用对话编辑器，支持 Markdown 文本、⌘/Ctrl + Enter 提交和按账号/PR/讨论保存草稿，不提供预览切换。
- 概览页签不显示计数，页签悬停无背景色。Checks 页签显示通过数/总数（中立和跳过计为通过），直接使用 GitHub rollup 的全量统计，包含 check runs 和传统 commit statuses；与检查详情使用同一提交，并随详情刷新。
- 首次加载详情时即展示列表中已有的 PR 标题、作者和状态，其余信息按当前页签显示骨架占位；刷新期间保留已有详情。骨架使用共享主题色与轻微呼吸动画，遵循减少动态效果偏好。
- PR 侧栏标题与详情顶部保留原生窗口拖动、双击缩放区域，操作按钮与侧栏宽度拖柄排除在窗口拖动区域外。状态信息按组自动换行，多位审查者也可在组内换行，不产生横向滚动条。
- 合并菜单按 GitHub 权限提供 merge/squash/rebase、启用或取消 auto-merge；需要 merge queue 的分支提供入队操作。操作前显示目标 PR、分支和提交版本。

首版连接 GitHub.com，使用本机 GitHub CLI 的当前账号。仓库列表来自本地已添加项目，不遍历账号下所有远端仓库。Checks 的详情链接打开对应 CI 页面，不在本地下载整份 Actions 日志。

## 跨层链路

`renderer client -> feature operation transport -> main/preload 现有窄桥 -> runtime typed route -> gh api / Git`。

- `contracts/models.ts`、`operations.ts` 持有 DTO、校验和 typed operations；renderer 无 runtime 端口、token 或文件系统访问能力。
- `runtime/feature.ts` 通过 `pullRequestsWorkspaceCapability` 获取项目，通过 feature 内的 `GitHubCli` adapter 使用本机 CLI。
- `runtime/repositories.ts` 归一化 remote，维护短期发现缓存。项目目录通过 Git 解析为实际工作树根目录，子目录项目的仓库相对路径也从根目录读取。项目删除立即失效，写操作强制重新检查 remote。
- `runtime/pull-requests.ts`、`discussions.ts`、`checks.ts` 分别处理 GitHub 数据投影；任何 GraphQL partial error 都作为失败显示，避免把不完整数据当成完整结果。
- `renderer/usePullRequest*`、`useDiscussions.ts` 管理分页、刷新、取消和过期响应。刷新保持已加载的页数和展开过的回复。列表、详情的筛选/选中项/滚动位置保存在本次 renderer feature session。

列表使用 repository connection 分页，避免 GitHub Search 的 1,000 条上限。列表每 60 秒、详情每 45 秒在可见窗口刷新，并响应窗口重新聚焦；每个共享 API 实例最多执行四个请求。

## 登录与写入

PR 功能独立使用本机 GitHub CLI，不依赖 MCP 或插件的 OAuth session。`github-cli.ts` 通过固定参数启动 `gh auth status` 和 `gh api --hostname github.com`，复用 CLI 当前账号及凭据管理，不导出 token。请求正文经 stdin 传入，不经 shell 或命令行字段展开；API 层继续处理 GraphQL、REST、分页、限流以及明确拒绝与不确定写入的区别。

连接页区分 CLI 未安装、未登录和检查失败。首次检查完成前只显示加载状态，确认未安装或未登录后才展示引导；检查失败时提供重新检查，不推断为未登录。未安装时提供一键安装与“重新检查”；未登录时展示登录命令，末尾复制图标在成功后短暂变为对号。说明文案保持简短，失败通过 Toast 提示。返回应用时重新读取 CLI 状态，并保留已有连接页面。账号登录、切换和退出由 `gh auth` 管理，应用不修改系统级登录状态。

`github-cli-installation.ts` 负责安装任务；宿主只注入数据目录和已有代理下载能力，renderer 通过 typed operations 启动与查询进度。任务在 runtime 中合并并发请求，切走页面继续安装，runtime 关闭时取消。下载 GitHub CLI 官方最新稳定版中对应 macOS/Windows、x64/arm64 的 ZIP，核对同一发布的 SHA-256，只提取预期可执行文件和许可证；在临时目录验证版本后原子移动到应用数据目录的 `github-cli/bin`。下载/校验失败不会执行或留下半成品，允许重试。

桌面宿主已有的 shell PATH 初始化用于发现系统 CLI。优先执行系统 `gh`，只有找不到时才使用应用安装的绝对路径；认证失败不切换身份来源。托管安装的登录命令使用该绝对路径（Windows 使用 PowerShell 语法），Git 补全也使用同一个可执行文件的 credential helper，不修改全局 Git config。

评论发布使用草稿 request ID 和隐藏 Markdown 标记识别已完成的请求。发送前保存原始正文和请求 ID；发送前读取失败或 GitHub 明确拒绝时返回 `PR_COMMENT_NOT_SENT`，保留原始原因、恢复草稿编辑，并清除失败请求缓存以允许重试。丢失响应或返回结果不完整时自动遍历对应评论或回复的所有分页：找到标记则按成功同步；完整查询仍未找到时返回 `PR_COMMENT_NOT_FOUND`，释放失败缓存并恢复草稿，后续显式发送前仍查询标记。核对会先等待同 ID 的运行中写请求结束；查询本身失败不代表评论不存在，此时保留原发送记录，但允许编辑正文，再次发送时先核对原记录。自动恢复只读、不补发评论，不要求用户手动确认是否发布。运行中的写请求不因切换 PR 而自动取消，旧请求完成也不能覆盖新草稿。

`renderer/useCommentDraft.ts` 按账号/仓库/PR/讨论 key 共享草稿正文、请求 ID 和发送状态，通过订阅同步概览与 Diff 中的编辑器；发送完成或失败后同步清空或恢复。宿主适配器同步非活动编辑器时恢复原焦点及选区方向，避免隐藏回复框改变正在编辑的位置。发送状态只保留在内存中，重启后仍以持久化的待确认草稿核对结果。

评论发送与发布结果核对的错误通过宿主统一的 Toast 提示，不在输入框下方追加错误或说明文字。组织 OAuth 访问限制会明确提示评论未发送，并引导在个人 Authorized OAuth Apps 页面申请组织访问、由组织管理员批准；读取公开 PR 不代表 OAuth 应用已经具备组织写权限。

评论、回复及结果核对携带草稿所属账号，合并和自动合并操作携带确认框打开时的账号。Runtime 读取 `/user` 校验，写入前完成 PR/评论分页读取后再次校验；不一致时返回 `PR_ACCOUNT_CHANGED`，不执行写入，前端刷新连接并保留原账号草稿，不自动用新账号重试。

合并前重新读取 GitHub 状态，校验权限、草稿状态、合并方式、队列规则，以及确认框快照中的 head SHA 和目标分支名称。PR 改投其他分支时，即使 head 不变，也必须重新确认。直接合并与入队分别判断条件：入队允许分支落后于目标分支，由 GitHub 入队接口校验检查和分支规则，合并方式也由队列规则决定。REST merge 和 enqueue 还向 GitHub 提交期望 SHA；目标分支在写入前校验，不锁定之后的远端变更。Auto-merge 是 GitHub 对后续满足条件的提交执行的动作，其启用接口没有原子 head 参数；本地执行最新状态校验，不承诺锁定后续推送。这里不提供绕过仓库保护规则的管理员操作。

## 完整 Diff

`files.ts` 缓存按 repository、PR、base SHA、head SHA 标识的快照。文件列表全量分页，patch 按文件加载；读取前后确认远端仍是同一版本。

REST 文件数超过 3,000、列表不完整、patch 缺失或增删行数不完整时，`git-diff.ts` 使用 GitHub 返回的 merge base 和 head 对象计算三点 Diff。只补取缺失对象，不 checkout、不改分支或暂存区、不写 FETCH_HEAD。Git 调用固定参数、禁用 external diff/textconv，文件名使用 NUL 分隔和 literal pathspec。二进制文件明确展示无文本 Diff；读取失败明确报错，不静默截断。

文件树分别标识同路径的文件和目录，文件与目录互换时仍可选择所有新增、删除项。Git pathspec 可能同时匹配目录内的历史文件，因此单文件补全按完整的新旧路径筛选原始补丁段，再判断二进制类型；不把整组路径匹配结果交给单文件渲染器。普通文件与符号链接互换产生的同路径删除、新增双段补丁，使用其中的不可变 blob ID 重新计算内容 Diff，并保留前后文件模式，归一化为单文件结果；不跟随工作区里的符号链接。

切换到本地完整文件列表时从第一页重置，避免 REST 与 Git 的排序差异漏掉文件。缓存最多保留三个 PR 版本，每个版本最多缓存约 8 MB 的 REST patches；超出的 patch 按需从 Git 读取。

## 共享展示资源

- `packages/renderer-ui/src/detail-section.tsx`：插件详情和 PR 共用可折叠详情分区。
- `packages/renderer-ui/src/diff-view-controls.tsx`：变更面板与 PR Diff 共用左右对比、自动换行图标控件；文件标题旁展示文件图标与增删统计，文件树不重复显示文件数量。
- `packages/renderer-ui/src/styles/detail.css`：统一详情容器、元数据、Markdown 阅读面板及分区样式。
- `apps/desktop/renderer/src/shared/ui/DocumentMarkdown.tsx`：统一 GFM、HTML 清洗、相对链接、标题锚点和图片处理；插件/Skill 文档和 PR 描述/评论复用。
- 宿主 `PullRequestsFeatureBoundary.tsx` 注入现有 PageHeader、CodePatchView、对话输入框、外链和剪贴板接口。`PullRequestCommentInput.tsx` 将持久化评论草稿适配到 ChatPromptInput，程序回填不触发用户编辑或改变发布确认状态。PR 样式仅在 feature 自身维护布局与状态差异。

测试位于 feature 的 `test/runtime`、`test/renderer`，覆盖分页、过期请求、评论幂等和导航、合并版本校验、Git 文件补全与工作区不变性；CLI adapter 测试覆盖账号状态、stdin 正文、HTTP/GraphQL 错误与进程失败边界。
