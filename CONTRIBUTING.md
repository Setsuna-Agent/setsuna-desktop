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

## Commit Messages and PR Titles

Use `type(scope): summary` for commit subjects and PR titles. The scope is optional: use `type: summary` when no single area fits. Keep subjects in English, consistent with the existing history.

| Type | Use for |
| --- | --- |
| `feat` | A new capability or user-facing behavior |
| `fix` | Correcting broken or unintended behavior |
| `perf` | Improving performance without changing intended behavior |
| `refactor` | Restructuring code without changing behavior |
| `docs` | Documentation changes |
| `test` | Adding or improving tests and fixtures |
| `style` | Formatting or visual styling without behavior changes |
| `build` | Build tooling, dependencies, or packaging |
| `ci` | CI workflows and automation |
| `chore` | Repository maintenance that does not fit another type |

- Choose the type by the main purpose of the change. A bug fix with tests is still `fix`; use `test` for a commit dedicated to tests.
- Use a short scope naming the affected feature or layer, such as `chat`, `workspace`, `settings`, `model-provider`, `runtime`, or `renderer`. Do not list every touched directory.
- Start the summary with an imperative verb such as `add`, `fix`, `preserve`, or `remove`. Describe the concrete outcome; avoid vague subjects such as `update code`, `fix bugs`, or `address review`.
- Keep the subject concise, preferably within 72 characters, and omit the trailing period. Put explanations in the body.

Examples:

```text
feat(workspace): add document previews
fix(settings): keep sections visible while lazy feature pages load
refactor(chat): extract attachment handling into a shared hook
docs: document commit and pull request conventions
```

Keep each commit focused on one logical change. Add a body after a blank line when the reason, behavior change, or tradeoff is not clear from the subject:

```text
fix(storage): preserve busy conversations during cleanup

Recheck conversation activity before deletion so cleanup preserves threads
that became active after the initial scan.
```

For breaking changes, add `!` before the colon and a `BREAKING CHANGE:` footer describing the impact and required migration. Automatically generated merge or revert messages can keep Git's default format.

## Pull Requests

Open PRs against `master` and keep each PR focused on one problem or capability. Include related tests and documentation, and leave unrelated cleanup for a separate change.

The title describes the final result of the whole PR, not just its latest commit. Update the title and description when the scope changes; omit debugging history and intermediate attempts unless they explain a relevant tradeoff.

Use the following structure when helpful. Small changes may only need a short explanation and validation results; add detail according to the impact of the change.

```markdown
## What

Explain the problem and the resulting behavior. For a bug fix, describe
the trigger and the before/after behavior. Link a related issue if applicable.

## Changes

- Summarize the implementation choices a reviewer needs to understand.
- Note compatibility, persisted-data, migration, or release impact when relevant.

## Test Plan

- `command`: result and the behavior checked.
- Manual validation, if performed: platform, steps, and observed result.
- Checks not run, if relevant: reason and remaining limitation.
```

Report only validation that actually ran. Follow [testing and validation](docs/development/testing.md) to choose checks for the affected area, and identify the platform when results depend on macOS or Windows. Changes to runtime contracts should include meaningful behavior tests or fixtures. For documentation-only changes, check links and commands and run `git diff --check`; a full build is unnecessary.
