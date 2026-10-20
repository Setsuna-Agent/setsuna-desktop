# Pull Request 工作台

源码：`packages/features/pull-requests/`。Feature ID 为 `pull-requests`，runtime 和 renderer 均为 optional feature。入口位于主侧栏搜索与插件之间。

## 范围与界面

- 从已添加项目的 Git remotes 发现 `github.com` 仓库，按 owner/repository 去重；本地 worktree、重复项目和 origin/upstream 不产生重复列表。项目扫描诊断不在 PR 列表中常驻展示，列表加载和各仓库的 PR 请求失败仍按原有方式报错。
- 左侧保留单行搜索框，仓库、创建人和状态收进共享分级菜单；默认显示全部状态。创建人支持列表选择和手动输入用户名，清除筛选保留搜索文字。结果按更新时间排序，每个仓库独立分页和报错。
- PR 侧栏默认 340px，使用共享 ResizeHandle 拖动或通过方向键调整，当前会话保留偏好宽度；窗口变窄时为详情限制可用宽度。搜索框和图标按钮采用全圆角，列表条目采用大圆角与紧凑间距。条目标题最多两行，作者头像、名字和仓库名共用一行；列表延伸到底部，不显示账号底栏。刷新按钮紧邻 Pull Request 标题，当前账号头像位于标题栏最右侧，悬停显示名字；点击刷新和窗口重新聚焦时检查连接状态。未安装、未登录时隐藏 PR 侧栏和拖柄，连接页占满内容区域。
- 详情包含描述、讨论、完整文件树与逐文件 Diff、checks、分支/审查/合并状态。普通评论、review、review thread、commit comment 分别分页，已解决和过时的讨论保留上下文。
- 主导航底部的圆形菜单按钮显示 GitHub CLI 当前账号头像；未连接、请求失败或图片加载失败时回退到应用 Logo。头像与 PR 页共用 Feature 持有的连接状态和窗口聚焦刷新，不重复请求；首次挂载后在后台读取，不阻塞启动。头像后台检查不弹错误提示，连接错误由 PR 页面呈现。
- 顶部工具栏保留状态、仓库与 PR 编号、查看 Diff、刷新和合并等操作，Diff 图标旁显示增删行数。详情不使用页签，标题、描述与动态时间线、Checks、评论输入框按顺序放在同一滚动区。作者、更新时间和 head → base 分支按可用宽度自然换行。信息图标浮层使用紧凑行展示变更文件数与增删行数、Checks 状态与通过数、合并条件和自动合并状态，审查者保留可展开分组及人数；浮层不重复分组标题和大段留白，不占用常驻右栏。
- 主页面始终铺满详情面板，不设置居中阅读列。滚动条紧贴面板最右侧；工具栏、标题、正文与评论框共用左右边距，默认 20px，面板窄于 850px 时为 16px。作者、时间、分支及动态行文字按基线对齐，头像和图标单独居中。
- Diff 通过共享 Dialog 独立打开，从工具栏、信息浮层的变更行或讨论中的“查看 Diff”进入；文件列表与 patch 只在打开后加载，关闭时取消未完成的读取。弹层按窗口限制宽高，文件树与代码区分别滚动，弹层窄于 680px 时切换为上下布局，不改变底层详情页宽度或滚动位置。关闭后恢复入口焦点，重新打开保留文件选择、搜索、目录折叠、显示偏好和滚动位置；讨论跳转仍定位对应文件和评论。
- 没有审查者时隐藏整组；审查者分组默认收起，展开后每位审查者单独一行，显示头像、名字和审查状态；点击信息浮层的 Checks 行滚动到正文中的检查分区。头像由 GitHub 审查记录和审查请求随详情及分页返回，复用共享头像组件的加载失败占位。Checks 统计使用 GitHub rollup 的全量结果，包含 check runs 和传统 commit statuses，中立和跳过计为通过；与检查详情使用同一提交，并随详情刷新。
- PR 描述作为时间线的第一张有边框卡片，与普通评论复用作者头像、创建时间、正文及表情/引用控件；卡片头部使用中性底色和分隔线，正文保留完整宽度。描述与后续事件、讨论由连续竖线连接，竖线与头像和事件节点共用中心线。提交、打开/关闭 PR、自动合并等事件使用无外框的紧凑节点行，评论和审查讨论保留卡片，Checks 放在完整时间线之后。行讨论的代码片段与查看 Diff 操作共用内容内边距，与标题分隔线及后续评论头部留出 12px 间隔；片段与操作之间保留 8px。PR 描述和普通评论可引用到 PR 草稿，行级 review thread 可回复和引用到本讨论的草稿；有选中文本时只引用选中部分，否则使用渲染后的可读文本。引用通过宿主已有的原子词槽显示作者和片段，支持删除，保留已有草稿；草稿同时保存词槽范围，恢复和概览 / Diff 同步后仍保持词槽，发布正文使用对应的 Markdown 引用格式，不把原始 HTML 塞进编辑区。引用会聚焦并显示编辑器，不自动发送。图标含义通过 tooltip 与 aria-label 表达。已合并或关闭的 PR 仍保留评论入口，发送遵循 GitHub 权限；编辑器支持 Markdown、⌘/Ctrl + Enter 与按账号/PR/讨论保存草稿。
- 首次加载详情时即展示列表中已有的 PR 标题、作者和状态，其余信息按正文顺序显示骨架占位；刷新期间保留已有详情，详情刷新按钮显示加载状态并禁止重复点击。手动与后台刷新成功后均不弹提示，失败沿用错误与重试入口；后台刷新不打断进行中的请求，离开 PR 后取消的请求不弹提示。骨架使用共享主题色与轻微呼吸动画，遵循减少动态效果偏好。
- PR 列表、正文、Diff 文件树和代码区统一通过 `PullRequestScrollArea` 复用宿主 `ScrollOverlay`；隐藏原生滚动条的占位，悬浮滚动条不挤压内容宽度，左右内边距保持一致。每个滚动区保留单一内容根节点，用于跟踪分页、目录展开和异步内容的尺寸变化。
- PR 侧栏标题与详情顶部保留原生窗口拖动、双击缩放区域，操作按钮与侧栏宽度拖柄排除在窗口拖动区域外。头部不再放横向滚动的状态条，长分支名在标签内截断并可悬停查看全名。
- 合并菜单按 GitHub 权限提供 merge/squash/rebase、启用或取消 auto-merge；需要 merge queue 的分支提供入队操作。操作前显示目标 PR、分支和提交版本。

首版连接 GitHub.com，使用本机 GitHub CLI 的当前账号。仓库列表来自本地已添加项目，不遍历账号下所有远端仓库。Checks 的详情链接打开对应 CI 页面，不在本地下载整份 Actions 日志。

## 跨层链路

`renderer client -> feature operation transport -> main/preload 现有窄桥 -> runtime typed route -> gh api / Git`。

- `contracts/models.ts`、`operations.ts` 持有 DTO、校验和 typed operations；renderer 无 runtime 端口、token 或文件系统访问能力。
- `runtime/feature.ts` 通过 `pullRequestsWorkspaceCapability` 获取项目，通过 feature 内的 `GitHubCli` adapter 使用本机 CLI。
- `runtime/repositories.ts` 归一化 remote，维护短期发现缓存。项目目录通过 Git 解析为实际工作树根目录，子目录项目的仓库相对路径也从根目录读取。项目删除立即失效，写操作强制重新检查 remote。
- `runtime/pull-requests.ts`、`discussions.ts`、`checks.ts` 分别处理 GitHub 数据投影；任何 GraphQL partial error 都作为失败显示，避免把不完整数据当成完整结果。
- `renderer/usePullRequest*`、`useDiscussions.ts` 管理分页、刷新、取消和过期响应。刷新保持已加载的页数和展开过的回复。列表筛选与选中项保存在本次 renderer feature session；Diff 选中文件、搜索、目录折叠、显示模式和滚动位置按账号与 PR 独立保存，右侧面板另按对话隔离。组件卸载后仍可恢复，本次应用会话结束后释放，不新增持久化存储。弹层开关只属于当前详情组件，切换 PR 不自动打开弹层。滚动恢复等待异步正文或 patch 到位，用户主动滚动时停止恢复。

列表使用 repository connection 分页，避免 GitHub Search 的 1,000 条上限。列表每 60 秒、详情每 45 秒在可见窗口刷新，并响应窗口重新聚焦；每个共享 API 实例最多执行四个请求。

同一提交的 Checks 后台刷新保留旧列表，所有分页成功后一次替换，避免后续页的条目被卸载并丢失展开状态。刷新失败保留上次结果并显示既有错误反馈；提交版本变化立即隔离旧数据，取消请求的迟到响应不回写。

`activity.list` 按需读取 [GitHub PR 时间线](https://docs.github.com/en/graphql/reference/pulls#pullrequesttimelineitemsitemtype)，包含关闭、重新打开、合并、草稿/可审查转换、自动合并（含 squash/rebase）的启停、合并队列进出和提交。打开 PR 的事件使用 PR 自身的 `createdAt` 与作者，提交使用 `committedDate`，其他事件保留 GitHub 返回的时间与操作者；不以当前状态推测历史时间。动态与评论按发生时间合并，分页刷新保留已加载的页数，失败保留原内容并提供重试。

描述、普通评论、review、行评论和提交评论共用表情操作，支持 GitHub 的八种原生 reaction，计数及当前账号是否已添加由远端返回；点击已选表情会移除。`reactions.set` 接收明确的 add/remove 目标状态，写入前核对当前账号、目标所属 PR 和 `viewerCanReact`，读取完成后再次校验账号。提交评论还需在所选 PR 的提交讨论分页中确认归属。丢失响应后重试会先读取已达成的目标状态，避免反向取消；失败不虚增本地计数。表情写入只由用户点击触发，不随自动刷新发送。

## 对话中的 PR

- 创建 PR 后，模型为每个成功创建的 PR 调用 `attach_pull_request`；工具只记录当前对话与 GitHub URL 的关联，不创建或修改远端 PR。模型提示要求关联每个创建结果，排除仅引用的 PR。Runtime 同时兼容常见 `gh pr create` 与 MCP `create_pull_request` 成功结果；后台 shell 创建要等所属进程成功结束。复杂脚本或被截断的命令依赖显式关联工具，不猜测聊天正文中的链接。
- `runtime/thread-attachments.ts` 从已持久化的 `tool.completed` 记录构建 Feature projection，并使用 Core 的版本化 checkpoint 加速恢复。按大小写归一化的仓库名与 PR 编号去重，同一个对话可关联多个仓库、多个 PR；不同对话独立保存关联。首次读取按需分页重放，不在启动时扫描全部历史。
- 环境信息面板逐项展示关联 PR。侧栏对话右侧保留 PR 入口，单个 PR 直接打开，多个 PR 先展开选择列表。每个 PR 的右下角状态点独立跟踪：进行中绿色、草稿灰色、已合并紫色、已关闭红色；状态未知不推断关闭。聚合入口优先表示仍进行中/草稿的 PR，终态不一致时使用中性色，具体状态在列表各项显示。
- 点击 PR 后通过所属对话身份打开右侧 `pull-request` 标签；仓库与编号作为标签身份，重复打开激活原标签，不同 PR 可并存，布局随对话恢复。详情直接复用 `PullRequestDetailPane`、账号连接页及既有评论、Diff、Checks、合并能力，使用原有 GitHub CLI 与本地仓库访问边界。
- renderer 的 `threads/state.ts` 为已挂载的侧栏行、环境面板和 PR 详情合并订阅，每 5 秒批量读取本地关联投影（每批至多 50 个对话），窗口重新聚焦也刷新；隐藏窗口停止发起轮询，最后一个订阅释放后取消请求。Runtime 独立在后台读取轻量 PR 摘要，45 秒缓存按 PR 共享；关联返回不等待 GitHub，失败保留上次状态并延后重试。详情的最新状态可更新缓存，过期后台结果不能覆盖详情结果；Feature 关闭时中止未完成的状态查询。

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

行评论按 GitHub 的 `diffSide` 和行号挂到实际 patch 行下，使用同一套讨论与回复组件；同一行的多个讨论保持分组。过时评论、文件级评论及不在当前 hunk 内的评论保留在 Diff 后方，不移动到邻近行。评论跳转等待目标 patch 加载后定位，左右两侧的行号分别匹配。

`files.ts` 缓存按 repository、PR、base SHA、head SHA 标识的快照。文件列表全量分页，patch 按文件加载；读取前后确认远端仍是同一版本。

REST 文件数超过 3,000、列表不完整、patch 缺失或增删行数不完整时，`git-diff.ts` 使用 GitHub 返回的 merge base 和 head 对象计算三点 Diff。只补取缺失对象，不 checkout、不改分支或暂存区、不写 FETCH_HEAD。Git 调用固定参数、禁用 external diff/textconv，文件名使用 NUL 分隔和 literal pathspec。二进制文件明确展示无文本 Diff；读取失败明确报错，不静默截断。

文件树分别标识同路径的文件和目录，文件与目录互换时仍可选择所有新增、删除项。Git pathspec 可能同时匹配目录内的历史文件，因此单文件补全按完整的新旧路径筛选原始补丁段，再判断二进制类型；不把整组路径匹配结果交给单文件渲染器。普通文件与符号链接互换产生的同路径删除、新增双段补丁，使用其中的不可变 blob ID 重新计算内容 Diff，并保留前后文件模式，归一化为单文件结果；不跟随工作区里的符号链接。

切换到本地完整文件列表时从第一页重置，避免 REST 与 Git 的排序差异漏掉文件。缓存最多保留三个 PR 版本，每个版本最多缓存约 8 MB 的 REST patches；超出的 patch 按需从 Git 读取。

## 共享展示资源

- `packages/renderer-ui/src/detail-section.tsx`：插件详情和 PR 共用可折叠详情分区。
- `packages/renderer-ui/src/diff-view-controls.tsx`：变更面板与 PR Diff 共用左右对比、自动换行图标控件；文件标题旁展示文件图标与增删统计，文件树不重复显示文件数量。
- `packages/renderer-ui/src/styles/detail.css`：统一详情容器、元数据、Markdown 阅读面板及分区样式。
- `packages/renderer-ui/src/document-markdown.tsx`：统一 GFM、emoji shortcode、HTML 清洗、相对链接、标题锚点和图片处理；插件/Skill 文档、PR 描述/评论和自定义 React 应用复用。PR 描述和评论的 reaction 操作由所属 Feature 的 `PullRequestReactions` 持有，复用共享 Popover 和图标按钮。
- 宿主 `PullRequestsFeatureBoundary.tsx` 注入现有 PageHeader、CodePatchView、对话输入框、外链和剪贴板接口。`PullRequestCommentInput.tsx` 将持久化评论草稿适配到 ChatPromptInput，程序回填不触发用户编辑或改变发布确认状态。PR 样式仅在 feature 自身维护布局与状态差异。

测试位于 `packages/features/pull-requests/test/runtime/`、`packages/features/pull-requests/test/renderer/`，覆盖分页、过期请求、评论幂等和导航、合并版本校验、Git 文件补全与工作区不变性；CLI adapter 测试覆盖账号状态、stdin 正文、HTTP/GraphQL 错误与进程失败边界。
