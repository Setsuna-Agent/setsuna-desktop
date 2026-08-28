# 数据与安全边界

Setsuna Desktop 的安全模型不是强隔离沙箱，而是在本地桌面应用中用窄桥接、路径约束、审批、凭据隐藏和可恢复写入降低误操作与越权风险。

## 数据根

用户选定的 Setsuna 数据根同时作为 Electron `userData` 和 `sessionData`。Runtime 数据固定在其 `runtime/` 子目录。

```text
<dataRoot>/
├── .setsuna-data-root.json
├── window-preferences.json
├── window-state.json
├── secure-credentials.json
├── update-download-sources.json
├── Chromium / Electron profile data
└── runtime/
    ├── config.json
    ├── secrets.json
    ├── projects.json
    ├── mcp.json
    ├── skills.json
    ├── plugins.json
    ├── user-skills/
    ├── plugin-skill-overrides/
    ├── plugins/
    ├── attachments/
    ├── generated-images/
    ├── pc-local-policies/
    ├── memories/
    ├── usage.jsonl
    ├── threads.sqlite
    └── threads/            # legacy 导入源/人工备份
```

具体文件由 store 负责，详见 [Runtime 存储](../core/runtime/storage.md)。

## Bootstrap 元数据

系统默认 `appData` 下的 `Setsuna Desktop Bootstrap/` 不保存业务数据，只保存：

- 当前数据根位置指针。
- pending 迁移/导入事务。
- 跨正常和维护 profile 的稳定实例锁。
- 迁移后保留旧根的清理登记。
- 路径、目录身份、所有权 ID、进程 ID 和恢复阶段。

这样 main 可以在 Chromium profile 初始化前定位真正数据根，并从 rename 或崩溃中恢复。详细状态机见 [数据根模块](../desktop/main/data-root.md)。

未打包的开发实例把 bootstrap 与默认数据根一起隔离到
`appData/Setsuna Desktop Development/`，避免与正在运行的正式版争抢实例锁或并发访问同一份数据。
正式版目录保持不变。

## 进程与网络边界

### Runtime

- 只监听 `127.0.0.1`。
- `/v1/*` 需要随机 bearer token。
- token 和端口只由 Electron main 持有。
- Renderer 不能设置任意 URL、header 或 token。
- `RuntimeHost` 只代理 `/health` 和 `/v1/*`。

### 浏览器控制

- 使用与 runtime 不同的 loopback server 和 token。
- token 只通过 runtime 子进程环境注入。
- Runtime 只能调用固定浏览器命令。
- 网页、renderer 和 provider 都拿不到 CDP session。

### 原生凭据桥

- Main 使用 Electron `safeStorage` 封装凭据加解密。
- Runtime 通过独立的原生 bridge port 访问所需 secret。
- Renderer 只得到 `apiKeySet`、preview 或认证状态，不得到明文。
- `secrets.json` 写入后尝试设置 `0600`。

## Renderer 与 preload

- Renderer 不启用 Node integration。
- Preload 使用 `contextBridge` 暴露 `window.setsunaDesktop`。
- 不向 window 暴露 `ipcRenderer`。
- 每个事件 API都返回 unsubscribe。
- Main IPC 需要校验 sender 属于可信主窗口；browser guest 还要校验 host 与 partition。

新能力的具体检查表见 [Preload bridge](../desktop/preload/README.md)。

## 路径安全

所有 workspace 文件能力都要区分：

- 用户输入的相对路径。
- 规范化后的候选绝对路径。
- workspace 或 Git root 的 canonical path。
- symlink 解析后的真实目标。

常见规则：

- 使用 `path.resolve`、`path.relative` 和必要的 `realpath` 判定包含关系。
- 拒绝绝对路径逃逸、`..` 逃逸和跨 workspace 目标。
- 写入前后重新校验 canonical target。
- 写入使用同目录 staging、rename、备份和失败回滚。
- Review 的路径始终是 git-root-relative。
- 外部工作区应用只能打开当前 workspace 内文件。
- Plugin Bundle 拒绝 symlink、特殊文件、路径逃逸和与安装目录重叠。

这些检查用于普通本地桌面威胁模型，不承诺隔离同一用户下刻意制造竞态的恶意进程。

## 工具权限与审批

Runtime 在多个层面约束工具：

- `permissionProfile` 决定文件、shell、网络等能力范围。
- `approvalPolicy` 决定何时要求用户批准。
- ToolHost 可以返回 approval requirement 和变更 preview。
- MCP server 的启用状态和允许工具范围是执行授权边界；不再提供逐次调用确认或信任级别配置。
- 文件 mutation、危险 shell、浏览器 click/type 等在执行前进入统一 orchestrator。
- 持久化允许规则有单独 store，不能由工具结果自行修改。
- 外部页面、MCP、Plugin resource 和项目脚本进入模型时标记为不可信上下文。

审批 UI 只是决策入口；最终准入仍在 runtime。

## 线程数据一致性

线程状态的可靠性依赖以下不变量：

1. `RuntimeEvent` 先写入 SQLite，再通过 event bus 广播。
2. `seq` 在线程内单调递增，`(thread_id, seq)` 与事件 ID 唯一。
3. Snapshot 带 `snapshot_seq` checkpoint；恢复只重放 checkpoint 后事件。
4. Runtime ownership lease 与 fencing token 防止两个进程并发写同一数据目录。
5. Renderer 忽略 `seq <= lastSeq` 的事件。
6. 删除、截断、压缩、队列消费都必须由 reducer 可重放地表达。

详见 [线程与事件](../core/contracts/threads-and-events.md)。

## Provider metadata

跨协议历史只持久化经过白名单和 JSON-safe sanitizer 的 metadata：

- 不保存完整 HTTP response、request headers、API key 或未知诊断对象。
- Source 只保存 provider kind/model 和规范化 endpoint fingerprint，不保存 endpoint 副本。
- 只有 provider、协议、模型、endpoint 和 semantic fingerprint 都匹配时才原生回放。
- 不认识或无法安全保存的 envelope 整包降级为 semantic history。
- 单条 metadata 超过限制时省略 metadata，不影响 portable message。

这使切换 provider 时仍有可移植历史，同时避免把厂商原始 payload 当作可信持久化格式。

## Debug trace

Developer features 的 debug trace：

- 只在内存中有界保存。
- 不进入 thread store、RuntimeEvent 或聊天 SSE。
- 使用独立 `D#` 序号和 `afterEventSeq` 锚点。
- 关闭开发者开关后 route 和 renderer 入口都不可用。
- 详情展示前递归隐藏 secret/token、data URL 和超大字段。

Debug trace 不能成为业务恢复所依赖的第二真源。

## 数据迁移安全

数据根迁移遵循“先证明、再复制、后切换”：

1. 预检路径嵌套、目录所有权、文件系统类型、空间和可写性。
2. 正常关闭 runtime，拒绝新工作并排空已进入请求。
3. 复制到目标同级 staging。
4. 校验 checksum、受管 JSON/JSONL、SQLite 和资源数量。
5. 重写明确受管的绝对路径。
6. 同卷原子 rename 提交。
7. 原子更新位置指针。
8. 新根成功正常启动后，才允许用户二次确认删除旧根。

任何阶段失败都保留旧指针和源目录。旧根删除前再次核对活动根、路径嵌套、设备号、inode 和所有权 marker，并先 rename 到隔离名。

## 修改安全边界时

至少检查：

- Contract 是否仍隐藏 secret 与本地路径。
- Preload 是否仍是窄 API。
- Main 是否校验 sender、URL、session 和路径。
- Runtime route 是否鉴权并做二次校验。
- Adapter 是否处理 symlink、大小、超时、取消和回滚。
- Renderer 是否只展示脱敏状态。
- 测试是否覆盖非法输入，而不只覆盖成功路径。
