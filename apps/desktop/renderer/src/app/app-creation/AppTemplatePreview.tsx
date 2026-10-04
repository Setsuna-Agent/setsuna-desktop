export type AppTemplateKind = 'table' | 'form' | 'chart' | 'conversations' | 'custom';

export function AppTemplatePreview({ kind }: Readonly<{ kind: AppTemplateKind }>) {
  return <svg className="plugin-app-creation__preview" viewBox="0 0 176 116" fill="none"
    aria-hidden="true" focusable="false">
    <rect className="plugin-app-creation__preview-shadow" x="17" y="20" width="146" height="88" rx="9" />
    <rect className="plugin-app-creation__preview-window" x="12" y="12" width="152" height="92" rx="9" />
    <path className="plugin-app-creation__preview-rule" d="M12 32H164" />
    <g fill="currentColor" opacity=".35">
      <circle cx="23" cy="22" r="2" /><circle cx="30" cy="22" r="2" /><circle cx="37" cy="22" r="2" />
    </g>
    <rect x="121" y="20" width="30" height="4" rx="2" fill="currentColor" opacity=".14" />
    {kind === 'table' ? <TablePreview /> : null}
    {kind === 'form' ? <FormPreview /> : null}
    {kind === 'chart' ? <ChartPreview /> : null}
    {kind === 'conversations' ? <ConversationsPreview /> : null}
    {kind === 'custom' ? <CustomPreview /> : null}
  </svg>;
}

function TablePreview() {
  return <>
    <rect x="22" y="42" width="132" height="11" rx="3" fill="currentColor" opacity=".12" />
    <path className="plugin-app-creation__preview-rule" d="M22 66H154M22 80H154M63 42V94M112 42V94" />
    {[59, 73, 87].map((y, index) => <g key={y} fill="currentColor">
      <rect x="27" y={y} width={index === 1 ? 23 : 28} height="4" rx="2" opacity=".26" />
      <rect x="72" y={y} width={index === 2 ? 25 : 32} height="4" rx="2" opacity=".13" />
      <rect x="122" y={y - 2} width="23" height="8" rx="4" opacity={index === 1 ? .42 : .18} />
    </g>)}
  </>;
}

function FormPreview() {
  return <>
    <rect x="26" y="42" width="31" height="4" rx="2" fill="currentColor" opacity=".3" />
    <rect className="plugin-app-creation__preview-field" x="26" y="50" width="124" height="12" rx="3" />
    <rect x="33" y="55" width="49" height="3" rx="1.5" fill="currentColor" opacity=".14" />
    <rect x="26" y="68" width="8" height="8" rx="2" fill="currentColor" opacity=".6" />
    <path d="m28 72 1.5 1.5 2.5-3" stroke="var(--app-surface)" strokeWidth="1.2" />
    <rect x="40" y="70" width="41" height="4" rx="2" fill="currentColor" opacity=".23" />
    <rect className="plugin-app-creation__preview-field" x="96" y="68" width="8" height="8" rx="2" />
    <rect x="110" y="70" width="33" height="4" rx="2" fill="currentColor" opacity=".16" />
    <rect x="103" y="84" width="47" height="11" rx="4" fill="currentColor" opacity=".8" />
  </>;
}

function ChartPreview() {
  return <>
    <path className="plugin-app-creation__preview-rule" d="M24 54H99M24 73H99M24 92H99" />
    {[20, 30, 24, 43].map((height, index) => <rect key={index} x={29 + index * 17} y={92 - height}
      width="10" height={height} rx="3" fill="currentColor" opacity={.25 + index * .18} />)}
    <circle cx="133" cy="62" r="16" stroke="currentColor" strokeWidth="8" opacity=".14" />
    <circle cx="133" cy="62" r="16" stroke="currentColor" strokeWidth="8"
      strokeDasharray="64 101" transform="rotate(-90 133 62)" />
    <rect x="119" y="87" width="28" height="4" rx="2" fill="currentColor" opacity=".23" />
  </>;
}

function ConversationsPreview() {
  return <>
    <path className="plugin-app-creation__preview-rule" d="M64 32V104" />
    <rect x="19" y="42" width="38" height="14" rx="4" fill="currentColor" opacity=".14" />
    {[48, 68, 86].map((y, index) => <g key={y} fill="currentColor">
      <circle cx="27" cy={y + 1} r="3" opacity={index === 0 ? .7 : .2} />
      <rect x="34" y={y - 1} width="17" height="3" rx="1.5" opacity=".3" />
    </g>)}
    <rect x="99" y="43" width="54" height="15" rx="6" fill="currentColor" opacity=".15" />
    <rect x="110" y="49" width="32" height="3" rx="1.5" fill="currentColor" opacity=".45" />
    <circle cx="78" cy="71" r="4" fill="currentColor" opacity=".6" />
    <rect x="88" y="68" width="60" height="4" rx="2" fill="currentColor" opacity=".28" />
    <rect x="88" y="77" width="44" height="3" rx="1.5" fill="currentColor" opacity=".15" />
    <rect className="plugin-app-creation__preview-field" x="76" y="89" width="77" height="7" rx="3.5" />
  </>;
}

function CustomPreview() {
  return <>
    <rect x="24" y="43" width="128" height="49" rx="6" stroke="currentColor"
      strokeDasharray="4 4" opacity=".3" />
    <circle cx="88" cy="67" r="16" fill="currentColor" opacity=".1" />
    <path d="M88 59V75M80 67H96" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </>;
}
