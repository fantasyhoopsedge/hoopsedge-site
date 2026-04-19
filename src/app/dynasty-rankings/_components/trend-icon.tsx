export function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") {
    return (
      <span className="dr-trend-up" aria-label="Trend up">
        ↑
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span className="dr-trend-down" aria-label="Trend down">
        ↓
      </span>
    );
  }
  return (
    <span className="dr-trend-flat" aria-label="Trend flat">
      —
    </span>
  );
}
