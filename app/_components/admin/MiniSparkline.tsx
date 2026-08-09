"use client";

/**
 * A minimal inline SVG sparkline for the admin dashboard's mcap history —
 * deliberately not a charting library. This renders a handful of points for
 * a quick "trending up or flat" read during review, nothing interactive.
 */
export default function MiniSparkline({
  points,
  width = 120,
  height = 32,
}: {
  points: { mcapUsd18: string; sampledAt: string }[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-[9px] text-[var(--ink-faint)]"
      >
        Not enough data
      </div>
    );
  }

  const values = points.map((p) => Number(p.mcapUsd18) / 1e18);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 4) + 2;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const trendingUp = values[values.length - 1] >= values[0];

  return (
    <svg width={width} height={height} className="shrink-0">
      <path
        d={path}
        fill="none"
        stroke={trendingUp ? "#a3e635" : "#f87171"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
