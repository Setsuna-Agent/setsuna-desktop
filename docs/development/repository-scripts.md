# Repository Scripts

源码目录：`scripts/`

根 `package.json` 是脚本调用入口。不要直接猜测 runner 命令；先使用已有 pnpm script，再从其 config 派生定向验证。

## 开发与构建

### `start-electron-dev.ts`

`pnpm dev:electron` 的 supervisor：

1. 依次构建 contracts、feature-core、Feature packages 和 runtime。
2. Windows x64 准备原生沙箱与 curl。
3. 调用 Electron bundle build，并准备当前平台的桌面控制 helper。
4. 注入 Vite URL 和 runtime entry。
5. macOS 优先启动有效的签名开发应用缓存；否则先启动原 Electron，再后台准备通知应用。
6. 识别应用内 dev relaunch 专用退出码并原地重启，不结束 Vite。

### `prepare-electron-dev-app.ts`

只用于 macOS dev：复制 Electron 为独立的 `Setsuna Desktop Dev.app`，写入开发
bundle ID 和应用图标，完成本机 ad-hoc 签名及 Launch Services 注册，使开发实例可以
请求原生通知授权。保留 `Electron` 可执行文件和默认入口，以继续使用未打包的开发
profile；不修改依赖包，不需要开发者证书。

缓存位于 `.cache/electron-dev/`，按 Electron 路径、内容版本和图标变化失效。
启动前只读取缓存元数据；复制、签名和注册在 Electron 启动后异步串行执行，准备结果
只用于下次启动或计划重启。签名验证成功后才替换旧应用，注册成功后才写缓存标记；
暖启动不执行外部命令。准备失败由 supervisor 报告，当前窗口继续运行；退出时取消
外部命令并清理临时目录，迟到结果不再注册或更新入口。Windows 不执行此准备。

### `build-electron.ts`

用 esbuild 输出：

- `dist/electron/main/index.js`
- `dist/electron/preload/index.cjs`
- `dist/runtime/cli.cjs`
- `dist/runtime/extension-worker-entry.js`
- `dist/electron/preload/browser-extensions.cjs`

Main/preload/runtime 的 external、format 和 platform 设置在这里统一维护。

### `feature-package-aliases.ts`

Vite 与 Vitest 共用的 build-time Feature source alias。它从 `packages/features/*` 派生 package-name 到 `src/` 的映射，避免新增 Feature 时同步两份手写清单；运行时 inventory 仍由四个显式 composition root 决定。

`pnpm build:features` 同样通过 pnpm workspace filter 构建全部 Feature package，不维护第二份 package path 列表。

### `clean.mjs`

删除明确的构建输出和增量状态。修改时保持目标列表窄，不能把 workspace root 或用户数据目录作为递归目标。

### `run-with-log.mjs`

为 CI/release 命令保留结构化日志文件，同时透传退出码。不要用它吞掉失败。

## 架构与文档

### `check-architecture.mjs`

检查：

- Core 技术层依赖方向，以及 `feature-core`/纵向 Feature 的进程入口与跨 Feature import 边界。
- 中央 runtime-client/settings/capabilities/tool-result 区域不得直接导入具体 Feature。
- renderer Feature 不得使用 raw transport 或直接访问 preload 全局桥。
- Contracts 相对 import cycle。
- `src/` 混入测试。
- Build output 混入 test artifact。
- 单文件体积上限。
- 单目录直属 source file 密度。

由 `pnpm check:architecture` 调用。

Feature 边界检查只判断 exact import 与 AST 可证明的调用，不根据变量名或字符串内容猜测 owner。持久 identifier 的 rename/delete 兼容由对应 Feature 的 decoder/migration 和 review 负责。

### `benchmark-feature-projection.ts`

使用真实 SQLite ThreadStore 与 `ThreadStoreEventReader`，比较新建 projection store 的全量重放与 durable checkpoint 恢复。基准不进入 CI、不清除 OS page cache，也不等价于完整应用冷启动；具体口径见 [测试与验证](testing.md#feature-projection-冷重放基准)。

## Native dependency

### `configure-node-gyp-python.mjs`

在 CI 中选择明确 Python，配置 node-gyp，降低平台 runner 差异。

### `prepare-node-pty.mjs`

安装后准备/校验 Electron 对应的 `node-pty` native binary。它属于 dependency setup，不应在应用运行期现场编译。

### `show-runner-architecture.mjs`

输出 runner OS/arch/Node/Electron 诊断，帮助 release matrix 定位原生资产问题。

## Pack hooks

### `before-pack.cjs`

Electron Builder 收集文件前：

- 准备目标平台 ripgrep sidecar。
- 执行需要在 pack 前完成的 native/resource 校验。

失败要中止打包。

### `after-pack.cjs`

打包后：

- 校验 app 内 sidecar、license 和 native asset。
- 对本机目标运行 `rg --version`。
- 执行平台后处理，例如 macOS ad-hoc signing。

### `ripgrep/manifest.json`

固定：

- Version。
- 平台/架构下载 URL。
- Archive size/hash。
- 允许提取的成员。

### `ripgrep/prepare-ripgrep.mjs`

下载、校验、限制提取并生成 metadata/notice。不能执行 archive 中任意文件，也不能信任路径名称。

### `ripgrep/archive.mjs`

归档格式与安全提取 helper。

测试：

- `scripts/test/ripgrep/prepare-ripgrep.test.ts`
- `scripts/test/build-electron.test.ts`

## Release

### `validate-release-version.mjs`

验证 package version、tag/输入和 release 约束。所有 package/release script 都前置调用。

### `release-assets.mjs`

定义 macOS 两个架构的 DMG、原生更新 ZIP 和 Windows x64 EXE 名称，供收集、发布校验和本地预览共用。

### `release-dry-run.mjs`

生成本地 `release-artifacts/dry-run/release-manifest.json`，预览安装包、macOS 更新 ZIP 及 `SHA256SUMS` 的公开清单，不创建 GitHub Release，也不为预览生成校验文件。

### `collect-release-job-assets.mjs`

在单个平台 job 中收集对应安装包和 macOS 更新 ZIP，形成 workflow artifact。日志由独立的 `diagnostic-*` artifact 保存。

### `prepare-github-release-assets.mjs`

Publish job 只接收清单中的三个安装包和两个 macOS 更新 ZIP，拒绝缺失或重名产物，生成 `SHA256SUMS`。内部 manifest、日志、blockmap 和 electron-builder 更新 metadata 不进入公开下载区。

## Package scripts 对照

| pnpm 命令 | 主要脚本/工具 |
| --- | --- |
| `pnpm dev` | Vite + `start-electron-dev.ts` |
| `pnpm build:electron` | `build-electron.ts` |
| `pnpm check:architecture` | `check-architecture.mjs`（含 Feature 边界检查） |
| `pnpm package:*` | version validate + build + electron-builder pack hooks |
| `pnpm test:release` | prepare ripgrep + 跨平台边界 Release Gate |
| `pnpm release:dry-run` | validate + build + `release-dry-run.mjs` |

完整构建和 workflow 见 [构建与发布](build-and-release.md)。

## 修改脚本时

- 使用 Node API 和 `path`，不要假设 Bash。
- 支持 macOS、Windows。
- 输入路径先 resolve/validate。
- 下载固定 hash 和大小。
- Archive 提取使用 allowlist 并拒绝逃逸。
- 保留非零退出码。
- 生成物必须 deterministic。
- 增加 `scripts/test/` 或 release test。
- 同步 package scripts、workflow 和文档。
