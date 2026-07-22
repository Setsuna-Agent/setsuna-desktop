import type { LucideIcon } from 'lucide-react';

type UsageMetricCardProps = {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone: 'total' | 'input' | 'cache' | 'output' | 'calls';
  value: string;
};

export function UsageMetricCard({ detail, icon: Icon, label, tone, value }: UsageMetricCardProps) {
  return (
    <article className="settings-usage-metric" data-tone={tone}>
      <div className="settings-usage-metric__heading">
        <span className="settings-usage-metric__icon" aria-hidden="true">
          <Icon size={16} strokeWidth={1.8} />
        </span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
