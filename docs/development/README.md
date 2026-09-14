# Development

本目录说明本地开发、验证、构建和发布。模块设计从 [docs 首页](../README.md) 进入。

## 环境

- Node.js `>=22.19.0`
- pnpm `7.33.7`（仓库 `packageManager`）
- 原生依赖 `node-pty`
- Git

### Windows x64

Windows 桌面源码开发与打包还需要 Rust/Cargo `>=1.85`（原生 crate 的最低版本）、`x86_64-pc-windows-msvc` 工具链、MSVC x64/x86 C++ 构建工具和 Windows SDK。

1. 按 [Rust MSVC 环境说明](https://rust-lang.github.io/rustup/installation/windows-msvc.html)安装 Visual Studio 的“使用 C++ 的桌面开发”工作负载，确认包含 MSVC 和 Windows SDK。
2. 通过 [Windows x64 rustup 安装程序](https://rust-lang.org/tools/install/)安装 Rust，选择 MSVC 工具链。WSL 中的 Linux 工具链不能替代 Windows 本机工具链。
3. 重新打开终端，确认 `rustc --version`、`cargo --version` 可用且版本不低于 `1.85`；运行 `rustup target add x86_64-pc-windows-msvc` 安装目标标准库。

`scripts/start-electron-dev.ts` 在 Windows x64 上会调用 `pnpm build:windows-sandbox`；准备脚本每次都会执行 `cargo build --locked --release --target x86_64-pc-windows-msvc`，再将产物复制到 `.cache/windows-sandbox/win-x64/`。即使目录里有旧产物，也不能省略工具链。`scripts/before-pack.cjs` 在 Windows 打包时执行同一准备流程。首次编译会下载 Cargo 依赖，耗时比后续启动更长。

| 启动报错 | 检查事项 |
| --- | --- |
| `spawn cargo ENOENT` 或找不到 `cargo` | 安装 Rust；确认 `%USERPROFILE%\.cargo\bin` 在 PATH 中，并重新打开终端；从 IDE 启动时也需重启 IDE |
| 找不到 `link.exe`、MSVC 或 Windows SDK 库 | 安装上述 C++ 工作负载和 SDK；仅安装 Rust 不会替代 Windows 链接工具 |
| 缺少 `x86_64-pc-windows-msvc` target | 运行 `rustup target add x86_64-pc-windows-msvc`，并确认当前使用 MSVC 工具链 |

macOS 的常规桌面开发启动不执行这个 Windows 编译步骤。只运行 `pnpm dev:renderer` 也不会触发 Rust 编译，但它仅启动界面开发服务器，不包含 Electron 和本地 runtime。下载发布版的用户不需要 Rust，Windows 包内已经包含沙箱可执行文件。

### 安装依赖

建议：

```bash
corepack pnpm@7.33.7 install
corepack pnpm@7.33.7 dev
```

从仓库根运行 `package.json` 已声明的 script，不使用 npm/npx 试探。

## 开发启动

```bash
pnpm dev
```

并行启动：

- Vite renderer：`127.0.0.1:5174`
- Electron supervisor：构建 contracts、Feature packages 和 runtime；Windows x64 还会编译沙箱并准备 curl，再构建 main/preload、启动桌面

如果没有 provider，runtime 使用 test/smoke model 验证完整链路。

Renderer 支持热更新；runtime、Electron main/preload 和原生代码不随窗口刷新重载。修改这些代码后，停止并重新运行 `pnpm dev`，让启动脚本重新构建并创建新进程。

## 常用验证

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

先跑最相关定向测试，再按影响面扩大。详细见 [测试与验证](testing.md)。

## 构建与发布

[构建与发布](build-and-release.md) 记录：

- TypeScript/esbuild/Vite。
- Electron Builder。
- Native dependency。
- Bundled ripgrep。
- PR CI。
- Release artifacts/manifest/checksum。

[仓库脚本](repository-scripts.md) 逐个说明 `scripts/`。

## 目录/文档变更

目录变化后：

```bash
pnpm docs:tree
git diff --check
```

`pnpm typecheck` 会通过 `check:architecture` 验证 `Tree.md` 未过期。
