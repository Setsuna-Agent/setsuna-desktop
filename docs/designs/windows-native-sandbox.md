# Windows 原生沙箱 V1

状态：已实施，目标平台为 Windows x64。

## 目标

- Windows 的受限 shell 默认不能静默退化为宿主执行。
- 日常执行不提权；只有安装、修复和卸载触发 UAC。
- 离线命令完全禁止网络，在线命令只能经过 Setsuna 管理的认证出口。
- 工作区写入、受保护元数据和进程树由 Windows 原生安全对象约束。
- sidecar、Electron main、preload、renderer 和 runtime 使用显式版本协议。

## 非目标与安全边界

这不是 microVM、容器或 Windows Sandbox。V1 不承诺：

- 抵御 Windows 内核漏洞或本机管理员；
- 隐藏所有宿主可读文件。受限账户仍可能读取原 DACL 已向普通用户开放的路径；
- 表达路径级 read deny 或 glob deny。请求包含 `deniedRoots` 或 `deniedGlobRegExpSources`
  时 provider 必须拒绝；
- 为尚不存在的 `.git`、`.agents`、`.codex` 子目录预留 NTFS deny。runtime 会保护执行前已存在的
  元数据目录并保留命令预检，但需要强 read confidentiality 或动态路径保留时应使用 VM 级 provider；
- 支持 UNC、映射网络盘、可移动盘或非 NTFS 工作区；
- 任意依赖 Windows Schannel 默认凭据的客户端都可用。restricted token 会拒绝默认凭据获取；runtime
  中的 `curl` 由随应用打包的 LibreSSL 版本承载，但显式调用系统 `curl.exe` 或 PowerShell
  `Invoke-WebRequest` 仍受这一限制；
- 把在线出口串接到上游代理。上游代理会接管 DNS，V1 无法把同一次已校验解析固定到最终 socket，
  因而 runtime 配置为代理路由时会 fail closed；
- 在 V1 中承载 app-server 的任意 argv/PTY 协议。该入口在 Windows 收到受限策略时仍保持 fail-closed。

因此 V1 的核心保证是：对支持的固定 NTFS 路径提供写入完整性边界，对子进程树提供生命周期边界，
并对网络提供离线或认证代理出口边界。

## 组件

### Rust sidecar

`native/windows-sandbox` 生成单个 `setsuna-sandbox-win.exe`，包含：

- `status` / `doctor`：验证协议、状态文件、账户标记、组关系、Winlogon 隐藏项、防火墙规则、
  生命周期锁和受保护 runner；
- `install` / `repair`：通过 `ShellExecuteExW(runas)` 执行一次提权安装；
- `uninstall`：只删除 SID 和管理标记均匹配的 Setsuna 身份；
- `run --request <absolute-json>`：读取并验证执行请求，配置 ACL，然后在隔离账户中启动命令；
- `internal-child`：在隔离账户登录会话内构造 restricted token 并创建最终 shell。

安装状态位于 `%ProgramData%\Setsuna Desktop\Sandbox`。两个随机账户密码使用 machine-scope DPAPI
加密，状态目录、状态文件和锁文件都使用 protected DACL；沙箱组具有显式 full deny。可由沙箱账户执行
但不能修改的 runner 副本位于 `%ProgramData%\Setsuna Desktop\Sandbox Runner`，每次状态检测都会复核其
protected DACL 和与当前打包 sidecar 的 SHA-256 一致性。账户和组带固定管理标记，避免接管同名既有身份，
并被隐藏于 Winlogon 用户列表。

`run` 在完整命令生命周期持有 shared lifecycle lock；安装、修复和卸载必须非阻塞地取得 exclusive lock。
仍有命令运行时，维护操作会直接拒绝，不会删除其账户 SID 对应的防火墙规则。

### Runtime provider

runtime 只从 `SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH` 使用绝对 sidecar 路径，不搜索 `PATH`。
每次执行创建独立临时根：

- `sandbox-request.json` 留在 control root，启动前只向所选隔离账户临时授予 read/delete；账户 runner
  读取并复核后、创建最终 restricted shell 前必须删除该文件；
- `work/` 才作为 `TEMP` / `TMP` 和可写临时根。

请求包含协议版本、命令、cwd、workspace、权限 profile、显式根、网络模式、筛选后的环境和 supervisor
PID。sidecar 同时监控 runtime 与 Electron main；任一监督进程退出都会终止 Job Object 中的完整进程树，
避免在线命令在本机认证代理消失后继续存活。

### Electron main 与设置页

Electron main 持有 sidecar 路径、UAC 生命周期和沙箱出口。preload 只暴露窄方法：

- `getStatus()`；
- `runAction('install' | 'repair' | 'uninstall')`。

设置页只在 Windows 显示状态卡，并按状态提供检测、安装、修复或卸载。所有 action 在 main 中串行化。

## 文件系统权限

安装创建 `SetsunaSandboxUsers`、`SetsunaSbOffline` 和 `SetsunaSbOnline`。两个用户名特意控制在
Windows 本地 SAM 账户的 20 字符限制内。执行时：

1. 所有输入路径先 canonicalize，并限制为固定本机 NTFS 卷；
2. readable roots 先用隔离账户 token 做真实 `AccessCheck`；命令特有的工具链文件仅在必要时向本次 logon SID
   临时授予 read/execute，且只修改所指对象，不向已有子树传播；
3. 每种稳定写策略生成一个 capability SID。新的 writable root 首次授权时安装可继承 capability ACE；后续命令
   先检查 ACE，命中缓存后不再改写目录树；每次执行独有的空临时目录只加非递归 logon SID ACE；
4. 如果隔离账户原本不能访问稳定 root，同时为稳定沙箱组安装对应 read 或 write ACE，让账户 token 检查和
   restricted SID 的写检查都能通过；
5. 已存在的 protected writable root 向 capability 安装稳定 write deny，覆盖从 workspace 继承的 allow；
6. Job Object 结束后只回收本次 logon SID 和 request-bootstrap ACE；稳定 capability、group 和 deny ACE 留作复用；
7. 受限 token 保留 `SeChangeNotifyPrivilege` 完成祖先遍历，但不会得到宿主用户的权限或凭据。

最终 shell 与上游 Codex 一样使用
`CreateRestrictedToken(DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED)`，但 restricting SID 和默认 DACL
列表收窄为 policy capability、专用隔离账户 SID 与本次 logon SID，默认 DACL 则只包含 capability 和 logon
SID。账户 SID 保持该专用账户自己的 Windows 运行时对象可用；这里有意不沿用上游 token 中的 `Everyone`，
否则宿主路径原有的宽泛写 ACE 会满足 restricting SID 的第二次检查并绕过策略，默认 DACL 中的 `Everyone`
也会让其他本机账户访问沙箱进程新建的命名对象。外层 account runner 从机器级只读副本启动，并被放入不可
breakaway、close 即 kill 的 Job Object。

为保留普通 shell 的 `>NUL` / `2>NUL` 重定向，执行准备会沿用上游的窄授权方式：在全局 ACL 锁内，只向
Windows `NUL` 设备对象上的当前 policy capability 添加读写执行 ACE。它不向 `Everyone` 放权，也不递归
修改任何文件目录。

`WRITE_RESTRICTED` 只对 write-like access 执行 restricting SID 二次检查。因此 V1 的原生边界是专用账户身份、
写入范围和网络出口，不把 readable roots 当作 workspace 之间的读取隔离边界；这与上游 Codex 的 Windows
sandbox 语义一致。需要 path-specific read deny 的策略会以 unsupported-policy 失败，而不是静默降级。

CI 的真实账户 smoke 会让未授权外部目录继承 `Everyone:Modify`，验证宽泛宿主 ACL 仍不能突破写入边界；
workspace-write 只能由 capability 或本次 logon SID 命中第二次写检查。

## 网络

Windows Firewall 规则与 WFP `ALE_AUTH_CONNECT` filter 共同按账户区分；WFP 层负责封住 Windows 对
loopback 流量的防火墙豁免：

- offline：阻断 loopback 与 non-loopback 的所有出站；
- online：阻断所有 non-loopback、所有 loopback UDP、全部 IPv6 loopback、除 `127.0.0.1` 外的
  IPv4 loopback，以及 `127.0.0.1` 固定代理范围以外的 TCP；另有按账户限定的显式 TCP allow，确保系统
  默认 outbound policy 为 block 时仍只能到达该固定范围。

允许范围为 `127.0.0.1:61080-61089`。Electron main 必须同时占用全部十个端口；任一端口已被其他
进程占用就 fail closed。所有 listener 使用每次应用启动随机生成的 Basic 凭据。代理拒绝 localhost、
单标签主机、私网、链路本地、组播和保留地址；direct route 的最终 DNS 结果也在交给 socket 前复核。
如果 runtime 路由解析为上游代理，环境下发和每次请求都会拒绝，因为代理侧 DNS 无法在本机可靠复核。

offline 请求会从最终环境删除全部 proxy 变量。online 请求只设置规范化的大写 `HTTP_PROXY`、
`HTTPS_PROXY`、`ALL_PROXY` 和空 `NO_PROXY`，避免 Windows 大小写不敏感的环境块出现重复键；随机
loopback relay 凭据只短暂存在于 control request，且在最终 shell 启动前删除。

Windows runtime 会把固定版本、固定 SHA-256 的 curl-for-win 放在 shell `PATH` 首位。该构建使用 LibreSSL，
不会调用 restricted token 下不可用的 Schannel 默认凭据。Electron main 在降权前读取桌面账号可见的 Windows
系统 CA，把它们与随包 Mozilla CA bundle 合成运行时信任快照，并通过 `CURL_CA_BUNDLE` 交给 shell；Windows
沙箱只获得这个 PEM 文件的读取权，不会递归放开数据目录。只读 `_curlrc` 仍通过 `--ca-native` 补充沙箱账号
自身可见的 Windows `ROOT`/`CA` 证书库。`curl.exe`、配置、Mozilla CA bundle、上游许可证和构建元数据一同
进入 release，并在打包后重新校验。系统 `C:\Windows\System32\curl.exe` 不会被修改。

## 状态转换与失败

| 状态 | 含义 | 可用操作 |
| --- | --- | --- |
| `not-installed` | 无有效状态文件 | 安装 |
| `ready` | 所有身份、ACL、隐藏项、防火墙规则和 WFP 对象通过 read-back | 卸载 |
| `needs-repair` | 状态损坏、版本变化或系统对象漂移 | 修复、卸载 |
| `unsupported` | 非 Windows x64 | 无 |
| `unavailable` | 桌面构建缺少 sidecar | 无 |

防火墙被组策略覆盖、活动 profile 被关闭、WFP 对象缺失、代理端口无法完整占用、配置了上游代理、路径无法由 NTFS ACL
表达、sidecar 协议不匹配或 supervisor 无法打开时，执行都失败，不进入宿主 shell。存在 active run 时，
修复和卸载同样 fail closed，要求先终止命令。

## 构建与验证

- CI 在一次性 `windows-2025` runner 上执行 rustfmt、Windows-target clippy、Rust tests，以及真实受限
  身份、私有 read-only workspace 的既有子项、已有 workspace 文件写入、protected root、带
  `Everyone:Modify` 的未授权外部目录、offline/online 出站、认证代理、临时 ACL 回收和共享父目录不变的 smoke
  test；网络策略
  使用随测试构建、但不进入产品包的原生 probe 验证，最后无条件卸载测试身份；
- release 的 Windows job 从锁定的 `Cargo.lock` 构建 MSVC release binary；
- before-pack 复制 binary、Apache-2.0 license、NOTICE 和 SHA-256 metadata；
- after-pack 再校验完整文件清单、哈希、协议、版本和 sidecar `version` 输出；
- TypeScript 单测覆盖 provider、fail-closed policy、IPC manager、native bridge、代理认证与端口占用。

现有 smoke test 不会覆盖 UAC UI、崩溃监督和完整网络逃逸矩阵；这些场景仍应在可丢弃的 Windows VM
中作为发布门禁。交叉编译只能验证 Win32 binding 和类型完整性。

## 设计依据

- [OpenAI：Building a safe, effective sandbox to enable Codex on Windows](https://openai.com/index/building-codex-windows-sandbox/)
- [OpenAI Codex：windows-sandbox-rs/token.rs](https://github.com/openai/codex/blob/main/codex-rs/windows-sandbox-rs/src/token.rs)
- [Microsoft：CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)
- [Microsoft：Application Layer Enforcement](https://learn.microsoft.com/en-us/windows/win32/fwp/application-layer-enforcement--ale-)
- [Microsoft：FwpmFilterAdd0](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmfilteradd0)
- [Microsoft：New-NetFirewallRule](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)
