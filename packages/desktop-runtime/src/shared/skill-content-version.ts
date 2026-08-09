import { createHash } from 'node:crypto';

/** Compact, stable revision identifier for one normalized SKILL.md body. */
export function skillContentVersion(content: string): string {
  // A short SHA-256 prefix keeps the per-turn catalog compact while retaining
  // enough entropy to bind progressively disclosed instructions to one body.
  const digest = createHash('sha256').update(content, 'utf8').digest('base64url').slice(0, 22);
  return `sha256-${digest}`;
}
