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
- 在 V1 中承载 app-server 的任意 argv/PTY 协议。该入口在 Windows 收到受限策略时仍保持 fail-closed。

因此 V1 的核心保证是：对支持的固定 NTFS 路径提供写入完整性边界，对子进程树提供生命周期边界，
并对网络提供离线或认证代理出口边界。

## 组件

### Rust sidecar

`native/windows-sandbox` 生成单个 `setsuna-sandbox-win.exe`，包含：

- `status` / `doctor`：验证协议、状态文件、账户标记、组关系、Winlogon 隐藏项、防火墙规则和状态 ACL；
- `install` / `repair`：通过 `ShellExecuteExW(runas)` 执行一次提权安装；
- `uninstall`：只删除 SID 和管理标记均匹配的 Setsuna 身份；
- `run --request <absolute-json>`：读取并验证执行请求，配置 ACL，然后在隔离账户中启动命令；
- `internal-child`：在隔离账户登录会话内构造 restricted token 并创建最终 shell。

安装状态位于 `%ProgramData%\Setsuna Desktop\Sandbox`。两个随机账户密码使用 machine-scope DPAPI
加密，状态目录、状态文件和锁文件都使用 protected DACL；沙箱组具有显式 full deny。账户和组带固定
管理标记，避免接管同名既有身份，并被隐藏于 Winlogon 用户列表。

### Runtime provider

runtime 只从 `SETSUNA_DESKTOP_WINDOWS_SANDBOX_PATH` 使用绝对 sidecar 路径，不搜索 `PATH`。
每次执行创建独立临时根：

- `sandbox-request.json` 留在 control root，只向本次登录唯一的 logon SID 授予读取；
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

1. 本次登录唯一的 logon SID 同时存在于账户 token 和 restricting SID 列表，避免并发或历史工作区串读；
2. policy-scoped capability SID 作为 restricting SID，满足 write-restricted 的第二次写访问检查；
3. readable roots 向本次 logon SID 授予 read/execute；
4. writable roots 同时向 logon SID 和 capability 授予写入；
5. 已存在的受保护元数据根向 capability 添加 write deny；
6. 所有输入路径先 canonicalize，并限制为固定本机 NTFS 卷。

最终 shell 使用 `CreateRestrictedToken(DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED)`，默认 DACL
只包含 capability SID、本次 logon SID 和 Everyone SID。三者也构成 restricting SID 列表：Everyone 保持
常规 Windows 对象兼容性，logon SID 限定本次会话，capability SID 表达明确可写根。外层 runner 被放入
不可 breakaway、close 即 kill 的 Job Object。

## 网络

防火墙按账户区分：

- offline：阻断 loopback 与 non-loopback 的所有出站；
- online：阻断所有 non-loopback、所有 loopback UDP、全部 IPv6 loopback、除 `127.0.0.1` 外的
  IPv4 loopback，以及 `127.0.0.1` 固定代理范围以外的 TCP。

允许范围为 `127.0.0.1:61080-61089`。Electron main 必须同时占用全部十个端口；任一端口已被其他
进程占用就 fail closed。所有 listener 使用每次应用启动随机生成的 Basic 凭据。代理拒绝 localhost、
单标签主机、私网、链路本地、组播和保留地址；direct route 的最终 DNS 结果也在交给 socket 前复核。

offline 请求会从最终环境删除全部 proxy 变量。online 请求设置大小写两套 proxy 变量并清空
`NO_PROXY`，上游代理凭据始终只留在 Electron main 的现有本机 relay 中。

## 状态转换与失败

| 状态 | 含义 | 可用操作 |
| --- | --- | --- |
| `not-installed` | 无有效状态文件 | 安装 |
| `ready` | 所有身份、ACL、隐藏项和防火墙规则通过 read-back | 卸载 |
| `needs-repair` | 状态损坏、版本变化或系统对象漂移 | 修复、卸载 |
| `unsupported` | 非 Windows x64 | 无 |
| `unavailable` | 桌面构建缺少 sidecar | 无 |

防火墙被组策略覆盖、活动 profile 被关闭、代理端口无法完整占用、路径无法由 NTFS ACL 表达、sidecar
协议不匹配或 supervisor 无法打开时，执行都失败，不进入宿主 shell。

## 构建与验证

- CI 在一次性 `windows-2025` runner 上执行 rustfmt、Windows-target clippy、Rust tests，以及真实账户、
  ACL、restricted process 和 offline-loopback 防火墙 smoke test，最后无条件卸载测试身份；
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
- [Microsoft：New-NetFirewallRule](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)
