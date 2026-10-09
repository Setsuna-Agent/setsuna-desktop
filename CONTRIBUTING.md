# Contributing

Thanks for helping build Setsuna Desktop.

## Local Setup

Use Node.js `>=22.19.0` and pnpm `7.33.7`. Supported platforms are macOS and Windows; Windows development also requires Rust and the MSVC build tools. Follow the [development guide](docs/development/README.md) for setup and startup.

Run the most relevant existing check first, then expand validation according to the change. See [testing and validation](docs/development/testing.md) for focused commands; a full build is not required for documentation changes.

## Architecture Rules

- Use `DesktopRuntimeClient` for Core renderer operations and Feature-owned typed clients for business operations. Native capabilities use narrow host-injected preload bridges.
- Put Core DTOs in `packages/contracts`, business DTOs in the owning Feature's `/contracts`, and renderer Slot contracts in `packages/renderer-contracts`.
- Put runtime behavior behind ports and adapters before wiring it into the loop.
- Do not add backend Agent API calls or remote app URLs.
- Do not expose provider API keys to renderer state. Renderer may only see masked key state.
- Prefer small primitives and hooks over repeated component-specific controls.
- Keep peripheral initialization off runtime readiness and the first usable renderer frame. Cover slow, failed and cancelled background work when changing startup.

The [architecture guide](docs/architecture/README.md) and [Feature guide](docs/features/README.md) describe ownership and process boundaries. Coding agents should also follow [AGENTS.md](AGENTS.md).

## Pull Requests

Include a short summary, validation commands, and any release or migration impact. Changes to runtime contracts should include tests or fixtures.
