<p align="center">
  <img src="assets/build/icon.png" width="96" alt="Setsuna Desktop logo">
</p>

<h1 align="center">Setsuna Desktop</h1>

<p align="center">
  <strong>Understand, edit, run, and review code with an AI agent.</strong>
</p>

<p align="center">
  An open-source AI agent workspace for macOS, Windows, and Linux.
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/Setsuna-Agent/setsuna-desktop/releases/latest">Download</a>
  · <a href="docs/README.md">Documentation</a>
  · <a href="CONTRIBUTING.md">Contributing</a>
  · <a href="https://github.com/Setsuna-Agent/setsuna-desktop/issues">Feedback</a>
</p>

<p align="center">
  <a href="https://github.com/Setsuna-Agent/setsuna-desktop/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Setsuna-Agent/setsuna-desktop?display_name=tag&amp;sort=semver"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-black.svg"></a>
  <img alt="Supported platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-black.svg">
  <img alt="Node.js 22.19 or newer" src="https://img.shields.io/badge/node-%3E%3D22.19.0-43853d.svg">
</p>

<p align="center">
  <img src="assets/readme/setsuna-home.png" alt="Start a new task in Setsuna Desktop" width="100%">
</p>

## Product tour

<p align="center">
  <img src="assets/readme/chat-review.png" alt="Setsuna Desktop conversation with code review open" width="100%">
</p>

## Download

Get the latest stable build from [GitHub Releases](https://github.com/Setsuna-Agent/setsuna-desktop/releases/latest).

| Platform | Release artifacts |
| --- | --- |
| macOS Apple Silicon | DMG, ZIP |
| macOS Intel | DMG, ZIP |
| Windows x64 | NSIS installer, ZIP |
| Linux x64 | AppImage, DEB, tar.gz |

Each release also includes `SHA256SUMS` and `release-manifest.json` for checksum and artifact metadata verification.

> [!IMPORTANT]
> macOS builds are currently unsigned and not notarized, so installation is manual. Check the release notes before installing.

> [!WARNING]
> Setsuna Desktop is under active development on the path to 1.0. Features, interfaces, and local data formats may change between releases.

## Run from source

### Prerequisites

- Git, Node.js `>=22.19.0`, and pnpm `7.33.7` (the version pinned in `package.json`).
- **Windows x64:** Rust/Cargo `>=1.85` with the `x86_64-pc-windows-msvc` toolchain, Visual Studio C++ build tools, and a Windows SDK.

On Windows, install the **Desktop development with C++** workload, including the MSVC x64/x86 tools and Windows SDK, as described in the [Rust MSVC prerequisites](https://rust-lang.github.io/rustup/installation/windows-msvc.html). Then install Rust using the [Windows x64 rustup installer](https://rust-lang.org/tools/install/) and select the MSVC toolchain. Reopen your terminal and check:

```powershell
rustup target add x86_64-pc-windows-msvc
rustc --version
cargo --version
```

On Windows x64, `pnpm dev` and `pnpm dev:electron` compile the native Windows sandbox before starting Electron. Missing Cargo or MSVC/SDK components cause startup to fail; installing JavaScript dependencies alone is not enough. Windows packaging also requires these tools.

macOS and Linux development startup does not build this Windows component. **Running a downloaded release does not require Rust**; the Windows release includes the compiled sandbox executable. See [Windows development setup](docs/development/README.md#windows-x64) for troubleshooting.

### Development

```bash
git clone https://github.com/Setsuna-Agent/setsuna-desktop.git
cd setsuna-desktop
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` starts both the Vite renderer and the Electron desktop shell. If no model provider is configured, the local smoke fallback can be used to verify the runtime path; add a provider under **Settings → Model providers** to use a real model.

Renderer changes use Vite hot reload. After changing runtime, Electron main/preload, or native code, stop and rerun `pnpm dev` to rebuild and restart the backend; refreshing the window alone keeps the old backend process running.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the renderer and Electron development environment |
| `pnpm typecheck` | Run architecture checks and TypeScript project-reference checks |
| `pnpm test` | Run unit and integration tests |
| `pnpm lint` | Run ESLint with zero warnings allowed |
| `pnpm build` | Build contracts, runtime, Electron, and renderer packages |

See [Development](docs/development/README.md), [Testing](docs/development/testing.md), and [Build and release](docs/development/build-and-release.md) for the full workflow.

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, use [GitHub Issues](https://github.com/Setsuna-Agent/setsuna-desktop/issues) for bugs and feature requests, and follow [SECURITY.md](SECURITY.md) when reporting a vulnerability.

Setsuna Desktop is part of the [Setsuna Agent](https://github.com/Setsuna-Agent) open-source organization.

## License

[MIT](LICENSE)
