import { AppServerRpcError } from './errors.js';

export function sweOffsetPage<T>(
  items: T[],
  cursor: string | undefined,
  limit: number | undefined,
  totalLabel: string,
) {
  const total = items.length;
  if (total === 0) return { data: [], nextCursor: null };

  const effectiveLimit = Math.min(total, Math.max(1, Math.trunc(limit ?? total)));
  const start = cursor ? sweOffsetCursor(cursor, total, totalLabel) : 0;
  const end = Math.min(total, start + effectiveLimit);
  return {
    data: items.slice(start, end),
    nextCursor: end < total ? String(end) : null,
  };
}

function sweOffsetCursor(cursor: string, total: number, totalLabel: string): number {
  if (!/^\d+$/.test(cursor)) throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  const start = Number(cursor);
  if (!Number.isSafeInteger(start)) throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  if (start > total) throw new AppServerRpcError(-32600, `cursor ${start} exceeds total ${totalLabel} ${total}`);
  return start;
}
