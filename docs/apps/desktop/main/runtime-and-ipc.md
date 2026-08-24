# RuntimeHost、原生桥与 IPC

源码目录：

- `apps/desktop/main/src/runtime/`
- `apps/desktop/main/src/ipc/`
- `apps/desktop/main/src/security/`

这组模块把 renderer 和 runtime 接到 Electron main 持有的可信能力上，同时避免泄漏任意 IPC、token 或系统 API。

## RuntimeHost

入口：`src/runtime/host.ts`

### 启动职责

`RuntimeHost`：

- 分配本地端口并生成一次性 bearer token。
- 解析 runtime CLI、spawn cwd 和 Electron Node-mode 可执行文件。
- 注入数据根、内置 Skill/Plugin、browser control、native bridge 与 ripgrep 环境。
- 监听 stdout ready JSON 和 stderr 诊断。
- Ready 后请求 `/health`，只有健康检查成功才对外提供 request/subscribe。

开发环境可用 `SETSUNA_DESKTOP_RUNTIME_ENTRY` 指向编译后的 runtime CLI。Packaged 环境需要兼容 `app.asar`、unpacked native dependency 和平台 Helper 路径。

### 请求代理

`RuntimeHost.request()` 只接受：

- `/health`
- `/v1/*`

它负责附加 Authorization、JSON 编解码和 transport 诊断。幂等 GET 在 loopback
连接失败时会短重试一次；POST/PUT/PATCH/DELETE 不会盲重试，因为响应丢失不能证明
runtime 没有执行写操作。最终 transport 错误必须携带 method/path、底层错误码和
runtime 子进程状态。Renderer 永远看不到实际端口、token 或 headers。

### SSE

Main 为每个 renderer 订阅创建独立 runtime SSE：

- 输入是 `threadId` 与 `sinceSeq`。
- 输出按最多 16ms / 128 条组成有序 `RuntimeEventBatch`，通过 `runtime:event` IPC 转发。
- Approval 与 turn 终态会立即 flush，并与之前待发增量保持同一顺序。
- unsubscribe、窗口销毁和 host shutdown 都会关闭连接。
- Event stream 错误通过订阅通道报告，不能让旧订阅污染新线程。

### 关闭

优先关闭 runtime stdin 触发 graceful shutdown。数据迁移要求这个控制协议正常结束且退出码为 0；SIGTERM/SIGKILL 只能作为失败后的进程清理，不能算安全排空。

## Bundled tools 与环境

### `runtime/bundled-tools.ts`

- 解析开发或 packaged 的 ripgrep 路径。
- 校验平台/架构产物存在。
- 把绝对路径注入 runtime 环境。
- Packaged 模式缺失 bundled ripgrep 时直接失败，避免静默使用机器上的未知版本。

### `runtime/desktop-environment.ts`

负责在 GUI 启动缺少 login-shell PATH 时补齐桌面进程环境。必须保留已有显式变量，并避免把平台 shell 行为硬编码为单一系统。

## 原生 bridge 与凭据

### `runtime/native-bridge-server.ts`

原生 bridge 是 runtime 到 main 的窄 loopback API。目前承载需要 Electron 信任边界的能力，例如：

- Credential vault 读写/删除。
- 受控打开外链。

Server 使用独立随机 token。Runtime 通过 `HttpDesktopNativeBridge` port adapter 调用，renderer 不参与。

### `security/credential-encryption.ts`

把 Electron `safeStorage` 适配为加解密接口。要明确处理平台不支持或加密不可用，不能把明文伪装成已加密结果。

### `security/credential-vault.ts`

- 在 data root 内持久化加密凭据。
- 对 key、payload 和文件格式做 normalization。
- 使用原子写入。
- 不向 list/status 调用返回 secret 明文。

Runtime 的 `secrets.json` 只保存适合 runtime 管理的 secret 状态；需要 OS-backed 加密的凭据通过原生 bridge 管理。

## IPC 目录

`src/ipc/` 按能力拆分，避免所有 handler 堆在 `index.ts`。

| 文件 | Namespace / 职责 |
| --- | --- |
| `runtime-ipc.ts` | runtime request、attachment upload、SSE subscribe/unsubscribe |
| `data-root-ipc.ts` | 数据根状态、扫描、迁移、恢复、旧根清理 |
| `desktop-ipc.ts` | 目录选择、profile、clipboard、图片、本地路径与外链 |
| `browser-ipc.ts` | browser tab 注册、active tab、截图、favicon、设备模拟 |
| `window-ipc.ts` | minimize/maximize/close、标题栏 scale |
| `workspace-ipc.ts` | 外部 workspace app 列表与打开 |
| `sender.ts` | 可信主窗口 sender 校验 |

Review 的固定 handler、Git 状态和变更监控已由 `packages/features/review/src/main/` 拥有。它监听 worktree、worktree Git 目录及共享 Git 目录，合并事件并过滤 ignored 文件后，只向 renderer 发布失效通知；具体 diff 仍由带当前比较基准的 `get-state` 请求生成。宿主 composition 只注入 commit-message、preview registry 与 sender policy。

Terminal 的固定 handler 已由 `packages/features/terminal/src/main/ipc.ts` 拥有，并通过 Main Feature scope 注册/撤销；app main 的 composition root 只提供环境与 renderer event 出口。

Updater 的固定 handler、channel contract 和状态机由 `packages/features/updater/{contracts,main}` 拥有。Main composition 只注入版本、路径、代理 fetch、窗口与语言；Feature scope 排空在途检查后撤销全部 handler。

Network Proxy 的固定 handler 和 channel contract 由 `packages/features/network-proxy/{contracts,main}` 拥有。Main composition 注入配置、凭据、系统 fetch 与 runtime 删除入口；Feature scope 负责撤销 handler、停止 browser proxy 更新并关闭 fetch dispatcher 与 relay。

## IPC 设计规则

### 固定命名

Channel 使用领域前缀，例如 `runtime:*`、`desktop-data-root:*`、`browser:*`。不要增加“任意 channel invoke”或把 channel 名从 renderer 输入传入。

### 校验 sender

Main handler 要确认请求来自当前可信主 renderer。Browser guest 相关调用还要核对：

- `guestContents.hostWebContents` 是主 renderer。
- guest 属于内置浏览器 partition。
- tab ID 与 `webContents.id` 映射一致。

### 结构化数据

- 输入输出使用 contracts 类型。
- 错误保持可展示的稳定语义。
- 长期事件返回 unsubscribe。
- 二进制/图片通过明确受限的 payload 或 asset ID 传递。
- 本地路径在 main 再次规范化，不能相信 renderer 已检查。

### 生命周期

注册函数需要能够：

- 访问当前活跃 service，而不是捕获已销毁对象。
- 在窗口销毁后停止推送事件。
- 对 data-root 等状态订阅返回 unregister。
- 在重复创建窗口时避免残留重复 handler。

## 新增一条桌面 API

完整路径：

1. `packages/contracts/src/desktop.ts`、Feature contracts 或相应领域 contract。
2. Main 的 domain service/helper，独立业务能力优先进入 Feature main owner。
3. App main IPC 或 Feature-owned 固定 handler。
4. Host preload namespace 或 Feature preload contribution。
5. Renderer hook/feature。
6. Main 单元测试、renderer helper 测试。

如果能力本质属于 runtime 数据或 Agent 行为，应走 Runtime REST/port，而不是新增 main IPC。

## 测试

重点测试：

- `test/unit/runtime/host.test.ts`
- `test/unit/runtime/bundled-tools.test.ts`
- `test/unit/runtime/desktop-environment.test.ts`
- `test/unit/runtime/native-bridge-server.test.ts`
- `test/unit/security/credential-encryption.test.ts`
- `test/unit/security/credential-vault.test.ts`

IPC 的领域行为通常由被调用 service 的测试和 renderer bridge/client 测试共同覆盖；新增复杂校验时应为 IPC helper 提取可测试的纯函数。
