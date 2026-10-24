/**
 * Topology Canvas — skyline packing of namespace frames.
 *
 * Ported from Gateway Atlas (frontend/src/layoutPacking.ts), Apache-2.0,
 * Copyright 2026 Gateway Atlas contributors.
 */

export type PackBox = { id: string; width: number; height: number };

type Segment = { x: number; width: number; y: number };

// Bottom-left skyline packing for whole namespace components. Unlike row
// (shelf) packing, a short component can sit beneath a shorter neighbour
// instead of leaving the rest of a tall row empty. Boxes are placed in the
// given order, so callers keep control of what lands top-left.
export function skylinePack(
  boxes: PackBox[],
  targetWidth: number,
  gap: number,
): Map<string, { x: number; y: number }> {
  const width = Math.max(targetWidth, ...boxes.map((box) => box.width));
  let skyline: Segment[] = [{ x: 0, width: width + gap, y: 0 }];
  const placements = new Map<string, { x: number; y: number }>();
  for (const box of boxes) {
    const span = box.width + gap;
    let best: { x: number; y: number } | undefined;
    for (const segment of skyline) {
      const x = segment.x;
      if (x + box.width > width) continue;
      const y = Math.max(
        ...skyline
          .filter((item) => item.x < x + span && item.x + item.width > x)
          .map((item) => item.y),
      );
      if (!best || y < best.y || (y === best.y && x < best.x)) best = { x, y };
    }
    best ??= { x: 0, y: Math.max(...skyline.map((item) => item.y)) };
    placements.set(box.id, best);
    const top = best.y + box.height + gap;
    const start = best.x;
    const end = best.x + span;
    const next: Segment[] = [];
    for (const item of skyline) {
      const itemEnd = item.x + item.width;
      if (itemEnd <= start || item.x >= end) {
        next.push(item);
        continue;
      }
      if (item.x < start)
        next.push({ x: item.x, width: start - item.x, y: item.y });
      if (itemEnd > end) next.push({ x: end, width: itemEnd - end, y: item.y });
    }
    next.push({ x: start, width: Math.min(span, width + gap - start), y: top });
    skyline = next
      .sort((a, b) => a.x - b.x)
      .reduce<Segment[]>((merged, item) => {
        const last = merged[merged.length - 1];
        if (last && last.y === item.y && last.x + last.width === item.x)
          last.width += item.width;
        else merged.push({ ...item });
        return merged;
      }, []);
  }
  return placements;
}
