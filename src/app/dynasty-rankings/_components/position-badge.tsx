import type { DynastyPosition } from "@/lib/dynasty-rankings";

export function PositionBadge({ position }: { position: DynastyPosition }) {
  if (position === "G/F") {
    return (
      <span className="dr-pos-split dr-pos-split-gf" aria-label="G/F">
        <span className="dr-pos-split-l">G</span>
        <span className="dr-pos-split-r">F</span>
      </span>
    );
  }
  if (position === "F/C") {
    return (
      <span className="dr-pos-split dr-pos-split-fc" aria-label="F/C">
        <span className="dr-pos-split-l">F</span>
        <span className="dr-pos-split-r">C</span>
      </span>
    );
  }
  const cls =
    position === "G" ? "dr-pos dr-pos-g" : position === "F" ? "dr-pos dr-pos-f" : "dr-pos dr-pos-c-single";
  return <span className={cls}>{position}</span>;
}
