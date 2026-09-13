# 插件平台注册与接入申请清单

核对日期：2026-09-13。范围：Setsuna 本机缓存的 OpenAI 插件市场 65 个条目，版本 `1dc195897af4161d039b80d8471ec0a10c9bbc89`，并对照各服务官方 MCP 文档。这里的“注册”指为 **Setsuna Desktop 这个客户端**办理接入；每位最终用户仍需登录自己的服务账户并授权。

当前产品决定：默认 OpenAI 市场已排除 Figma、Canva、Vercel、monday.com、Gmail、Google Calendar、Google Drive、Slack、Dropbox、Zoom，共 10 项；其余兼容检查失败的“暂不支持”条目也不再展示。无需继续为这些条目办理申请；以下保留为平台接入调研记录，供将来明确决定重新接入时参考。GitHub 和通过兼容检查的直接授权服务保留。

## 核对结果与参考办理步骤

| 顺序 | 平台 | 你需要做什么 | 当前可完成到哪里 |
| --- | --- | --- | --- |
| 1 | Figma | 提交新 MCP 客户端接入申请 | 现在可申请，等待官方回复 |
| 2 | Canva | 申请 MCP 接入及回调地址白名单 | 先申请；要求填写精确回调时需先确定实现 |
| 3 | Vercel | 联系官方申请客户端审核 | 现在可询问申请渠道；未找到公开自助登记表 |
| 4 | monday.com | 面向公众提供 Setsuna 集成前登记审核 | 现在可提交；自己测试可以用个人 API token |
| 5 | Google：Gmail、Calendar、Drive | 一个 Cloud 项目配置三项服务；申请 Developer Preview；创建 OAuth 客户端 | 先做项目、预览申请和同意屏幕；客户端配置见下文 |
| 6 | Slack | 创建 Setsuna Slack App | 可先建内部测试 App；公开使用还需 Marketplace 审核 |
| 7 | Dropbox | 自定义客户端自行创建 Dropbox App | 可先建 App；固定回调与 OAuth 仍需适配 |
| 8 | Zoom | 创建 General App，配置用户级 OAuth | 可先建 App、选权限；回调仍需适配 |
| 可选 | Airtable | 支持自动注册，通常不用自己建 App | 仅组织要求独立审批或禁用自动注册时手动创建 |
| 暂缓 | Shopify | 当前清单存在 Client ID 占位符 | 尚未核实该 MCP 端点的公开注册流程，先别注册普通 App 顶替 |
| 已处理 | GitHub | 沿用已经注册的 Setsuna 应用 | 不用重复创建 |

下文各平台条目附对应官方依据。“能导入插件”“平台允许 Setsuna 接入”“OAuth 已经联通”是三个独立状态，本次没有对这些账户做实际授权测试。

## 回调地址：目前不能给你一个随便填的常量

Setsuna 当前真实回调是 `http://127.0.0.1:<每次登录分配的端口>/oauth/callback`。`<…>` 是说明文字，不能原样填进平台表单。

代码在 `packages/features/mcp/src/runtime/adapters/sdk/mcp-oauth-callback-server.ts` 使用 `listen(0, '127.0.0.1')`。手填 OAuth 配置目前仅支持 Client ID 和 Resource；静态 Client Secret、显式 scopes、固定回调端口尚未完整接入。需要逐平台决定固定回环回调、原生应用 OAuth 或服务端回调，而不是只补一串 Client ID。

因此：可以先建账户、项目、应用和提交准入申请；遇到必填的精确 Redirect URI，先停在该字段，等 Setsuna 给出实际支持的地址。不要填其他客户端的回调，也不要把上游 Google 示例中的 `12798` 当作 Setsuna 已支持的端口。Google、Slack、Zoom 等平台的客户端类型与回调方式也必须匹配。

## 申请时统一准备的资料

- 应用名：`Setsuna Desktop`。
- 项目主页可使用真实仓库：[Setsuna-Agent/setsuna-desktop](https://github.com/Setsuna-Agent/setsuna-desktop)。如果平台要求正式网站、隐私政策或服务条款，则填写实际页面；仓库链接不能代替这些文件。
- 联系人及邮箱：填写你能收信的真实信息；个人项目如实填写，不虚构公司。
- 用途说明可参考：`Setsuna Desktop is a local-first desktop AI workspace. We want users to connect their own accounts through OAuth and use your official MCP server from Setsuna.`
- 准备支持系统、计划开放范围、预计使用规模；认证细节和回调地址按最终实现填写。
- 记录申请编号、Client ID、审批状态。Client Secret 和 token 保存在本机凭据管理处，不放进这份文档或公开仓库。

## 1. Figma：申请 MCP 客户端准入

1. 打开 [Figma 新客户端申请表](https://form.asana.com/?d=10497086658021&k=kBG-ejRQTdY8x_H6a4vM3Q)。入口来自官方文档中的 **Which MCP clients are supported? → join the waitlist**。
2. 按表单填写 Setsuna 的项目资料、用途及联系信息。这里申请的是新的 MCP 客户端；表单字段以打开时的内容为准。
3. 提交后保留确认信息，等待 Figma 给出准入及后续配置要求。目标端点是 `https://mcp.figma.com/mcp`。

官方明确只允许目录中的客户端连接。截图里的 `403 Forbidden` 与客户端准入被拒的情况相符，但没有请求链路日志，不能仅凭截图认定根因。报错中的 JSON 解析异常是把纯文本 `Forbidden` 当 JSON 解析造成的次生错误。**创建普通 Figma REST OAuth App 不等于获得 MCP 准入。** [官方接入限制](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)

## 2. Canva：申请回调白名单

1. 打开 [Canva MCP Waitlist](https://docs.google.com/forms/d/e/1FAIpQLSdtsKA9LSmY-JEf_nF5QYBdjxfnXbgqvlKzd8obKGSPSK_eOA/viewform)。
2. 填写项目、集成目标、技术需求、时间计划及联系邮箱；说明接入客户端是 Setsuna Desktop。涉及回调字段时，遵守前面的回调说明。
3. 收到批准和集成指导后，再完成回调登记及客户端认证配置，连接 `https://mcp.canva.com/mcp`。

Canva 推荐 CIMD：以 HTTPS 元数据文档 URL 作为客户端身份；也暂时保留动态注册兼容。获准后不一定会给你一对传统 Client ID / Secret，按其指导接入即可。不要把普通 Canva Connect API 应用创建当成完成 MCP 白名单申请。 [官方步骤与认证说明](https://www.canva.dev/docs/mcp/)

## 3. Vercel：向官方申请审核客户端

1. 查阅 [Vercel MCP 支持客户端列表](https://vercel.com/docs/agent-resources/vercel-mcp)。当前列表没有 Setsuna。
2. 通过 [Vercel 官方支持入口](https://vercel.com/help)提供项目资料，说明要为 `https://mcp.vercel.com` 申请 **new MCP client review / allowlist**，询问具体接入流程。
3. 按官方回复补齐认证、回调和数据处理资料，再进行联调。

已确认的要求是“客户端经过审核并获准”；未找到公开自助注册表或确定审批时限。上面的支持入口用于询问办理渠道，不能保证提交后一定获准。创建一般 Vercel OAuth 应用不能据此认定已获 MCP 准入。 [官方限制](https://vercel.com/docs/agent-resources/vercel-mcp)

## 4. monday.com：公开集成登记；个人测试可先用 token

面向 Setsuna 用户公开提供集成：

1. 打开 [MCP 集成登记表](https://forms.monday.com/forms/c2aedf208f6c156932392e3a786d4d41?r=use1)。
2. 填写公司或项目资料、集成方式、使用 monday MCP 的用途，提交审核。
3. 获准后通过动态客户端注册和用户 OAuth 接入 `https://mcp.monday.com/mcp`；这条公开接入路径无需先创建普通 monday App。 [官方公开集成流程](https://developer.monday.com/api-reference/docs/mcp-dynamic-client-registration)

仅自己测试：登录 monday → 右上头像 → **Developers → My access tokens**，取个人 token；在 MCP 请求中使用 `Authorization: Bearer <token>`。这是个人测试路径，不能把自己的 token 分发给其他用户。 [官方 token 步骤](https://developer.monday.com/api-reference/docs/mcp-api-token)

如果组织要独立 OAuth App：**Developers → Create app**，填 App Name 和 App Slug；在 **Build → OAuth & Permissions** 配 scopes（只读可先用 `boards:read`）和实际 Redirect URL；在 **General Settings → App Credentials** 保存 Client ID / Secret。Setsuna 还需补齐对应认证。组织要强制所有用户走自己的 App 时，才需要额外评估关闭 hosted connector；普通测试不用改全组织开关。 [官方自定义 App 流程](https://developer.monday.com/api-reference/docs/control-mcp-access-with-oauth-app)

## 5. Google：Gmail、Calendar、Drive 一起准备

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建项目，例如 `Setsuna Desktop`，记下 **Project ID**。这三个服务可以在同一项目里启用，不需要分别建三个项目。
2. 打开 [Workspace Developer Preview Program](https://developers.google.com/workspace/preview)，通过页面上的申请入口提交 Workspace 账户和 Cloud 项目信息，等待项目获准。当前三个官方远程 MCP 都处于预览；普通 Gmail 账户不等于已具备该预览资格。官方还要求预览功能在正式发布前不得放进公开应用。
3. 在项目的 **APIs & Services → Library** 启用下面六项服务；若 MCP API 不可见或不可启用，先确认预览资格。

| 插件 | 产品 API 服务名 | MCP API 服务名 |
| --- | --- | --- |
| Gmail | `gmail.googleapis.com` | `gmailmcp.googleapis.com` |
| Google Calendar | `calendar-json.googleapis.com` | `calendarmcp.googleapis.com` |
| Google Drive | `drive.googleapis.com` | `drivemcp.googleapis.com` |

4. 打开 **Google Auth Platform → Branding → Get Started**，设置名称及邮箱。Audience 只服务自己 Workspace 组织时可选 Internal；否则选 External，并在 Testing 状态下把自己的邮箱加入 **Test users**。
5. 在 **Data Access → Add or Remove Scopes** 添加所需权限。官方当前入门文档给出的权限如下；Calendar 此组是读取日历、空闲及事件，不能据此声称已允许写事件。

| 服务 | 官方入门权限（完整前缀均为 `https://www.googleapis.com/auth/`） |
| --- | --- |
| Gmail | `gmail.readonly`、`gmail.compose` |
| Calendar | `calendar.calendarlist.readonly`、`calendar.events.freebusy`、`calendar.events.readonly` |
| Drive | `drive.readonly`、`drive.file` |

6. **Clients → Create Client** 是创建凭据的入口。当前官方 MCP 示例针对服务端连接器使用 **Web application**，需要 Client ID、Secret 和精确回调。可以按此建立个人开发用客户端记录，但 Setsuna 尚未提供可填写的固定回调；没有确定回调前不要开始授权。面向公开桌面分发时，需要另外确定原生 OAuth 或服务端方案，不能把开发用 Web 客户端 Secret 打包成公共秘密。
7. 保存项目 ID、OAuth 客户端 ID、下载的凭据 JSON 和预览批准邮件。完成 Setsuna 适配后再逐项授权。OAuth 的公开应用验证与 MCP 预览批准是两件事。

依据：[Gmail MCP 配置](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server)、[Calendar MCP 配置](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server)、[Drive MCP 配置](https://developers.google.com/workspace/drive/api/guides/configure-mcp-server)、[Google 原生应用 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)。

## 6. Slack：创建内部测试 App

1. 打开 [Slack Apps](https://api.slack.com/apps)，选择 **Create New App → From scratch**，命名 `Setsuna Desktop`，选择自己的测试 workspace。
2. 在 **Basic Information → App Credentials** 记录 **Client ID** 和 App ID；二者不同。不要沿用 OpenAI 插件里已有的另一应用 Client ID。
3. 在 **OAuth & Permissions** 配置用户权限。只查公开消息可先用 `search:read.public`；读取公开频道历史再加 `channels:history`；需要发消息才加 `chat:write`。私有频道、私聊、文件搜索按实际功能追加各自权限。
4. 桌面公开客户端路线在该页启用 **PKCE**，用新测试 App 操作：开启后不能自行关闭，需要 Slack 支持协助恢复；桌面回调不得请求 Bot scopes。这条路线可以避免在客户端放 Secret。
5. 配置实际支持的 **Redirect URLs**。当前 Setsuna 回调尚需适配，不要先填猜测地址。完成后在自己的 workspace 安装并以用户身份授权，连接 `https://mcp.slack.com/mcp`。
6. 内部 App 用于自己组织；让任意 Setsuna 用户接入则需要 Slack Marketplace 发布审核。未上架的公开分发 App 不能使用 Slack MCP。

依据：[Slack MCP 身份与权限](https://docs.slack.dev/ai/slack-mcp-server/)、[PKCE 配置](https://docs.slack.dev/authentication/using-pkce/)、[官方 App 创建示例](https://docs.slack.dev/ai/slack-mcp-server/developing/)。

## 7. Dropbox：创建自定义客户端 App

1. 打开 [Dropbox App Console](https://www.dropbox.com/developers/apps)，点击 **Create app**。
2. 按官方 MCP 自定义客户端流程选择 **Scoped access → Full Dropbox**，填唯一应用名，例如 `Setsuna Desktop`（重名则加自己的标识）。
3. 在 **Permissions** 选择功能需要的权限。官方完整 MCP 配置列出：`files.metadata.read`、`files.content.read`、`files.content.write`、`sharing.write`、`account_info.read`、`sharing.read`、`file_requests.read`、`file_requests.write`。只做读取时先不要授予写权限。
4. 在 **Settings → OAuth 2 → Redirect URIs** 添加 Setsuna 实际回调；目前先等待固定回调及认证适配。
5. 保存 **App key（即 Client ID）** 和 App secret。用自己的账户联调，目标为 `https://mcp.dropbox.com/mcp`。
6. 若只想先验证个人连接，可以使用该页生成的短期 access token，以 Bearer header 连接；它不是长期登录方案。公开分发前另核实 App 的生产访问状态。

Dropbox 的自动注册仅开放给可信客户端；官方对其他客户端明确提供上述手动建 App 流程，也可通过 Dropbox Support 询问加入可信名单。 [官方完整步骤](https://help.dropbox.com/integrations/connect-dropbox-mcp-server)

## 8. Zoom：General App + 用户级 OAuth

1. 登录 [Zoom App Marketplace](https://marketplace.zoom.us/)，使用具有开发权限的账户，进入 **Develop → Build an app → General app**。
2. 命名 `Setsuna Desktop`，配置 **User-managed / 用户级 OAuth**。此插件需要用户授权访问自己的会议数据。
3. 当前缓存的 Zoom 插件使用 Meetings MCP：`https://mcp.zoom.us/mcp/meeting/streamable`。在 **Scopes → Add scopes** 添加所需的 `meeting:read:search`、`meeting:read:assets`、`cloud_recording:read:list_user_recordings`、`cloud_recording:read:content`。
4. 桌面公开客户端路线在 **Basic Information → App Credentials** 打开 **Use Public Client OAuth**，保存生成的 **Public Client ID**。它与普通保密客户端 ID 不同；该路线使用 PKCE，不需要嵌入 Client Secret。
5. 在 **OAuth Information** 配置实际 Redirect URL 及 allowlist。当前 Setsuna 尚需配套适配，因此这里不能填臆测地址。
6. 完成后用 **Local Test → Add App Now** 测试自己的账户。开发和生产凭据分开记录；公开分发再走 Zoom 对应的应用发布流程。

Zoom 明确不支持 DCR/CIMD，必须自行建应用。资料：[MCP 手动注册要求](https://developers.zoom.us/docs/mcp/servers/connect-to-zoom-mcp-servers/)、[General App 创建](https://godevelopers.zoom.us/docs/integrations/create/)、[Public Client OAuth](https://developers.zoom.us/docs/integrations/oauth/)、[官方插件的 Meetings 权限表](https://github.com/zoom/zoom-plugin-claude/blob/main/skills/zoom-mcp/concepts/oauth-setup.md)。

## 9. Airtable：通常跳过，以下是可选手动流程

官方 MCP 现已支持动态客户端注册（DCR）。缓存插件中的 `<AIRTABLE_PUBLIC_CLIENT_ID>` 不能证明平台必须手动注册；该占位配置本身也需要 Setsuna 处理。通常应先走自动注册。 [官方 MCP 认证说明](https://airtable.com/developers/agents/mcp/getting-started)

如果组织要求预先审批特定 App：

1. Airtable 首页右上头像 → **Builder Hub → OAuth integrations → Register an OAuth integration**。
2. 填名称及实际 OAuth redirect URL；目前 Setsuna 固定回调尚未就绪，不要先填假地址。
3. 注册后在 **Developer details** 记录 Client ID。服务端场景可以生成可选 Secret；不能把“可选”误当成必填。
4. 在 Scopes 中先选择 `data.records:read`、`schema.bases:read`；写记录、改结构、评论等按需要追加。管理员按组织策略审批该 App。
5. 完成 Setsuna 适配后填写 Client ID，连接 `https://mcp.airtable.com/mcp`，在授权界面选择具体 bases/workspaces。

菜单依据：[Builder Hub 官方注册步骤](https://support.airtable.com/articles/9362950318-using-builder-hub-in-airtable)。

## 以下优先直接连接，不用先注册开发者 App

这是官方文档提供的标准连接路线；不代表已经实测所有服务在当前 Setsuna 中成功。组织策略、服务区域、套餐和用户自身权限仍可能影响授权。

| 插件 | 你需要做的事 | 官方依据 |
| --- | --- | --- |
| Airtable | 直接 OAuth；组织要求独立 App 时才走上面的可选流程 | [MCP 认证](https://airtable.com/developers/agents/mcp/getting-started) |
| Atlassian Rovo | OAuth 登录；遇组织限制，由管理员检查回调允许名单 | [授权阻断排查](https://support.atlassian.com/rovo/kb/fix-oauth-consent-block-for-atlassian-rovo-mcp-server-in-atlassian-cloud/) |
| ClickUp | 通过 MCP 连接并登录授权 | [MCP 设置](https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server-1) |
| Cloudflare | OAuth 登录并选择所需账户权限 | [官方托管 MCP](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) |
| Consensus | 登录 Consensus 授权；不同客户端可用工具存在差异 | [MCP 入门](https://docs.consensus.app/docs/mcp) |
| Datadog | 按自己的 Datadog site 使用相应 MCP 地址，走 OAuth；无需因 US1 模板不适用就创建 App | [设置](https://docs.datadoghq.com/mcp_server/setup/?lang_pref=en)、[动态注册](https://docs.datadoghq.com/api/latest/oauth2-client-public/register-an-oauth2-client/) |
| Granola | 登录有会议笔记的账户并授权 | [MCP 设置](https://docs.granola.ai/help-center/sharing/integrations/mcp) |
| Higgsfield | 使用有有效付费订阅的账户登录，无需另办 API key | [官方连接指南](https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-connect-higgsfield-to-ai-agent) |
| Linear | 标准 OAuth 动态注册并授权 | [MCP 文档](https://linear.app/docs/mcp) |
| Notion | 标准 OAuth 动态注册并授权 | [自定义 MCP 客户端](https://developers.notion.com/guides/mcp/build-mcp-client) |
| PostHog | 配置 MCP 地址并完成账户认证 | [官方文档源码](https://github.com/PostHog/posthog.com/blob/master/contents/docs/model-context-protocol/index.mdx) |
| Sentry | 标准 OAuth 动态注册并授权 | [官方 MCP 入口](https://mcp.sentry.dev/) |
| Stripe | OAuth 授权；管理员按需启用 sandbox/live 对应 MCP 访问 | [MCP 文档](https://docs.stripe.com/mcp?locale=en-GB) |
| Supabase | 标准 OAuth 动态注册，选择组织/项目 | [MCP 文档](https://supabase.com/docs/guides/ai-tools/mcp) |

## 其余条目为什么不在注册队列

以下是对本机缓存插件定义的判断，不是声称这些厂商没有其他 API 或开发者平台：

- **Shopify**：插件指定 `https://setup.shopify.com/mcp` 和 `<SHOPIFY_PUBLIC_CLIENT_ID>`，本次未找到该端点对应的官方自助注册流程。普通 Shopify App、Dev MCP 与此端点不能直接等同，暂缓。
- **Teams、SharePoint、Outlook Email、Outlook Calendar、Adobe、Lovable、ChatCut、Public Equity Investing**：当前包依赖宿主托管 App，没有可直接替代的远程 MCP 配置。单独注册 Microsoft/Adobe 等 App 不会自动补上 Setsuna 的工具实现；需先确定独立连接方案。
- **Data Analytics、Creative Production、Codex Security、OpenAI Developers**：包含宿主能力、托管 App 或本地工具链，不能把其中一个本地 MCP 可加载当作全部服务已接通。
- **CrowdStrike Falcon Foundry、CrowdStrike Falcon Fusion、Qodo**：当前条目是外部仓库来源，未在本次缓存内完整审计。先解决来源导入和具体连接方案，不要求你盲建 OAuth App。
- **Game Studio、Superpowers、CircleCI、Build iOS Apps、Build macOS Apps、Build Web Apps、Build Web Data Visualization、Test Android Apps、Life Science Research、Zotero、Expo、CodeRabbit、Remotion、Plugin Eval、Temporal、Hyperframes、Twilio Developer Kit、Mixpanel Headless、NVIDIA、NGS Analysis、MagicPath、OpenAI Ads Conversions、Boltz API CLI、Product Design**：当前插件入口没有要求你为 Setsuna 手工登记远程 OAuth 客户端；其中具体工作流可能另外需要 CLI 登录、API key、平台账户或本机依赖，使用到时再按该工具配置。

## 办理记录

不要在这里填写 Secret 或 token。

| 平台 | 项目 / App ID / Client ID | 申请编号与状态 | 回调已确认 | Setsuna 已联调 |
| --- | --- | --- | --- | --- |
| Figma | | | 否 | 否 |
| Canva | | | 否 | 否 |
| Vercel | | | 否 | 否 |
| monday.com | | | 否 | 否 |
| Google | | | 否 | 否 |
| Slack | | | 否 | 否 |
| Dropbox | | | 否 | 否 |
| Zoom | | | 否 | 否 |
| Airtable（可选） | | | 否 | 否 |
