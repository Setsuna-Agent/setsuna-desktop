import { Frame, Layers2, MousePointer2 } from 'lucide-react';
import './design-catalog-empty.css';

export function DesignCatalogEmpty({ title }: Readonly<{ title: string }>) {
  return <div className="design-catalog-empty">
    <div className="design-catalog-empty__art" aria-hidden="true">
      <span className="design-catalog-empty__sheet design-catalog-empty__sheet--back" />
      <span className="design-catalog-empty__sheet design-catalog-empty__sheet--front">
        <span className="design-catalog-empty__frame"><Frame size={28} strokeWidth={1.4} /></span>
      </span>
      <span className="design-catalog-empty__layers"><Layers2 size={18} strokeWidth={1.6} /></span>
      <MousePointer2 className="design-catalog-empty__cursor" size={24} strokeWidth={1.8} />
    </div>
    <h2>{title}</h2>
  </div>;
}
