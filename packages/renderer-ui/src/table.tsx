// Adapted from beUI Table (MIT): https://beui.dev/components/motion/table
// Paginated views render their supplied rows directly; the feature owns data loading.
import type { CSSProperties, ReactNode, TableHTMLAttributes } from 'react';
import { cn } from './utils.js';

export type TableColumn<T> = {
  key: string;
  header: ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: CSSProperties['width'];
  cell: (row: T) => ReactNode;
};

export type TableProps<T> = Pick<TableHTMLAttributes<HTMLTableElement>, 'aria-label' | 'aria-labelledby'> & {
  data: readonly T[];
  columns: readonly TableColumn<T>[];
  getRowId: (row: T) => string;
  loading?: boolean;
  emptyState?: ReactNode;
  className?: string;
};

export function Table<T>({
  data, columns, getRowId, loading = false, emptyState, className, ...props
}: TableProps<T>) {
  return (
    <div className={cn('sd-table', className)}>
      <div className="sd-table__scroller">
        <table {...props} aria-busy={loading} className="sd-table__content">
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" style={{ textAlign: column.align ?? 'left' }}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length ? data.map((row) => (
              <tr key={getRowId(row)} className="sd-table__row">
                {columns.map((column) => (
                  <td key={column.key} style={{ textAlign: column.align ?? 'left' }}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={columns.length} className="sd-table__empty">{emptyState}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
