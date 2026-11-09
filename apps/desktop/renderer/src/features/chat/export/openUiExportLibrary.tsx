import type { ComponentRenderProps, ComponentRenderer, ElementNode, Library } from '@openuidev/react-lang';
import { useStateField } from '@openuidev/react-lang';
import {
  ScrollableTable, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@openuidev/react-ui';
import { presentationLibrary } from '../generative-ui/openUiLibrary.js';

/** A saved document must include rows and panels that normally require local navigation. */
export const openUiExportLibrary: Library = presentationLibrary.extend({
  components: { override: Object.entries({
    Table: ExportTable, Tabs: ExportSections, Accordion: ExportSections, Carousel: ExportCarousel, Modal: ExportModal,
  } satisfies Record<string, ComponentRenderer>).map(([name, component]) => ({
    ...presentationLibrary.components[name], component,
  })) },
});

function ExportTable({ props, renderNode }: ComponentRenderProps) {
  const columns = ((props.columns ?? []) as ElementNode[]).filter((column) => column?.props).map((column) => ({
    label: String(column.props.label ?? ''), data: asArray(column.props.data),
  }));
  const rowCount = columns.reduce((count, column) => Math.max(count, column.data.length), 0);
  return <ScrollableTable>
    <TableHeader><TableRow>{columns.map((column, index) => <TableHead key={index}>{column.label}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{Array.from({ length: rowCount }, (_, row) => <TableRow key={row}>
      {columns.map((column, index) => {
        const value = column.data[row];
        return <TableCell key={index}>{value && typeof value === 'object' ? renderNode(value) : String(value ?? '')}</TableCell>;
      })}
    </TableRow>)}</TableBody>
  </ScrollableTable>;
}

function ExportSections({ props, renderNode }: ComponentRenderProps) {
  return <div className="conversation-openui-sections">{((props.items ?? []) as ElementNode[]).map((item, index) => <section key={index}>
    <h3>{String(item.props?.trigger ?? '')}</h3>
    {renderNode(item.props?.content)}
  </section>)}</div>;
}

function ExportCarousel({ props, renderNode }: ComponentRenderProps) {
  return <div className="conversation-openui-sections">{asArray(props.children).map((item, index) => <section key={index}>
    {renderNode(item)}
  </section>)}</div>;
}

function ExportModal({ props, renderNode }: ComponentRenderProps) {
  const field = useStateField('open', props.open);
  if (field.value !== true && field.value !== 'true') return null;
  // Portals would escape the hidden export root and omit their contents from its snapshot.
  return <div className="conversation-openui-sections"><section>
    <h3>{String(props.title ?? '')}</h3>
    {renderNode(props.children)}
  </section></div>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}
