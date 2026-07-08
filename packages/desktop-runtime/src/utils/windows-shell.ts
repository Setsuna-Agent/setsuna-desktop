export function powershellCommand(command: string): string {
  const normalized = normalizeLeadingJsonQuotedWindowsExecutable(command);
  return /^"[a-zA-Z]:\\[^"]+"\s+/.test(normalized) ? `& ${normalized}` : normalized;
}

function normalizeLeadingJsonQuotedWindowsExecutable(command: string): string {
  return command.replace(/^"([a-zA-Z]:\\\\[^"]+)"(\s+.*)?$/u, (_match, executable: string, rest = '') =>
    `"${executable.replace(/\\\\/g, '\\')}"${rest}`
  );
}
