# Repository Scripts

源码目录：`scripts/`

根 `package.json` 是脚本调用入口。不要直接猜测 runner 命令；先使用已有 pnpm script，再从其 config 派生定向验证。

## 开发与构建

### `start-electron-dev.ts`

`pnpm dev:electron` 的 supervisor：

1. 构建 contracts。
2. 构建 runtime。
3. 调用 Electron bundle build。
4. 注入 Vite URL 和 runtime entry。
5. 启动 Electron。
6. 识别应用内 dev relaunch 专用退出码并原地重启，不结束 Vite。

### `build-electron.ts`

用 esbuild 输出：

- `dist/electron/main/index.js`
- `dist/electron/preload/index.cjs`
- `dist/runtime/cli.cjs`

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

### `generate-tree.mjs`

扫描主要源码根，生成 `Tree.md`：

- 忽略 dependency/build/cache。
- 统计直属/递归文件数。
- 展示有限深度的目录。
- 支持 `--check` 验证未过期。

模块职责写在 `docs/`；不要把长设计说明塞进生成器模板。

### `benchmark-feature-projection.ts`

使用真实 SQLite ThreadStore 与 `ThreadStoreEventReader`，手动测量一个或两个 Feature projection 的 process-cold 全量重放。该命令不进入 CI、不清除 OS page cache，也不设置统一阈值；它只为是否需要持久 checkpoint 提供同机可重复证据。

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

### `release-dry-run.mjs`

在本地根据预期产物生成：

- `release-manifest.json`
- `SHA256SUMS`

用于验证 metadata，不创建 GitHub Release。

### `collect-release-job-assets.mjs`

在单个平台 job 中收集安装包、metadata 和日志，形成 workflow artifact。

### `prepare-github-release-assets.mjs`

Publish job：

- 合并平台 artifacts。
- 校验文件名/平台/架构。
- 打包 build logs。
- 生成最终 manifest/checksum。
- 处理冲突 metadata 名称。

## Package scripts 对照

| pnpm 命令 | 主要脚本/工具 |
| --- | --- |
| `pnpm dev` | Vite + `start-electron-dev.ts` |
| `pnpm build:electron` | `build-electron.ts` |
| `pnpm check:architecture` | `check-architecture.mjs` + `generate-tree.mjs --check` |
| `pnpm docs:tree` | `generate-tree.mjs` |
| `pnpm package:*` | version validate + build + electron-builder pack hooks |
| `pnpm test:release` | prepare ripgrep + 跨平台边界 Release Gate |
| `pnpm release:dry-run` | validate + build + `release-dry-run.mjs` |

完整构建和 workflow 见 [构建与发布](build-and-release.md)。

## 修改脚本时

- 使用 Node API 和 `path`，不要假设 Bash。
- 支持 macOS、Windows、Linux。
- 输入路径先 resolve/validate。
- 下载固定 hash 和大小。
- Archive 提取使用 allowlist 并拒绝逃逸。
- 保留非零退出码。
- 生成物必须 deterministic。
- 增加 `scripts/test/` 或 release test。
- 同步 package scripts、workflow 和文档。
