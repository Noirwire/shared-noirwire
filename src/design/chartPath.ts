export type ChartPaths = { line: string; area: string };

/**
 * A series of values as an SVG line across the box, and the same line closed
 * down to the baseline for the fill beneath it. Fewer than two points draw
 * nothing: one value has no direction to show.
 */
export function chartPaths(
  points: number[],
  width: number,
  height: number,
  pad: number,
): ChartPaths | null {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const line = points
    .map((value, index) => {
      const x = pad + index * stepX;
      const y = pad + (height - pad * 2) * (1 - (value - min) / span);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return { line, area: `${line} L${width - pad} ${height} L${pad} ${height} Z` };
}
