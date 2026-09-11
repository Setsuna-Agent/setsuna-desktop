---
name: "Create MCP in Chat"
description: "Collect MCP configuration through conversation and use the local tool to save it to the desktop app."
---

# Create MCP in Chat

Use this Skill when the user wants to install, update, enable, or configure a desktop MCP server through conversation. The capability page's “Install MCP in chat” action selects this Skill. Complete configuration through the existing desktop MCP flow instead of asking the user to write JSON.

## Runtime flow

- Use `configure_mcp_server` to save MCP configuration.
- Do not directly edit MCP JSON files or use shell redirection to write configuration.
- `configure_mcp_server` triggers user authorization; briefly explain the key configuration before calling it.
- After saving, the server is normally available in the next conversation turn after runtime refresh.

## Required information

Determine whether the user is adding or updating a server. Ask only for missing required information, not every form field.

Common fields:

- `key`: stable server identifier, preferably lowercase letters, digits, hyphens, or underscores.
- `label`: display name, inferred from the request when possible.
- `description`: one sentence describing the capability.
- `enabled`: defaults to `true` unless the user explicitly wants it disabled.

For `stdio`:

- `transport`: `stdio`.
- `command`: executable such as `npx`, `node`, `uvx`, or an absolute path.
- `args`: command argument array. Do not put the entire command line in `command`.
- `cwd`: optional working directory.
- `env`: optional environment variable values.
- `allowed_tools` / `disabled_tools`: optional tool filters.
- `timeout_ms`: optional timeout.

For `streamableHttp`:

- `transport`: `streamableHttp`.
- `url`: MCP server address.
- `headers`: optional fixed request headers.
- `allowed_tools` / `disabled_tools`: optional tool filters.
- `timeout_ms`: optional timeout.

## Inference rules

- Use `streamableHttp` by default for an `http://` or `https://` address.
- Use `stdio` for an executable, package name, or launcher such as `npx`, `node`, `uvx`, `python`, or `bunx`.
- Split installation commands into `command` and `args`: `npx -y @example/mcp` becomes `command: "npx"`, `args: ["-y", "@example/mcp"]`.
- Never invent tokens, API keys, header values, or private paths. The tool saves fixed `env` or `headers` values only; ask for missing credentials and do not submit nonexistent fields.

## Workflow

1. Extract the MCP server information from the request.
2. Generate a stable `key` from the name if omitted, and tell the user.
3. Ask for missing connection requirements: `command` for `stdio`, `url` for `streamableHttp`.
4. Call `configure_mcp_server` with structured fields.
5. On success, report the key, transport, primary connection details, and availability after runtime refresh or in the next turn.
6. On error, explain the specific missing or malformed value and continue correcting the input.

## Output

- Keep the pre-save explanation short: include only the key, transport, and command or URL to be saved.
- Do not ask the user to copy JSON after saving.
- If the user wants to try the server immediately, guide them to make a request using its capability.
