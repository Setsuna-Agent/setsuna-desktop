# Contributing

Thanks for helping build Setsuna Desktop.

## Local Setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Architecture Rules

- Keep renderer code behind `DesktopRuntimeClient`.
- Put shared DTOs in `packages/contracts`.
- Put runtime behavior behind ports and adapters before wiring it into the loop.
- Do not add backend Agent API calls or remote app URLs.
- Do not expose provider API keys to renderer state. Renderer may only see masked key state.
- Prefer small primitives and hooks over repeated component-specific controls.

## Pull Requests

Include a short summary, validation commands, and any release or migration impact. Changes to runtime contracts should include tests or fixtures.

