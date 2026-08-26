type UsageMetricCardProps = {
  detail: string;
  label: string;
  value: string;
};

export function UsageMetricCard({ detail, label, value }: UsageMetricCardProps) {
  return (
    <article className="settings-usage-metric">
      <div className="settings-usage-metric__heading">
        <span>{label}</span>
        <small>{detail}</small>
      </div>
      <strong>{value}</strong>
    </article>
  );
}
