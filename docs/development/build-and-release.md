# Build And Release

本仓库是 pnpm workspace，根 package 直接构建 Electron app、renderer 和 runtime。CI 和 release 都以 GitHub Actions 为真源。

开发命令总览见 [Development](README.md)，逐个脚本职责见 [Repository Scripts](repository-scripts.md)。

## 环境

- Node.js `>=22.19.0`（满足 Pi runtime 与内置 `node:sqlite` 的共同要求）
- pnpm `>=7`
- CI 固定 pnpm `7.33.7`
- 原生依赖：`node-pty`
- Electron：`43.x`

Windows x64 源码开发和打包另需 Rust/Cargo `>=1.85`、`x86_64-pc-windows-msvc` 工具链、MSVC C++ 构建工具及 Windows SDK，安装和排错见 [Windows 开发环境](README.md#windows-x64)。发布版已携带编译后的沙箱程序，运行发布版不需要 Rust。

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
- `pnpm prepare:electron`：检查并准备当前平台的 Electron 二进制；默认使用 Electron
  文档推荐的中国镜像，可通过 `ELECTRON_MIRROR` 覆盖下载源。
- `pnpm dev:electron`：先准备 Electron，再构建 contracts/runtime/electron bundle 并启动。
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
- `pnpm test:release`：先下载并校验当前平台固定版本的 ripgrep，再运行需要在每个打包平台验证的 Main、Git、路径、Shell、Store、workspace 和构建脚本门禁。
- `pnpm lint`：ESLint；架构规则由 `pnpm typecheck` 前置执行。
- `pnpm package:*`：按平台打包。
- `pnpm release:dry-run`：生成本地发布清单预览。

## `scripts/build-electron.ts`

用 esbuild 生成：

- `dist/electron/main/index.js`：Electron main，ESM。
- `dist/electron/preload/index.cjs`：preload，CJS。
- `dist/runtime/cli.cjs`：runtime CLI，CJS。

external：

- main external `electron`、`node-pty`、`proxy-chain`、`undici`。后两者包含 CommonJS
  依赖，不能内联到 ESM main bundle，否则 Node 内置模块调用会被转换为不可用的动态
  `require`。
- preload external `electron`。

约束：

- runtime CLI 会被 Electron main 作为子进程启动，打包路径要与 `RuntimeHost.resolvePackagedRuntimeEntry()` 一致。
- `node-pty` 需要保留原生 prebuild，不能被 asar 打坏。

## `scripts/start-electron-dev.ts`

dev 启动流程：

1. `dev:electron` 先通过 `scripts/prepare-electron.mjs` 检查二进制；缺失时显示周期进度，
   下载超时会明确失败而不是让启动命令无限等待。安装期的 root `postinstall` 也执行同一检查。
2. 复用当前 pnpm entrypoint 构建 contracts、Feature packages 和 runtime。
3. Windows x64 调用 `build:windows-sandbox` 编译并校验 Rust 沙箱程序，再通过 `prepare:windows-sandbox-curl` 准备 curl；任一步失败都会阻止 Electron 启动。
4. 调用 `buildElectron()`。
5. 通过开发 supervisor 启动 Electron；应用内计划重启使用专用退出码原地拉起，
   不结束 Vite renderer。
6. 注入：
   - `SETSUNA_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:5174`
   - `SETSUNA_DESKTOP_RUNTIME_ENTRY=packages/desktop-runtime/dist/cli.js`

未打包的 Electron 使用独立开发 profile，位于系统 `appData` 下的
`Setsuna Desktop Development/`。它拥有独立的数据根、Chromium session、runtime
存储和 bootstrap 实例锁，因此可以和已安装的正式版同时运行，也不会读写正式版数据。
打包应用继续使用原有目录，不受该开发隔离影响。

## Vite

`vite.config.ts`：

- 使用 React plugin。
- dev server 固定 `127.0.0.1:5174`。
- `base: './'` 兼容 Electron `loadFile`。
- alias：
  - `@renderer`
  - `@setsuna-desktop/contracts`
  - `@setsuna-desktop/feature-core`
  - `packages/features/*` 的 source alias 由 `scripts/feature-package-aliases.ts` 派生，并与 Vitest 共用
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

- macOS arm64/x64：DMG 安装包和原生自动更新用 ZIP；Release workflow 要求内部 app 完成 Developer ID 签名和 Apple 公证。
- Windows x64：NSIS EXE。

### macOS 签名与公证

使用 **Developer ID Application** 证书，导出的 `.p12` 必须包含对应私钥。
GitHub 仓库的 Settings → Secrets and variables → Actions 中配置：

| Secret | 内容 |
| --- | --- |
| `CSC_LINK` | `.p12` 文件的 Base64 内容 |
| `CSC_KEY_PASSWORD` | `.p12` 导出密码 |
| `APPLE_ID` | Apple 开发者账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 在 Apple 账号「登录和安全性」中生成的 App 专用密码 |
| `APPLE_TEAM_ID` | 证书所属开发者团队的 Team ID |

证书与密码不放入仓库。可通过 `base64 -i /absolute/path/certificate.p12 | gh secret set CSC_LINK`
直接上传证书；其余值可在 GitHub 页面填写，或通过 `gh secret set <NAME>` 交互输入。

`electron-builder` 负责临时钥匙串、嵌套 Electron Helper、原生模块和 ripgrep 的签名，
并提交 app 公证、装订票据。使用内置 Electron entitlements 和 Hardened Runtime。
Release workflow 只向 macOS 打包步骤注入凭据，强制签名，并在收集产物前运行
`codesign --verify`、`stapler validate` 和 Gatekeeper 检查。缺少凭据或公证失败会阻止发布。
DMG 是包含已签名、公证 app 的分发容器，不单独提交公证。

本地打包自动使用登录钥匙串里的 Developer ID 证书；设置上述 Apple 公证环境变量后也会公证。
也支持先用 `xcrun notarytool store-credentials setsuna-notary` 交互保存公证凭据，
再设置 `APPLE_KEYCHAIN_PROFILE=setsuna-notary` 打包，避免把密码写进 shell 历史。
没有正式签名身份时，`after-pack.cjs` 保留 ad-hoc 签名供本机测试；此类包不能作为正式发布产物。

## CI

`.github/workflows/ci.yml` 在面向 `master` 的 pull request 和手动运行时触发。分支保护要求 PR 基于最新基线通过 `CI / typecheck, lint, test`。

macOS `verify` job 固定 pnpm `7.33.7`、Node.js `22` 和 Python `3.11`，依次执行：

1. `node scripts/configure-node-gyp-python.mjs`。
2. `pnpm install --frozen-lockfile`。
3. `pnpm typecheck`（包含 architecture check）。
4. `pnpm lint`。
5. `pnpm test`（unit + integration）。

Windows `windows-sandbox` job 对原生 sidecar 执行 Rust 格式、Clippy、测试、协议 smoke test，以及账户、ACL、防火墙和受限进程验证。

## Release Workflow

`.github/workflows/release.yml` 手动触发，输入 tag、release name、draft、prerelease。

package job matrix：

- macOS Apple Silicon：`macos-15`，`package:mac:arm64`。
- macOS Intel：`macos-15-intel`，`package:mac:x64`。
- Windows x64：`windows-2025`，`package:win:x64`。

发布先在 macOS `quality-gate` job 中统一运行一次 typecheck 和完整 `test:unit`。门禁通过后，每个平台：

1. 安装依赖。
2. `test:release`，只覆盖必须跨平台验证的边界。
3. package。
4. collect release assets。
5. upload artifact。

release 另有 `Integration diagnostics` job，在 macOS 上先构建 contracts（源码插件 Worker 需要其包导出），再跑 `test:integration` 并上传 `diagnostic-*` 日志 artifact。该 job 是诊断信号，不阻塞 package/publish；正式发布资产只从 `release-*` package artifacts 收集。

publish job：

1. 下载所有 release artifact。
2. `prepare-github-release-assets.mjs` 校验三个安装包及两个 macOS 更新 ZIP 齐全且无重名，整理上传目录并生成 SHA256SUMS。
3. 写 release notes。
4. 用 `gh release create/edit/upload` 发布或更新 GitHub Release。

### Windows 路径门禁

Windows runner 可能同时暴露同一目录的 8.3 短路径和长路径，并伴随盘符大小写、分隔符或 junction 差异。路径是否位于 workspace、sandbox deny root/glob 是否命中等安全判断，必须先把参与比较的两侧规范到同一种 canonical path：

- 不要混用 `fs/promises.realpath()` 与普通 `realpathSync()` 的结果。普通同步实现不会可靠展开 Windows 8.3 短路径；需要同步解析时使用 `realpathSync.native()`，与异步原生解析保持一致。
- workspace root、candidate、deny root 和绝对 glob 的固定前缀必须采用同一套 canonicalization。只有在比较边界才统一分隔符和大小写，文件系统读写仍使用平台原生路径。
- 规则包含 glob 时，只 canonicalize 第一个通配符前实际存在的固定前缀，再拼回 glob 后缀；不要把 `*`、`?` 或字符组传给 `realpath`。
- 测试如果验证两个路径指向同一目录，必须用同一种 `realpath` 实现 canonicalize 实际值和期望值后再比较。除非路径的字符串表示本身就是对外契约，否则禁止直接断言原始路径字符串相等。
- canonicalization 的测试必须关闭无关的默认排除层，确保断言确实由目标 deny root/glob 命中，不能让 `.env` 等默认规则代替被测路径逻辑。

这类改动至少运行对应路径策略测试、`pnpm typecheck` 和 `pnpm test:release`。最终结论以 Release workflow 的 Windows x64 gate 为准；本地 macOS 通过不能替代 Windows 路径验证。

## Release 下载清单

公开下载包括 macOS arm64/x64 的 DMG 和 ZIP、Windows x64 NSIS EXE，以及覆盖全部五个文件的 `SHA256SUMS`。
ZIP 与 DMG 来自同一签名、公证 app，ZIP 用于 Electron 原生自动更新。更新器仍从 GitHub Release API
发现版本，macOS 优先选取同架构 ZIP，并强制校验 SHA-256；不上传 Linux 包、blockmap、electron-builder
更新元数据、内部 manifest 或构建日志。临时 Squirrel feed 由 main 根据已下载 ZIP 在本机生成，无需托管额外服务。

首次从未签名或尚无原生更新逻辑的旧版本迁移时，用户需要手动安装新版 DMG；后续版本可在应用内重启安装。

`scripts/release-assets.mjs` 定义三个平台的安装包与更新 ZIP 清单，供以下脚本共用：

- `collect-release-job-assets.mjs`：每个平台收集其安装包与更新 ZIP；任一必需文件缺失直接失败。
- `prepare-github-release-assets.mjs`：只接收清单中的安装包与更新 ZIP，拒绝重名或缺少平台的发布，并生成校验文件。
- `release-dry-run.mjs`：生成本地 `release-artifacts/dry-run/release-manifest.json` 预览；该文件不上传，也不为预览生成安装包校验和。

构建和测试日志继续通过 `diagnostic-*` Actions artifacts 保留 14 天，不进入公开 Release 下载区。

同一 tag 重跑时，先上传新安装包与校验文件，再清理该版本已废弃的生成资产；保留自定义附件。此流程不会批量修改其他历史 Release。

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
