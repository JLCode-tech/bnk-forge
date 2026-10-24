/**
 * Topology Canvas — edge label sizing and placement.
 *
 * Ported from Gateway Atlas (frontend/src/edgeLabelPlacement.ts), Apache-2.0,
 * Copyright 2026 Gateway Atlas contributors.
 */

export type LabelRect = { x: number; y: number; width: number; height: number };

// Matches .bnk-canvas-edge-label: 10px bold text, 5px horizontal padding,
// 170px (210px stacked) max width.
export function estimateLabelSize(lines: string[]): {
  width: number;
  height: number;
} {
  const longest = Math.max(0, ...lines.map((line) => line.length));
  const stacked = lines.length > 1;
  return {
    width: Math.min(stacked ? 210 : 170, longest * 6.1 + (stacked ? 14 : 12)),
    height: lines.length * 12.5 + (stacked ? 8 + (lines.length - 1) * 4 : 4),
  };
}

// Cubic Bézier point for the `M sx,sy C c1 c2 t` path produced by getBezierPath.
function bezierPoint(
  path: string,
  t: number,
): { x: number; y: number } | undefined {
  const numbers = path.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number);
  if (!numbers || numbers.length < 8) return undefined;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = numbers;
  const u = 1 - t;
  return {
    x:
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
    y:
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
  };
}

const overlaps = (a: LabelRect, b: LabelRect, margin: number) =>
  a.x < b.x + b.width + margin &&
  b.x < a.x + a.width + margin &&
  a.y < b.y + b.height + margin &&
  b.y < a.y + a.height + margin;

// Midpoint first, then alternating positions toward either end; the first spot
// clear of every card wins.
const candidates = [
  0.5,
  ...Array.from({ length: 10 }, (_, index) => (index + 1) * 0.04).flatMap(
    (step) => [0.5 - step, 0.5 + step],
  ),
];

const overlapArea = (a: LabelRect, b: LabelRect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// When no spot is clear, the label goes where it covers the least card area,
// not back to the midpoint.
export function placeEdgeLabel(
  path: string,
  fallback: { x: number; y: number },
  size: { width: number; height: number },
  obstacles: LabelRect[],
  margin = 3,
): { x: number; y: number } {
  if (!obstacles.length) return fallback;
  let best = fallback;
  let bestArea = Infinity;
  for (const t of candidates) {
    const point = t === 0.5 ? fallback : bezierPoint(path, t);
    if (!point) return fallback;
    const rect = {
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
      width: size.width,
      height: size.height,
    };
    if (!obstacles.some((obstacle) => overlaps(rect, obstacle, margin)))
      return point;
    const area = obstacles.reduce(
      (sum, obstacle) => sum + overlapArea(rect, obstacle),
      0,
    );
    if (area < bestArea - 0.5) {
      best = point;
      bestArea = area;
    }
  }
  return best;
}

const labelLines = (label: string | undefined) =>
  String(label ?? "")
    .split("\n")
    .filter(Boolean);

// Horizontal room between two columns so the widest single-line label in a
// namespace fits beside the cards instead of on them. Stacked labels are placed
// in the row gap, so only their width matters here.
export function labelColumnGap(
  labels: (string | undefined)[],
  minimum: number,
): number {
  const widest = Math.max(
    0,
    ...labels.map((label) => {
      const lines = labelLines(label);
      return lines.length
        ? estimateLabelSize(collapseLabel(lines, false)).width
        : 0;
    }),
  );
  return Math.max(minimum, widest ? Math.ceil(widest) + 28 : 0);
}

// Long label lists stay readable without hiding facts: an unfocused label shows
// at most this many lines, ending with "+N more"; selecting either end shows
// every line. Layouts reserve room for the collapsed height.
export const collapsedLabelLines = 12;
export function collapseLabel(lines: string[], focused: boolean): string[] {
  if (focused || lines.length <= collapsedLabelLines) return lines;
  return [
    ...lines.slice(0, collapsedLabelLines - 1),
    `+${lines.length - collapsedLabelLines + 1} more · select to show all`,
  ];
}

// Vertical room two neighbouring labelled edges need so their (collapsed)
// labels do not overlap.
export function labelClearance(labels: (string | undefined)[]): number {
  const tallest = Math.max(
    0,
    ...labels.map((label) => {
      const lines = labelLines(label);
      return lines.length
        ? estimateLabelSize(collapseLabel(lines, false)).height
        : 0;
    }),
  );
  return tallest ? tallest + 12 : 0;
}
