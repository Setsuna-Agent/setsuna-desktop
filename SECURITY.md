# Security

Setsuna Desktop runs local tools and stores local model provider settings. Security-sensitive changes should be reviewed carefully.

## Reporting

Please open a private security advisory or contact the repository maintainers before publishing details.

## Local Runtime Boundaries

- Runtime requests are proxied through Electron main and authenticated with a per-process bearer token.
- Provider API keys must not be returned to the renderer. Configuration responses expose only masked state.
- Shell and destructive file tools use runtime permission and approval policies. MCP authorization is determined by enabled servers and allowed tools; it does not add a separate per-call confirmation. Computer use requires its own session authorization and platform controls.
- Workspace-scoped paths are normalized and checked before file listing, reading, or search. Paths that escape the registered project root are rejected.

Credential storage has two boundaries. Electron main uses `safeStorage` for its credential vault, including MCP and desktop service credentials, and exposes a narrow authenticated native bridge. Provider API keys in `runtime/secrets.json` and Feature secret revisions in `runtime/secrets/` are local JSON files with restrictive file permissions, not OS-encrypted vault entries. Renderer configuration reads expose masked state. See [data and security boundaries](docs/architecture/data-and-security.md) for storage, process, path and recovery rules.
