# 数据根、迁移与恢复

源码目录：`apps/desktop/main/src/data-root/`

数据根模块必须在 Electron profile 初始化前工作，并保证迁移失败时旧数据仍可启动。它是 main 中风险最高的持久化状态机之一。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `model.ts` | main 内部迁移/恢复模型和阶段 |
| `instance-profile.ts` | 隔离正式版与未打包开发实例的数据/元数据根 |
| `layout.ts` | 数据根、runtime、窗口、凭据、bootstrap 等受管路径 |
| `bootstrap.ts` | 早期读取位置指针和 pending，判定 boot mode |
| `instance-lock.ts` | 在稳定 bootstrap 目录维护唯一进程锁 |
| `atomic-json.ts` | 小型控制元数据的 durable atomic JSON |
| `validation.ts` | 路径、所有权、空间、嵌套和可写性检查 |
| `volume-kind.ts` | 识别本地/网络文件系统与挂载信息 |
| `manifest.ts` | 扫描文件、分类、checksum、资源数量和不支持项 |
| `relocate.ts` | 受管绝对路径的迁移重写 |
| `coordinator.ts` | 正常数据根迁移状态机 |
| `legacy-import-plan.ts` | 旧 memory / policy 导入预检 |
| `legacy-import.ts` | 旧数据导入、staging、receipt 和恢复 |
| `retained-backups.ts` | 迁移后旧根登记、检查、保留和安全删除 |

## 启动模式

`resolveDesktopDataRootBootMode()` 根据位置指针、根目录可用性和 pending 事务返回：

- 正常启动。
- 迁移执行/恢复。
- 旧数据导入维护。
- 当前自定义根不可用的恢复。
- 旧根删除事务续作。

Main 必须先选择对应 profile，再创建 Chromium session。维护模式使用系统临时目录中的隔离 profile，避免扫描后的源目录被浏览器继续写入。

## 正常迁移

### 扫描与计划

Renderer 请求扫描目标目录后，main：

1. 规范化源、目标和 bootstrap 根。
2. 拒绝源/目标互相包含或指向 bootstrap 控制目录。
3. 检查目标为空或拥有匹配的 Setsuna marker。
4. 识别设备、inode、卷和实际文件系统类型。
5. 执行真实创建、写入、fsync、删除探测。
6. 扫描源 manifest，计算数量、字节和 checksum。
7. 估算目标空间并生成短生命周期 plan。

Plan ID 防止 UI 用过期扫描结果直接开始迁移。

### 关闭 runtime

正式复制前：

- Runtime 关闭新工作准入。
- 已进入的 HTTP 写入完成。
- Active turn 和后台任务取消并排空。
- SQLite lease 释放并 checkpoint WAL。
- Runtime 通过 stdin 控制协议正常退出，退出码必须为 0。

任何超时或终止信号都取消迁移并保留旧指针。

### Staging 与提交

1. 在目标同级创建带迁移所有权的 staging。
2. 复制并持续发布真实字节进度。
3. 校验 checksum、受管 JSON/JSONL、SQLite 与资源数量。
4. 只重写明确受管文件内的绝对路径。
5. 写入最终数据根 marker。
6. 以同卷原子 rename 把 staging 提交到目标。
7. 原子更新 bootstrap 位置指针。
8. 请求应用 relaunch。

Plugin、Skill、运行依赖、浏览器 profile 中的任意 JSON 只按字节/checksum 对待，不能因扩展名相同就擅自改写。

## Pending 与崩溃恢复

每个不可逆边界前先持久化 pending 阶段。重启时根据：

- 源是否存在。
- Staging/目标是否存在。
- 迁移 ID 与 owner marker 是否匹配。
- 位置指针指向哪里。
- rename 已完成到哪一侧。

决定续提、回滚或进入人工恢复。

Staging 清理只能删除：

- owner marker 匹配当前迁移 ID 的目录；或
- 可证明从未初始化、只含 atomic JSON 临时文件/旧版截断 owner 的目录。

不能用路径名称看起来像 staging 就递归删除。

## 旧根保留与删除

新根成功完成一次正常启动后，源目录进入 retained backup：

- 用户可先查看占用空间。
- 可以暂时保留并在高级设置继续看到。
- 永久删除需要二次确认。

删除前重新核对：

- 不是当前活动根。
- 与活动根和 bootstrap 根互不包含。
- 设备号和 inode 与登记一致。
- 所有权 marker（如果可用）匹配。
- 目录仍可写且未被替换。

删除先原子 rename 到同盘隔离名，再执行清理。崩溃后根据登记事务继续；绝不能把当前活动根当成旧根删除。

## Legacy memory / policy 导入

旧 memory `storagePath` 和 `~/.setsuna/desktop` 的 exec/shell policy 不由正常 runtime 偷偷读取。Main 在启动前进入维护状态机：

1. 扫描来源和目标。
2. 预检空间并展示复制进度。
3. 把 memory 合并到 staging，并写事务 receipt。
4. Pending 保护旧正式根备份和 staging → 正式根的双 rename。
5. Policy 复制到 `runtime/pc-local-policies/`。
6. 成功后清理旧配置字段，但不删除外部源。

Phase 2 memory 增量以内部 snapshot baseline 计算，不读取或修改用户目录中的 Git metadata。

## 不变量

- 最终 marker 和位置指针提交前，不删除或改写源根。
- 自定义根不可用时不创建同路径空目录来“修复”。
- 无 marker 的非空目标默认不属于 Setsuna。
- 跨卷不能假设 rename 原子；最终提交必须在目标同级 staging 内完成。
- 任何 `rm`/递归删除都以匹配的目录身份和 owner 为前提。
- 路径比较必须跨 macOS、Windows、Linux 正常工作。
- Maintenance profile 不能指向源数据根。

## Renderer 协作

- `DesktopDataRootProvider` 订阅 main 状态。
- `DesktopDataRootGate` 在 runtime controller 之前选择正常或维护 UI。
- `features/settings/data-root/` 展示扫描、风险确认、进度、恢复和旧根清理。
- 数据根不是 runtime preference，修改它必然经过 main 协议和 relaunch。

## 测试

主要位于 `apps/desktop/main/test/unit/data-root/`：

- `bootstrap.test.ts`
- `coordinator.test.ts`
- `instance-profile.test.ts`
- `instance-lock.test.ts`
- `manifest.test.ts`
- `relocate.test.ts`
- `retained-backups.test.ts`
- `volume-kind.test.ts`

需要覆盖的不只是成功复制，还包括空间不足、路径嵌套、网络卷、symlink、过期 plan、runtime 非正常退出、每个 rename 间隙崩溃、marker 不匹配和活动根删除保护。
