# Setsuna Desktop

Setsuna Desktop is a local-first Electron workspace for agent workflows. The renderer talks only to a local runtime bridge; the runtime owns model calls, thread storage, tool execution, approvals, skills, memory, and event streaming.

This repository follows the direction in `docs/local-desktop-runtime-architecture-review.md`: no remote WebView app, no backend Agent API dependency, and GitHub Releases as the canonical release source.

## Requirements

- Node.js 22+
- pnpm 7+

## Development

```bash
pnpm install
pnpm dev
```

Useful scripts:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm package
pnpm package:mac:arm64
pnpm package:mac:x64
pnpm package:win:x64
pnpm package:linux:x64
pnpm release:dry-run
```

## Current Scope

This is the Phase 1 skeleton:

- Electron local renderer window.
- Preload bridge exposed as `window.setsunaDesktop.runtime`.
- Runtime host that starts a local Node runtime process with a per-process bearer token.
- Local HTTP/SSE runtime endpoints for `/health`, `/v1/config`, `/v1/threads`, `/v1/projects`, `/v1/skills`, `/v1/memories`, and `/v1/usage`.
- JSON-only local storage shaped behind ports so it can move to JSONL + SQLite later.
- Provider adapters for OpenAI compatible `/chat/completions`, OpenAI Responses `/responses`, and Anthropic `/v1/messages`, with a local smoke fallback when no API key is configured.
- Local project registry plus workspace status, directory listing, read-only file reads, and text search.
- A runtime `ToolHost` boundary with workspace tools exposed to the agent loop, including an approval-gated `workspace_write_file`.
- Local Skills API and runtime injection for packaged built-in skills.
- Local usage records captured by the runtime loop and exposed through a JSONL-backed usage store/API.
- Local memory records stored on disk, exposed through runtime API, available to the model through `remember_memory` / `recall_memory`, and injected back into future turns.
- Local approval queue exposed through runtime events and `/v1/approvals`, so risky tools can pause until the renderer answers.

Shell execution, MCP process execution, media generation, computer-use, packaging signatures, and release automation are intentionally staged behind the same runtime boundaries rather than mixed into the renderer.

## Architecture

```text
React renderer
  -> preload bridge
  -> Electron RuntimeHost
  -> local Node runtime service
  -> ports/adapters/loop/server modules
```

The renderer does not know provider protocols and does not directly construct runtime URLs. The runtime service persists local threads and emits canonical runtime events over SSE.

## Release Policy

GitHub Releases are the canonical source for installable artifacts and metadata. `pnpm release:dry-run` creates a local release manifest preview with platform signing state, checksum placeholders, and log bundle expectations. Formal CI release publishing will upload installers, archives, checksums, `release-manifest.json`, updater metadata, and long-lived build logs.

macOS v1 is currently treated as `unsigned`, `notarization: skipped`, and `installMode: manual`.

Formal publishing is handled by the manual `Release` GitHub Actions workflow. Run it with a tag such as `v0.1.0`; the workflow builds and uploads these GitHub Release assets:

- macOS Apple Silicon: unsigned `.dmg` and `.zip`.
- macOS Intel: unsigned `.dmg` and `.zip`.
- Windows x64: NSIS `.exe` installer and `.zip`.
- Ubuntu x64: `.AppImage`, `.deb`, and `.tar.gz`.
- Shared metadata: `SHA256SUMS`, `release-manifest.json`, and `build-logs-vX.Y.Z.zip`.
