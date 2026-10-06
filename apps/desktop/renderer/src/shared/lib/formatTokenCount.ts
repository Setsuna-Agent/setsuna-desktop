export function formatTokenCount(value: number): string {
  const tokens = Math.max(0, Math.round(Number(value || 0)));
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number(millions.toFixed(millions >= 10 ? 0 : 1))}M`;
  }
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(tokens);
}
