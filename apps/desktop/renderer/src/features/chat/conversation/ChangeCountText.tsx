export function ChangeCountText({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="chat-change-counts" aria-label={`新增 ${additions} 行，删除 ${deletions} 行`}>
      <span className="chat-change-counts__add">+{additions}</span>
      <span className="chat-change-counts__del">-{deletions}</span>
    </span>
  );
}
