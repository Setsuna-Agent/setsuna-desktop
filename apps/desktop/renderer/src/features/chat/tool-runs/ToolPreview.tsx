export function ToolPreview({
  code = false,
  label,
  value,
}: Readonly<{ code?: boolean; label: string; value: string }>) {
  if (!value.trim()) return null;
  return (
    <div className="chat-tool-run__preview">
      <div className="chat-tool-run__preview-label">{label}</div>
      {code ? <pre>{value}</pre> : <p>{value}</p>}
    </div>
  );
}
