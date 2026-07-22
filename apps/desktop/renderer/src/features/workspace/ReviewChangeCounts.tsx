export function ReviewChangeCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="desktop-review-change-counts">
      <span className="desktop-review-change-counts__addition">+{additions}</span>
      <span className="desktop-review-change-counts__deletion">-{deletions}</span>
    </span>
  );
}
