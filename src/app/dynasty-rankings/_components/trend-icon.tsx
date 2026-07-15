export function TrendIcon({ trend, delta }: { trend: string; delta: number | null }) {
  if (trend === "up" && delta) {
    return (
      <span className="dr-trend-badge dr-trend-badge-up" aria-label={`Up ${delta} spots`}>
        ↑{delta}
      </span>
    );
  }
  if (trend === "down" && delta) {
    return (
      <span className="dr-trend-badge dr-trend-badge-down" aria-label={`Down ${delta} spots`}>
        ↓{delta}
      </span>
    );
  }
  return null;
}
