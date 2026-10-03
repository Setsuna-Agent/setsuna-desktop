# Windows input helper

The Electron host launches this helper over private stdio. It accepts only
`probe`, `authorize`, `start`, `action`, `end-session`, and `shutdown`;
screenshots remain in Electron.
The wire shape is mirrored by `contracts/windows-input.ts` in the computer-use
feature. No command accepts an executable path, script, clipboard or shell command.

The Windows system-permission row exposes administrator status and an authorization
button. Clicking it sends `authorize` and requests UAC immediately. Authorization
confirms the helper's high integrity without opening an input session or capturing
the desktop. The grant is kept in memory and reused by subsequent `start` requests
with `elevate: true`; it is never restored from a saved preference.

For this explicit grant, normal turn cleanup sends `end-session`, which disarms
input while retaining the elevated helper. User stop, disabling the feature,
errors, locking, and runtime/app exit send `shutdown` and revoke the grant.

Otherwise input starts at the host's integrity level. If the target has higher
or unreadable integrity, or Windows rejects a complete first batch before accepting any events, the broker
launches its own executable with `ShellExecuteExW(runas)`. The user confirms UAC.
The elevated process communicates over a random, local-only named pipe; both ends
verify the peer PID. Electron, renderer and runtime are never elevated.

When authorization is triggered by an action, that action is **not replayed**. A typed
`stale-observation` response asks the session controller for a fresh screenshot.
Cancelling UAC returns `elevation-cancelled`; the controller revokes the turn.
Stopping admission remains possible while UAC is waiting. A late elevated launch
cannot reconnect after its broker/pipe has gone away.

Each `SendInput` call checks the exact count of accepted events. Complete down/up
gestures are submitted together, Unicode text is bounded and split by codepoint,
and partial delivery attempts releases before failing. Accepted input is never
automatically retried. DPI-aware primary-screen coordinates use pixel centres.

Shutdown interrupts between complete input batches, acknowledges release, and
exits. Pipe disconnection and broker death also stop the elevated helper. There is
no service installation or privileged process surviving the app.

From the repository root:

```powershell
pnpm build:computer-use:windows
pnpm test:computer-use:windows
pnpm check:computer-use:windows
pnpm format:computer-use:windows
```

Normal tests do not request UAC or send desktop input. This explicit manual check
requests UAC through the production broker's authorization request, verifies
high integrity and helper reuse, checks that idle sessions reject input, and
confirms that both broker and elevated helper exit without dispatching input:

```powershell
pnpm test:computer-use:windows -- -- --ignored uac_authorizes_only_the_helper_and_it_stops_afterwards
```

The build requires the MSVC Rust target. `build:electron` and `beforePack` prepare
the executable; the packaging check validates its PE architecture. Upstream event
mapping attribution is retained in the root `THIRD_PARTY_NOTICES.md`.
