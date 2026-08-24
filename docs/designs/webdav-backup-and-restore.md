# WebDAV 自动备份与手动还原

状态：已实施，并迁移为内置 `webdav-sync` Feature

基线：`master@38d575646`

评审日期：2026-08-10

## 结论

这个功能值得做。Setsuna Desktop 是 local-first 应用，对话、记忆、用户 Skill 和模型配置主要保存在本机；设备损坏、换机或误操作都会造成高价值数据丢失。WebDAV 又能覆盖 NAS、Nextcloud 和大量自托管服务，符合项目不绑定单一云厂商的定位。

第一版明确定位为“自动更新一份加密备份 + 经审查的手动还原”，而不是多设备双向合并：

- 应用空闲时自动用选中数据更新远端备份。
- 用户可以随时手动立即备份。
- 不自动下载、不自动合并，也不自动覆盖本地数据。
- 还原前必须生成新增、覆盖、删除和保留清单，用户确认后才执行。
- 正常状态下服务器只保留最新一份完整备份；多台设备共用仓库时，以最新完成且可验证的备份为准，并显示来源设备。

设置页继续在“模型与服务”分组使用“同步”入口，但入口和完整页面由 renderer Feature contribution 注册；产品文案使用“自动备份”“立即备份”“手动还原”，避免让用户误以为两台设备会自动合并修改。

## 目标与非目标

### 已实现目标

- 配置 WebDAV URL、远端目录、用户名、密码或 app password。
- 创建新的端到端加密仓库，或用恢复密钥连接现有仓库。
- 按数据域勾选备份内容，配置成功后默认开启自动备份。
- 远端只保留一份当前完整备份；替换成功前不会删除上一份可恢复备份。
- 还原前展示来源设备、时间、应用版本、完整统计和破坏性条目清单。
- 还原使用短生命周期 plan、本地指纹复核、回滚目录和崩溃恢复日志。
- 原始凭据文件永不上传；选中的模型 API Key 只以客户端加密密文进入 WebDAV。
- 项目可以独立于目录存在；新增和编辑共用项目配置弹窗，可随时绑定、更换或解除本机目录。

### 明确非目标

- 多设备实时或双向合并。
- 自动拉取、自动还原或无人确认的本地覆盖。
- 同步用户项目目录、任意外部文件夹或 Git 仓库。
- 把活动数据根放到 WebDAV、网络盘或云盘同步目录中运行。
- 还原后自动验证每个模型 API Key 是否仍然有效。

## 数据范围

| 数据域 | 默认 | 还原语义 | 实际内容 |
| --- | --- | --- | --- |
| 对话与附件 | 开 | 整域替换 + 项目关联 | `threads.sqlite` 的一致性副本、attachments、generated images，以及不含目录路径的加密项目清单。SQLite 使用 backup API，不直接拷贝活动 WAL 组合。 |
| 长期记忆 | 开 | 整域替换 | Runtime memory store 及其 baseline/rollout 等恢复所需文件。 |
| 偏好与模型配置 | 开 | 白名单覆盖 + 安全合并 | Global prompt、memory 设置、task model、Setsuna style、provider/model 非敏感元数据、image generation 元数据、vision reference、Workspace Dependencies 的 npm/Python 包源、界面语言和 Markdown 链接打开方式。 |
| 模型 API Key | 开 | 同 ID 覆盖，仅本机 Key 保留 | Provider API key 和 image generation API key。每个 Key 是独立清单条目，不上传整个 `secrets.json`。 |
| 用户 Skill | 开 | 用户 Skill 整域替换 | `user-skills/` 内容和这些用户 Skill 的 enabled 状态。Bundled、Plugin 和 external Skill 状态保留本机值。 |
| Usage 历史 | 关 | 整域替换 | `usage.jsonl`。它主要用于本地统计且持续增长，因此默认不选。 |

“偏好与模型配置”不是原样上传 `config.json`。导出和还原会强制以下边界：

- 不包含 provider proxy route；同 ID provider 还原时保留目标设备的代理路由。
- 不包含 `approvalPolicy`、`permissionProfile`、sandbox network/workspace roots。
- 不包含 Hook command、trusted hash、`bypassHookTrust` 或 developer feature flags。
- Workspace Dependencies 只包含其 portable Feature settings 中的 npm/Python 包源 URL；不包含工具链、cache 和安装路径。
- 远端 provider 按稳定 ID 覆盖可移植字段；目标设备独有 provider 保留。

### 明确不备份

| 数据 | 原因 |
| --- | --- |
| `secure-credentials.json`、`runtime/secrets.json` 原文件 | 不复制 OS 密文或整个 secret store。只提取已知 provider/image API key，并在内存中立即加密。 |
| WebDAV 密码和仓库恢复密钥 | 只保存在当前设备的 credential vault，备份不递归包含自身配置。 |
| Network proxy 密码、MCP env/header secret、OAuth token | 属于设备或 session 凭据，目标设备必须重新配置。 |
| Tool approval、policy amendment、PC local policy | 把“永久允许”带到另一台设备会扩大权限。 |
| MCP 配置、Plugin bundle/trust、外部 Skill root | 包含本机命令、路径、凭据或可执行信任边界，第一版不同步。 |
| 项目关联的外部 workspace/Git 内容及其绝对路径 | 不属于 Setsuna managed data root，应由 Git 或用户备份方案管理；只备份项目名称与内部 ID。 |
| Chromium profile、Cookies、Local/Session Storage、浏览器登录态 | 体积大、格式不稳定且包含敏感 session。 |
| Window state、当前 thread、review layout、terminal/process 状态 | 设备相关或短生命周期，恢复价值低。 |
| Workspace Dependencies 的 Python/Node/uv toolchain、cache、安装目录，以及 logs、debug trace | 可重建且跨操作系统不兼容。包源 URL 已随 portable Feature settings 备份。 |

## API Key 的换机体验

不备份 API Key 确实会让新设备必须重新查找每家模型服务的密钥，因此“模型 API Key”是默认开启的独立数据域。

它不依赖复制 `secrets.json`：

1. 备份时只枚举 provider ID 对应的 API key 和 image generation key。
2. 每个 Key 在内存中成为独立对象，立即用恢复密钥加密，不写入明文 staging。
3. 清单只显示 provider 名称和新增/覆盖/保留动作，不显示 key preview、长度、前后缀或 hash。
4. 还原时，同 provider ID 的本地 Key 会被备份值覆盖；只存在于目标设备的 Key 会保留。
5. 目标设备重新写入自身的 `secrets.json`，文件权限收紧为 `0600`（Windows 由平台 ACL 处理）。

因此新设备仍需要 WebDAV 地址、账号/app password 和 Setsuna 恢复密钥，但成功打开仓库后，可以一次恢复已选中的模型 API Key，不需要逐个平台重新查找。

## 项目的换机语义

项目分为两层：可跨设备的“项目身份”和仅本机有效的“目录绑定”。项目名称是跨设备匹配键，内部 ID 用于保持对话与记忆关联；绝对目录、Git root 和项目文件不进入备份。

- 新建和编辑项目使用同一个项目配置弹窗。用户可以只填写名称创建空项目，也可以同时绑定目录。
- 还原时，备份项目与本机同名项目匹配后复用本机项目 ID，并保留本机已有目录，不用远端状态覆盖。
- 没有同名项目时创建未绑定目录的项目，对话仍归在该项目下；用户还原后通过项目配置弹窗手动关联目录。
- 还原提交前在暂存的 SQLite 数据库和记忆索引中重写源项目 ID，避免新设备出现不可见的孤儿对话。
- 本机存在同名项目歧义时停止备份或还原，要求用户先重命名，而不是静默猜测目标。

## 安全模型

### 连接与凭据

- URL、远端目录、用户名、数据域、自动备份开关和设备 ID 保存在 `webdav-sync.json`。
- WebDAV 密码和恢复密钥由 `DesktopCredentialVault`/Electron `safeStorage` 保护；renderer 只看到 `passwordSet`/`recoveryKeySet`。
- URL 禁止内嵌用户名、密码、query 和 fragment；远端路径按单个 segment 编码和校验。
- 默认要求 HTTPS。Loopback HTTP 允许；其他 HTTP 必须由用户显式勾选高风险选项。
- 使用 Basic Auth，禁止自动跟随重定向，避免 `Authorization` 泄漏到另一个 origin。
- 连接表单可在不保存密码或连接配置的情况下独立测试；密码和恢复密钥均提供显式的显示/隐藏控制。
- “测试连接”会执行认证以及随机小文件的 PUT、GET 和 DELETE，不会只凭 `OPTIONS` 或可读判定备份可用；创建模式只保留所需远端目录，随机测试文件会删除。
- 网络错误会区分 DNS、TLS、拒绝连接、超时和代理路由问题；renderer 会移除 Electron IPC 包装，只展示一份可操作错误。
- WebDAV 请求复用 desktop network proxy 体系中独立的 `sync` scope。

### 端到端加密

- 创建仓库时生成 256-bit 随机恢复密钥，只在首次创建结果中显示给用户保存。
- 每个 object 使用 AES-256-GCM、随机 96-bit nonce 和独立 authentication tag。
- Associated data 绑定 repository ID、内部备份 ID 和 object name，防止密文在仓库或两次备份间被无声替换。
- Snapshot manifest 同样加密；对话标题、provider ID、文件路径和内容 hash 不以明文出现在 WebDAV。
- 下载后先做 GCM 认证，再复核 manifest 声明的 SHA-256 和明文字节数。
- 元数据、PROPFIND 响应和 object 下载都有流式大小上限，不依赖服务端如实返回 `Content-Length`。

WebDAV 服务端仍能看到仓库格式版本、随机 repository/device ID、内部备份 ID 中的时间、密文对象数量和大小。这是当前格式明确接受的流量元数据。

## 远端格式与发布

```text
<configured-root>/setsuna-backup/v1/
├── repository.json
└── devices/
    └── <device-id>/
        └── snapshots/
            └── <created-at>-<random-id>/
                ├── objects/
                │   ├── 000001.enc
                │   └── ...
                ├── manifest.enc
                └── complete.json
```

- `repository.json` 是最小明文元数据，包含格式版本、repository ID、创建时间和随机恢复密钥的 HMAC verifier；不包含恢复密钥。
- 带时间戳的 `snapshots/` 目录只是安全发布和替换机制，不向用户提供历史版本能力。
- 对象和 manifest 使用 `If-None-Match: *` 发布，避免尚未完成的新备份覆盖当前备份。
- `complete.json` 最后写入。还原只认这个标记存在且 manifest 能正确解密的备份。
- 上传中断时立即尽力删除未完成目录，当前完整备份保持不变；进程意外退出留下的残片会在下一次成功备份后清理。
- 新备份完整发布后，从远端状态选出最新且可验证的备份，再删除其他设备或旧格式遗留的备份目录。替换期间会短暂同时占用新旧两份空间。

## 自动备份

当前固定调度策略：

- 首次成功配置后 5 分钟进行第一次自动备份。
- 此后以上次成功备份时间为基准，每 6 小时备份一次。
- 如果 Runtime 存在活动任务或本地 mutation，自动备份不取消用户任务，15 分钟后重试。
- 手动备份最多等待 Runtime 空闲 30 秒，并且可在停止 Runtime 前取消。
- 应用关闭时取消正在进行的可取消操作；它不承诺应用退出后继续后台备份。

一致性处理：

1. Main 通过仅内部可用的 Runtime route 关闭新 turn/thread mutation admission。
2. Runtime flush thread store。
3. Main 使用 `node:sqlite` backup API 创建一致性数据库副本，其他 JSON 文件依赖 store 的原子写入边界。
4. 管理目录中的符号链接和特殊文件会使备份失败，防止越界读取。
5. 明文工作目录位于 data root 下的 `.webdav-sync-work`，成功、失败和下次启动时都会清理；API Key 不会写入该目录的明文文件。

## 手动还原与本地损失清单

还原分为“检查”和“提交”两个独立动作：

1. 用户查看当前备份并选择要还原的数据域。
2. 应用解密 manifest，对当前本地数据建立同样的 inventory。
3. 按稳定 logical path/provider ID 生成 `新增`、`覆盖`、`删除`、`保留` 统计和条目；项目另列“复用同名项目”与“新建未绑定项目”。
4. UI 使用与模型列表同步确认一致的模态弹窗，逐项展示项目关联、覆盖和删除的本地内容，并再次显示“将覆盖 X 项、删除 Y 项”。列表超过 100 项时只渲染前 100 项，但数量是完整统计，并明确显示截断警告。
5. 用户必须勾选“已检查清单”，“还原并重启”按钮才可用。

Restore plan 有 10 分钟有效期，并保存本地 inventory fingerprint。真正提交前会重新读取远端 manifest 和本地 inventory；只要任一方发生变化，必须重新生成清单。

提交流程：

1. 下载选中对象，在非活动 staging 完成认证解密、size/hash 和路径校验。
2. 再次锁定 Runtime；Runtime 根据当前已注册 Feature catalog 校验、迁移 portable settings，并在 staging 生成新的本地 revision/secret reference。未知、未 opt in 或过新 schema 会在停进程前失败。
3. 在锁内导出最终 Feature 投影，然后停止 Runtime，重建本地 inventory 并复核用户确认过的影响集合。旧快照中不存在的新 portable Feature 设置按本地保留项处理。
4. 对项目清单、可移植配置、API Key 和用户 Skill 状态执行安全合并，并在 staging 重写项目引用；未选数据域完全不动。
5. 将当前目标 rename 到 data root 内的随机 rollback 目录，再安装已验证数据。
6. 每次提交先原子写入 `.webdav-sync-restore.json`。进程在 rename 中崩溃时，下次 Runtime 启动前根据受校验的数据域目标和严格 Feature settings 路径语法自动回滚，不依赖业务 Feature 白名单。
7. 提交完成后 relaunch。新 Runtime 能正常启动后才清理 rollback；如果恢复后的数据导致 Runtime 启动失败，先回滚到原本地数据再重试启动。

## 分层与边界

| 层 | 职责 |
| --- | --- |
| `packages/features/webdav-sync/contracts` | WebDAV config/state、category、snapshot summary、restore plan/diff、固定 IPC channel 和 preload bridge contract。 |
| `packages/features/webdav-sync/main` | 配置、客户端、加密仓库、数据域/路径边界、调度、restore plan、回滚日志、IPC 与 relaunch 编排；不持有业务 Feature settings schema 清单。 |
| `packages/features/webdav-sync/preload` | 固定 IPC 方法和 state-change subscription；不暴露 raw `ipcRenderer`。 |
| `packages/features/webdav-sync/renderer` | “同步”设置 contribution、连接表单、数据域选择、进度、当前备份、还原损失清单、文案与作用域样式。 |
| `packages/desktop-runtime` | 提供 quiescence gate、已注册 portable Feature settings/credentials projection，以及恢复校验、schema migration 和隔离 staging；还原时由 main 停止并重启 Runtime。 |
| Electron main 宿主 | 注入 credential vault、network proxy fetch、data-root layout/持久化事务、Runtime 生命周期和窗口；Runtime 启动前执行崩溃恢复，启动成功后确认提交。 |

Renderer 不获得 WebDAV Authorization、密码、本地恢复密钥、Runtime token/port 或 staging 路径。

Feature 通过四个显式进程入口参与组合，不再向共享 `SetsunaDesktopBridge`、`SettingsPage` 或宿主 i18n catalog 回填 WebDAV 分支。宿主只保留无法下沉的安全能力和启动顺序。

## 当前限制与后续

- 调度间隔目前是固定值，还没有基于数据 revision 跳过内容没有变化的备份。
- 当前每次都会上传完整备份，尚未做增量传输或内容去重；替换过程中服务器需要短暂容纳新旧两份数据。
- 只支持 Basic Auth，不支持 Digest/OAuth 式 WebDAV 登录。
- 还原破坏性清单暂无“导出完整文本”功能；大于 100 项时 UI 显示完整数量和前 100 项。
- 还原后不自动调用模型服务检查 API Key 有效性；受 IP 限制、已撤销或过期的 Key 仍需用户在模型设置中处理。
- portable Feature settings 的解释权已归 Runtime catalog；WebDAV main 只保留冻结的旧 config 兼容投影和快照传输。Feature credential 的 manifest transport 目前仍只覆盖现有图片生成凭据，扩展新凭据类型时需要先把该 transport identity 泛化。

## 验证覆盖

定向单测覆盖：

- URL/路径/恢复密钥校验、HTTPS 默认策略和重定向拒绝。
- AES-256-GCM buffer/file 流式加解密、空文件、AAD 和错误密钥拒绝。
- Credential vault 分离、待清理凭据 journal 和空数据域拒绝。
- 旧版代理配置缺少 `sync` scope 时自动按“跟随全局”兼容，原有代理和路由不丢失。
- SQLite 一致性备份、符号链接拒绝、配置/Skill 状态白名单。
- 安全发布与单份滚动替换、加密 manifest、写权限探测和远端无 API Key 明文。
- Restore diff、本地指纹过期、安全合并、`0600` 密钥文件、崩溃日志回滚/延迟清理。
- 端到端 service 流程：创建仓库 → 备份配置/API Key → 本地修改 → 生成清单 → 手动还原。
- Renderer 连接表单：密码显隐、不落盘测试、Electron IPC 错误去包装和单一错误展示。
- Renderer 弹窗清单交互：明确显示覆盖/删除条目，未勾选确认时还原按钮禁用。
