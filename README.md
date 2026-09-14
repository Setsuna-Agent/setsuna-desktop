<p align="center">
  <img src="assets/build/icon.png" width="96" alt="Setsuna Desktop logo">
</p>

<h1 align="center">Setsuna Desktop</h1>

<p align="center">
  An open-source AI coding assistant for macOS and Windows.
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
  <img alt="Supported platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-black.svg">
</p>

<p align="center">
  <img src="assets/readme/setsuna-home.png" alt="Start a new task in Setsuna Desktop" width="100%">
</p>

## Product tour

<p align="center">
  <img src="assets/readme/chat-review.png" alt="Setsuna Desktop conversation with code review open" width="100%">
</p>

## Download

Download the latest version from [GitHub Releases](https://github.com/Setsuna-Agent/setsuna-desktop/releases/latest).

| Platform | Installer |
| --- | --- |
| macOS Apple Silicon | DMG |
| macOS Intel | DMG |
| Windows x64 | EXE |

macOS builds are not yet signed or notarized. See the release notes for installation instructions.

After opening the app, add your model provider in **Settings → Model providers**.

## Run from source

Requires Git, Node.js `>=22.19.0`, and pnpm `7.33.7`. On Windows, also install Rust and the C++ build tools; see [Windows setup](docs/development/README.md#windows-x64).

```bash
git clone https://github.com/Setsuna-Agent/setsuna-desktop.git
cd setsuna-desktop
corepack enable
pnpm install
pnpm dev
```

See the [development guide](docs/development/README.md) for testing, building, and troubleshooting.

## Contributing

Report bugs or suggest features in [Issues](https://github.com/Setsuna-Agent/setsuna-desktop/issues). For code contributions, see [CONTRIBUTING.md](CONTRIBUTING.md); for security reports, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
