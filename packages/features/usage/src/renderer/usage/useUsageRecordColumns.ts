import { useState } from 'react';
import { DEFAULT_USAGE_RECORD_COLUMNS, normalizeUsageRecordColumns, type UsageRecordColumnKey } from './usageRecordColumns.js';

const STORAGE_KEY = 'setsuna.usage.columns.v1';

export function useUsageRecordColumns() {
  const [columns, setColumns] = useState<readonly UsageRecordColumnKey[]>(() => {
    try {
      return normalizeUsageRecordColumns(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    } catch {
      return DEFAULT_USAGE_RECORD_COLUMNS;
    }
  });

  const saveColumns = (next: readonly UsageRecordColumnKey[]) => {
    const normalized = normalizeUsageRecordColumns(next);
    // Commit the preference before applying it; a failed write leaves the dialog draft intact.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    setColumns(normalized);
  };
  return { columns, saveColumns };
}
