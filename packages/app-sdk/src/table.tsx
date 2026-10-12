import type { Key, ReactNode } from 'react';
import { Table as HostTable, type TableColumn as HostTableColumn } from '@setsuna-desktop/renderer-ui';

export type TableColumn<Row> = Readonly<Omit<HostTableColumn<Row>, 'cell'> & { render(row: Row): ReactNode }>;
export type TableProps<Row> = Readonly<{
  rows: readonly Row[]; columns: readonly TableColumn<Row>[]; getRowKey(row: Row): Key; caption?: ReactNode;
  loading?: boolean; emptyState?: ReactNode; className?: string;
}>;
export function Table<Row>({ rows, columns, getRowKey, ...props }: TableProps<Row>) {
  return <HostTable {...props} data={rows} columns={columns.map(({render, ...column}) => ({...column, cell:render}))}
    getRowId={row => String(getRowKey(row))} />;
}
