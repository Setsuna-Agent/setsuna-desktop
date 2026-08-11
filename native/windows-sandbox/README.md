# Setsuna Windows Sandbox

`setsuna-sandbox-win.exe` is the single native Windows sidecar used by Setsuna
Desktop. It deliberately has no daemon or Windows service. One executable owns
installation checks, elevated setup, sandboxed process creation, repair, and
uninstall.

The security boundary is fail-closed:

- two managed local accounts separate offline and online executions;
- Windows Firewall rules block direct egress and expose only the Setsuna proxy
  port range to the online account;
- restricted tokens, per-execution logon SIDs, and policy-scoped capability SIDs
  constrain writes; temporary logon/request ACL entries are revoked after each
  run, while reads remain governed by the dedicated account's host DACLs;
- a hash-verified, machine-readable but sandbox-nonwritable runner copy removes
  dependencies on the per-user packaged executable ACL;
- a non-breakaway Job Object terminates the whole process tree when the sidecar
  exits, and supervisor handles terminate it when runtime or Electron main dies;
- shared/exclusive lifecycle locks refuse repair or uninstall while jobs are
  active, so identity-scoped firewall rules cannot disappear underneath them;
- policies that cannot be represented by the native provider are rejected
  instead of being run on the host.

V1 protects write integrity and network egress; it is not a confidentiality
boundary equivalent to a VM. Existing host DACLs may still make files readable
to ordinary local users. As in upstream Codex, Windows compatibility requires
the World SID in the write-restricted compatibility list, so objects already
writable by an explicit Everyone ACE remain writable to the dedicated account.
The token default DACL likewise follows upstream and grants World access so
Windows pipelines and IPC-heavy native tools can initialize. Predictably named
objects created without an explicit security descriptor are therefore not an
isolation boundary between local machine accounts.
Read-only workspaces and protected roots receive an explicit capability
mutation deny that covers the root and normally inherited children, but cannot
override an explicit allow installed directly on a child. Ordinary private
paths remain isolated by the account's first DACL check.
Denied-root/glob policies, non-NTFS paths, UNC paths, and absent protected child
names are rejected or documented as unsupported in
`docs/designs/windows-native-sandbox.md`. Upstream proxies are also rejected:
only direct egress can bind the validated DNS result to the outbound socket.

The Windows implementation takes design cues from OpenAI Codex's Apache-2.0
licensed `windows-sandbox-rs` package. Setsuna keeps an intentionally smaller,
single-binary implementation and its own versioned protocol.

## Development

The locked dependency graph requires Rust/Cargo 1.85 or newer.

```text
cargo test --manifest-path native/windows-sandbox/Cargo.toml
cargo check --manifest-path native/windows-sandbox/Cargo.toml --target x86_64-pc-windows-msvc
```

The second command validates Win32 bindings but does not replace the Windows
integration tests. Account, ACL, firewall, cancellation, and network tests must
run on a disposable Windows CI host.
