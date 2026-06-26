# Security

Setsuna Desktop runs local tools and stores local model provider settings. Security-sensitive changes should be reviewed carefully.

## Reporting

Please open a private security advisory or contact the repository maintainers before publishing details.

## Local Runtime Boundaries

- Runtime requests are proxied through Electron main and authenticated with a per-process bearer token.
- Provider API keys must not be returned to the renderer. Configuration responses expose only masked state.
- Shell, MCP, computer-use, and destructive file tools must go through runtime approval policy before they become generally available.
- Workspace-scoped paths are normalized and checked before file listing, reading, or search. Paths that escape the registered project root are rejected.

The initial skeleton uses a local file-backed secret adapter to keep the runtime self-contained. The adapter is intentionally isolated so OS credential storage can replace it without changing renderer or loop contracts.
