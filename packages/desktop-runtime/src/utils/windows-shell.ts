export function powershellCommand(command: string): string {
  const normalized = normalizeLeadingJsonQuotedWindowsExecutable(command);
  const commandText = /^"[a-zA-Z]:\\[^"]+"\s+/.test(normalized) ? `& ${normalized}` : normalized;
  return `${commandText}; if ($global:LASTEXITCODE -ne $null) { exit $global:LASTEXITCODE }`;
}

function normalizeLeadingJsonQuotedWindowsExecutable(command: string): string {
  return command.replace(/^"([a-zA-Z]:\\\\[^"]+)"(\s+.*)?$/u, (_match, executable: string, rest = '') =>
    `"${executable.replace(/\\\\/g, '\\')}"${rest}`
  );
}
