# Build And Release

本仓库是 pnpm workspace，根 package 直接构建 Electron app、renderer 和 runtime。CI 和 release 都以 GitHub Actions 为真源。

## 环境

- Node.js `>=22.13.0`（内置 `node:sqlite` 从该版本起无需 `--experimental-sqlite`）
- pnpm `>=7`
- CI 固定 pnpm `7.33.7`
- 原生依赖：`node-pty`
- Electron：`43.x`

如果本地 pnpm 版本过高导致 lockfile 或 modules-dir 兼容问题，优先使用：

```bash
corepack pnpm@7.33.7 <command>
```

或直接调用 `node_modules/.bin/*` 做单项验证。

## Workspace

`pnpm-workspace.yaml` 纳入：

- `packages/*`

`apps/desktop` 不是独立 workspace package，根 package 脚本直接构建。

## 构建脚本

常用脚本：

- `pnpm dev`：并行启动 Vite renderer 和 Electron dev。
- `pnpm dev:renderer`：启动 Vite，默认 `127.0.0.1:5174`。
- `pnpm dev:electron`：构建 contracts/runtime/electron bundle，再启动 Electron。
- `pnpm build`：clean 后构建 contracts、runtime、electron、renderer。
- `pnpm build:contracts`：`tsc -b packages/contracts`。
- `pnpm build:runtime`：`tsc -b packages/desktop-runtime`。
- `pnpm build:electron`：运行 `scripts/build-electron.ts`。
- `pnpm build:renderer`：Vite build。
- `pnpm typecheck`：TypeScript project references。
- `pnpm test`：先跑稳定单元/轻量测试，再串行跑重集成测试。
- `pnpm test:all`：用默认全量 Vitest 配置一次性跑全部测试，配置上仍保持串行重链路。
- `pnpm test:unit`：排除重集成文件的 Vitest 测试层。
- `pnpm test:integration`：agent loop、runtime server、真实 git/shell/PTY、文件 watcher 等重集成测试，串行执行。
- `pnpm test:release`：先下载并校验当前平台固定版本的 ripgrep，再运行发版包矩阵的确定性测试门禁。
- `pnpm lint`：ESLint。
- `pnpm package:*`：按平台打包。
- `pnpm release:dry-run`：生成 release manifest 和校验预览。

## `scripts/build-electron.ts`

用 esbuild 生成：

- `dist/electron/main/index.js`：Electron main，ESM。
- `dist/electron/preload/index.cjs`：preload，CJS。
- `dist/runtime/cli.cjs`：runtime CLI，CJS。

external：

- main external `electron`、`node-pty`。
- preload external `electron`。

约束：

- runtime CLI 会被 Electron main 作为子进程启动，打包路径要与 `RuntimeHost.resolvePackagedRuntimeEntry()` 一致。
- `node-pty` 需要保留原生 prebuild，不能被 asar 打坏。

## `scripts/start-electron-dev.ts`

dev 启动流程：

1. 复用当前 pnpm entrypoint 构建 contracts。
2. 构建 runtime。
3. 调用 `buildElectron()`。
4. 启动 Electron。
5. 注入：
   - `SETSUNA_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:5174`
   - `SETSUNA_DESKTOP_RUNTIME_ENTRY=packages/desktop-runtime/dist/cli.js`

## Vite

`vite.config.ts`：

- 使用 React plugin。
- dev server 固定 `127.0.0.1:5174`。
- `base: './'` 兼容 Electron `loadFile`。
- alias：
  - `@renderer`
  - `@setsuna-desktop/contracts`
- output：`dist/renderer`。
- `emptyOutDir: false`，避免删掉 Electron/runtime 构建产物。

## Electron Builder

根 `package.json` 的 `build` 字段定义：

- `appId`: `dev.setsuna.desktop`
- `productName`: `Setsuna Desktop`
- output：`release-artifacts`
- build resources：`assets/build`
- files：
  - `dist/**/*`
  - `package.json`
  - workspace package metadata
  - `skills/**/*`
- `asarUnpack`：
  - `**/node_modules/node-pty/prebuilds/**/*`
- `extraResources`：
  - `.cache/ripgrep/${os}-${arch}` -> `resources/setsuna-path`

### Bundled ripgrep

项目内容搜索和 Agent `search_text` 不依赖用户机器上预装的 `rg`：

1. `scripts/ripgrep/manifest.json` 固定 ripgrep 版本、平台 URL、归档字节数、SHA-256 和归档成员。
2. `scripts/before-pack.cjs` 在 Electron Builder 收集 `extraResources` 前准备目标平台二进制；下载或归档成员校验失败会直接终止打包。
3. 归档只提取 `rg`/`rg.exe`、`LICENSE-MIT`、`UNLICENSE` 和 `COPYING`，并生成来源 notice/metadata。
4. sidecar 放在 asar 外的 `resources/setsuna-path`；main 用绝对路径注入 `SETSUNA_DESKTOP_RG_PATH`，同时把该目录置于 runtime/terminal PATH 首位。
5. `scripts/after-pack.cjs` 对包内二进制和许可证逐字节复核；原生目标还执行 `rg --version`，之后再完成 macOS ad-hoc 签名。

开发模式会依次尝试显式 `SETSUNA_DESKTOP_RG_PATH`、本地已准备 sidecar、系统 PATH；三者都不可用时仅内部内容搜索降级到受限 JavaScript adapter。发行版缺少 sidecar 时失败关闭，不走系统 `grep` 或 JavaScript 回退。

平台产物：

- macOS arm64/x64：DMG + ZIP，当前 unsigned/manual install。
- Windows x64：NSIS EXE + ZIP。
- Linux x64：AppImage + deb + tar.gz。

## CI

`.github/workflows/ci.yml` 是手动触发，matrix：

- `macos-latest`
- `windows-latest`
- `ubuntu-latest`

步骤：

1. checkout。
2. setup pnpm `7.33.7`。
3. setup Node `22`。
4. setup Python `3.11`。
5. `node scripts/configure-node-gyp-python.mjs`。
6. `pnpm install --frozen-lockfile`。
7. `pnpm typecheck`。
8. `pnpm test:release`。
9. `pnpm build`。
10. `pnpm release:dry-run`。

重集成测试由独立 Ubuntu job 跑 `pnpm test:integration`。这样平台矩阵继续验证跨平台构建和轻量逻辑，agent/runtime 的慢异步链路不会把每个平台的构建稳定性绑在一起。

## Release Workflow

`.github/workflows/release.yml` 手动触发，输入 tag、release name、draft、prerelease。

package job matrix：

- macOS Apple Silicon：`macos-15`，`package:mac:arm64`。
- macOS Intel：`macos-15-intel`，`package:mac:x64`。
- Windows x64：`windows-2025`，`package:win:x64`。
- Ubuntu x64：`ubuntu-24.04`，`package:linux:x64`。

每个平台：

1. 安装依赖。
2. typecheck。
3. `test:release`。
4. package。
5. collect release assets。
6. upload artifact。

release 另有 `Integration diagnostics` job，在 Ubuntu 上跑 `test:integration` 并上传 `diagnostic-*` 日志 artifact。该 job 是诊断信号，不阻塞 package/publish；正式发布资产只从 `release-*` package artifacts 收集。

publish job：

1. 下载所有 release artifact。
2. `prepare-github-release-assets.mjs` 整理上传目录、打包日志、生成 manifest 和 SHA256SUMS。
3. 写 release notes。
4. 用 `gh release create/edit/upload` 发布或更新 GitHub Release。

## Release Metadata

`scripts/prepare-github-release-assets.mjs` 会：

- 递归收集 downloaded artifacts。
- 把 logs 打包成 `build-logs-v<version>.zip`。
- 根据文件名推断 platform、arch、kind。
- 生成 `release-manifest.json`。
- 生成 `SHA256SUMS`。
- 处理 `latest-mac.yml` arch 重命名，避免资产名冲突。

`scripts/release-dry-run.mjs` 生成本地预览：

- `release-artifacts/dry-run/release-manifest.json`
- `release-artifacts/dry-run/SHA256SUMS`

## 验证分层

文档-only：

```bash
git diff --check
```

runtime/server/contract：

```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build:runtime
```

renderer/UI：

```bash
pnpm typecheck
pnpm test:unit
pnpm build:renderer
```

打包/路径/发布：

```bash
pnpm build
pnpm test:release
pnpm package
pnpm release:dry-run
```

最终合并前建议：

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
git diff --check
```

如果 `pnpm lint` 因既有遗留问题失败，要明确区分是否引入了新错误。
