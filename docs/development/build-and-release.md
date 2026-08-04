# Build And Release

本仓库是 pnpm workspace，根 package 直接构建 Electron app、renderer 和 runtime。CI 和 release 都以 GitHub Actions 为真源。

开发命令总览见 [Development](README.md)，逐个脚本职责见 [Repository Scripts](../scripts/README.md)。

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
- `pnpm build:contracts`：只编译 `packages/contracts/src`，测试由独立 test tsconfig 类型检查。
- `pnpm build:runtime`：只编译 `packages/desktop-runtime/src`，不会把测试发进 `dist`。
- `pnpm build:electron`：运行 `scripts/build-electron.ts`。
- `pnpm build:renderer`：Vite build。
- `pnpm check:architecture`：检查分层依赖、contracts 循环引用、测试隔离、文件体积和目录密度，并验证 `Tree.md` 已同步。
- `pnpm docs:tree`：从真实目录重新生成 `Tree.md`。
- `pnpm typecheck`：先运行架构检查，再运行 TypeScript project references。
- `pnpm test`：先跑稳定单元/轻量测试，再串行跑重集成测试。
- `pnpm test:all`：用默认全量 Vitest 配置一次性跑全部测试，配置上仍保持串行重链路。
- `pnpm test:unit`：排除重集成文件的 Vitest 测试层。
- `pnpm test:integration`：agent loop、runtime server、真实 git/shell/PTY、文件 watcher 等重集成测试，串行执行。
- `pnpm test:release`：先下载并校验当前平台固定版本的 ripgrep，再运行发版包矩阵的确定性测试门禁。
- `pnpm lint`：ESLint；架构规则由 `pnpm typecheck` 前置执行。
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
4. 通过开发 supervisor 启动 Electron；应用内计划重启使用专用退出码原地拉起，
   不结束 Vite renderer。
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
  - `plugins/**/*`
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

`.github/workflows/ci.yml` 在面向 `master` 的 pull request 和手动运行时触发。`master` 的严格分支保护要求 PR 基于最新基线通过检查，因此合入后不再为同一变更重复运行通用 CI；CodeQL 的默认分支 push 扫描由 GitHub code scanning 单独负责。

CI 使用单个 `ubuntu-24.04` job，固定 pnpm `7.33.7`、Node.js `22` 和 Python `3.11`，依次执行：

1. `node scripts/configure-node-gyp-python.mjs`。
2. `pnpm install --frozen-lockfile`。
3. `pnpm typecheck`（包含 architecture check）。
4. `pnpm lint`。
5. `pnpm test`（unit + integration）。

`master` 还要求最新提交通过 Codex review gate：

1. `.github/workflows/codex-review.yml` 通过 `pull_request_target` 从受信任的默认分支执行，不 checkout 或运行 PR 代码。
2. 仓库的 Codex Automatic Review 触发条件必须设置为“每次推送时”，由 Codex 在 PR 打开、转为 ready 和 push 新提交后自动审查当前 HEAD。
3. workflow 不发布 `@codex review` 评论：默认 `GITHUB_TOKEN` 属于 `github-actions[bot]`，该身份无法绑定 Codex 账号。
4. `Codex Review Gate` 接受 `chatgpt-codex-connector[bot]` 针对当前 HEAD 的标准 review、带 SHA 的 clean-review 顶层评论，或安全 review generation 中产生的 PR 顶层 👍 reaction。workflow 在 run name 中固化 PR 编号、事件 action、draft 状态与触发时的 PR HEAD，并用唯一 Actions run URL 标记该 generation 写入的 commit status，再结合 run 历史恢复 lineage；不能恢复 HEAD 快照的旧 run 会保守地中断 lineage，重复使用的 SHA 也不会捞取其他 run 的旧 status。draft run 不产生 review generation，PR metadata 的 `edited` 事件也不触发 gate；其他无 status 的 run 会中断 lineage。只有前一 generation 已由真实 Codex 结果终结，新 HEAD 才继承 reaction 识别能力，避免 draft/连续 push 下旧 review 的延迟 reaction 放行新提交。
5. 当前 review 有 inline finding、检测到无法绑定 HEAD 的 reaction，或 25 分钟内未完成时 gate 失败；clean review 通过，push 修复后会取消旧 run 并等待自动触发的新一轮 review。

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
pnpm docs:tree
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
