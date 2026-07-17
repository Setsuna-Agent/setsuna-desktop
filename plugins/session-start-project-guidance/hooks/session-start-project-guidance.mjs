import { existsSync } from 'node:fs';
import path from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}');
  const cwd = String(payload.cwd || process.cwd());
  const candidates = ['AGENTS.md', 'CONTRIBUTING.md', 'README.md'];
  const existing = candidates.filter((file) => existsSync(path.join(cwd, file)));
  if (!existing.length) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Project guidance files in cwd: ${existing.join(', ')}. Read and follow them before making code changes. Session source: ${String(payload.source || 'unknown')}.`,
    },
  }));
});
