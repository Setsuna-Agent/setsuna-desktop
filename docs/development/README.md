# Development

本目录说明本地开发、验证、构建和发布。模块设计从 [docs 首页](../README.md) 进入。

## 环境

- Node.js `>=22.13.0`
- pnpm `7.33.7`（仓库 `packageManager`）
- 原生依赖 `node-pty`
- Git

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
- Electron supervisor：构建 contracts/runtime/main/preload 后启动桌面

如果没有 provider，runtime 使用 test/smoke model 验证完整链路。

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
- CI matrix。
- Release artifacts/manifest/checksum。

[仓库脚本](../scripts/README.md) 逐个说明 `scripts/`。

## 目录/文档变更

目录变化后：

```bash
pnpm docs:tree
git diff --check
```

`pnpm typecheck` 会通过 `check:architecture` 验证 `Tree.md` 未过期。

