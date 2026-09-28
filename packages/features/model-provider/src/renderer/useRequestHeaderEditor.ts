import type { ProviderRequestHeaders } from '@setsuna-desktop/contracts';
import { useState } from 'react';
import { defaultProviderRequestHeaders } from '../contracts/index.js';
import { createRequestHeaderRow, parseRequestHeaderRows, requestHeaderRows, type RequestHeaderRow } from './request-header-editor.js';

type HeaderDraft = Readonly<{
  source: string;
  pendingSource?: string;
  rows: RequestHeaderRow[];
  invalid: boolean;
  edited: boolean;
}>;

export function useRequestHeaderEditor(
  catalogProviderId: string | null | undefined,
  requestHeaders: ProviderRequestHeaders | undefined,
  onChange: (headers: ProviderRequestHeaders | undefined) => void,
) {
  const defaults = defaultProviderRequestHeaders(catalogProviderId);
  const headers = requestHeaders ?? defaults;
  const source = headerSource(catalogProviderId, requestHeaders);
  const [draft, setDraft] = useState<HeaderDraft>(() => initialDraft(source, headers));
  let current = draft;
  if (draft.source !== source) {
    // An acknowledged save keeps row identities and untrimmed input. External changes replace the draft.
    current = draft.pendingSource === source
      ? { ...draft, source, pendingSource: undefined }
      : initialDraft(source, headers);
    setDraft(current);
  }

  const updateRows = (rows: RequestHeaderRow[]) => {
    let nextHeaders: ProviderRequestHeaders;
    try {
      nextHeaders = parseRequestHeaderRows(rows);
    } catch {
      setDraft({ source, rows, invalid: true, edited: true });
      return;
    }
    const changed = JSON.stringify(nextHeaders) !== JSON.stringify(headers);
    setDraft({
      source, rows, invalid: false, edited: true,
      pendingSource: changed ? headerSource(catalogProviderId, nextHeaders) : undefined,
    });
    if (changed) onChange(nextHeaders);
  };

  return {
    rows: current.rows,
    invalid: current.invalid,
    canRestore: requestHeaders !== undefined || current.edited,
    update(id: string, patch: Partial<Pick<RequestHeaderRow, 'name' | 'value'>>) {
      updateRows(current.rows.map((row) => row.id === id ? { ...row, ...patch } : row));
    },
    add() {
      const row = createRequestHeaderRow();
      setDraft({ ...current, rows: [...current.rows, row], edited: true });
      return row.id;
    },
    remove(id: string) {
      const rows = current.rows.filter((row) => row.id !== id);
      updateRows(rows.length ? rows : [createRequestHeaderRow()]);
    },
    restore() {
      setDraft({ ...initialDraft(source, defaults), pendingSource: headerSource(catalogProviderId, undefined) });
      onChange(undefined);
    },
  };
}

function headerSource(catalogProviderId: string | null | undefined, headers: ProviderRequestHeaders | undefined): string {
  return JSON.stringify([catalogProviderId ?? null, headers ?? null]);
}

function initialDraft(source: string, headers: Readonly<ProviderRequestHeaders>): HeaderDraft {
  return { source, rows: requestHeaderRows(headers), invalid: false, edited: false };
}
