# macOS window input helper

Setsuna owns this small Swift sidecar and its stdio protocol. It runs directly
under the Electron host, uses that host's permission identity, and never starts
an HTTP/MCP server or another agent. Requires macOS 14+ and Xcode command line
tools to build; users of packaged Setsuna do not need a Swift toolchain.

`WindowEvents.swift` adapts the target-only SLPS preparation and routed mouse
event fields from [BackgroundComputerUse](https://github.com/actuallyepic/background-computer-use)
at commit `52116acfe0f2f57174f5e0166881abe944cb6eeb`:

- `Actions/Shared/NativeWindowServerPreparation.swift`
- `Actions/Click/NativeBackgroundClickTransport.swift`

Its MIT license is retained in `LICENSE` and packaged with the helper. The
upstream runtime, cursor overlay, screenshot persistence and HTTP layer are not
included. Screenshots use ScreenCaptureKit and stay in memory.

Captures use nominal resolution (at most 2048 pixels on the longest edge).
`WindowGeometry` converts image pixels to local points once; native window
bounds are kept out of the model's observation. A geometry change detected
before input returns `stale-observation`, allowing main to capture again without
replaying the action. Failures after input may have started remain fatal.

The selected window binds PID, window number and app launch time. Each input
rechecks identity and observation geometry. Keyboard routing additionally
checks the exact AX focused window to avoid typing into a sibling window. A
missing private symbol or unsupported target fails without global HID input,
app activation, window raising, cursor warping or clipboard mutation.

`WindowKeyboard` supports navigation keys, letters, digits and optional Meta,
Control, Alt and Shift modifiers. The private-source key-down event carries the
modifiers, and the paired key-up clears them on the target PID; no physical
modifier key is pressed. User stop closes native admission and also cancels the
owning runtime turn in main.

The private SkyLight interface needs compatibility testing on supported macOS
versions. Background delivery is not universal: minimized/hidden windows are
not listed, and applications can ignore synthetic input. Dispatch success is
not proof that the intended UI effect happened. Simultaneously editing the same
window still shares that application's caret and document state.

Build from the repository root with `pnpm build:computer-use:mac` (optionally
append `x64`). `build:electron` prepares the host architecture; `beforePack`
prepares the package architecture. Stop closes admission from the stdin reader,
finishes the in-flight down/up pair, and acknowledges before the process exits.

`pnpm test:computer-use:mac` checks constructed keyboard events and coordinate
mapping without posting any events, capturing the screen or opening an app.
