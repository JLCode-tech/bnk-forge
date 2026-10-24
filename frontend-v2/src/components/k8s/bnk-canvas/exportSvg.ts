/**
 * Topology Canvas — standalone SVG export.
 *
 * Forge addition (not in Gateway Atlas, whose export rasterises the DOM). The
 * SVG is drawn from the computed layout, so it covers the whole graph whatever
 * the viewport, needs no extra dependency and stays editable as vectors.
 * Colours arrive resolved (no CSS variables), so the file renders anywhere.
 */

export type SvgCard = {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: string;
  name: string;
  fact?: string;
  accent: string;
  fill: string;
  text: string;
  muted: string;
  dashed?: boolean;
};
export type SvgFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};
export type SvgEdge = {
  path: string;
  color: string;
  width: number;
  dash?: string;
  opacity?: number;
  label: string[];
  labelAt?: { x: number; y: number };
};
export type SvgTheme = {
  background: string;
  frameFill: string;
  frameStroke: string;
  frameText: string;
  labelFill: string;
  labelText: string;
  labelStroke: string;
};

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );

// Computed colours from color-mix() come back as `color(srgb r g b / a)`,
// which most SVG viewers and editors cannot read; write them as rgb()/rgba().
export function svgColor(color: string): string {
  const match = color
    .trim()
    .match(
      /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+%?))?\s*\)$/i,
    );
  if (!match) return color;
  const [r, g, b] = match
    .slice(1, 4)
    .map((value) => Math.round(Math.min(1, Math.max(0, Number(value))) * 255));
  const alpha = match[4]
    ? match[4].endsWith("%")
      ? Number(match[4].slice(0, -1)) / 100
      : Number(match[4])
    : 1;
  return alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`
    : `rgb(${r}, ${g}, ${b})`;
}

// Card text has no CSS ellipsis in SVG; trim to the card width instead.
export function fitText(value: string, width: number, charWidth: number) {
  const room = Math.max(1, Math.floor(width / charWidth));
  return value.length <= room ? value : `${value.slice(0, room - 1)}…`;
}

const round = (value: number) => Math.round(value * 10) / 10;
const paint = (color: string) => escapeXml(svgColor(color));
const lineHeight = 12.5;

export function buildCanvasSvg({
  frames,
  cards,
  edges,
  theme,
  title,
  padding = 24,
}: {
  frames: SvgFrame[];
  cards: SvgCard[];
  edges: SvgEdge[];
  theme: SvgTheme;
  title: string;
  padding?: number;
}): string {
  const boxes = [...frames, ...cards];
  const edge = (values: number[], pick: (...v: number[]) => number) =>
    values.length ? pick(...values) : 0;
  const left =
    edge(
      boxes.map((box) => box.x),
      Math.min,
    ) - padding;
  const top =
    edge(
      boxes.map((box) => box.y),
      Math.min,
    ) - padding;
  const right =
    edge(
      boxes.map((box) => box.x + box.width),
      Math.max,
    ) + padding;
  const bottom =
    edge(
      boxes.map((box) => box.y + box.height),
      Math.max,
    ) + padding;
  const width = round(right - left);
  const height = round(bottom - top);

  const colors = [...new Set(edges.map((edge) => edge.color))];
  const marker = (color: string) => `arrow-${colors.indexOf(color)}`;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${round(left)} ${round(top)} ${width} ${height}" font-family="Inter, ui-sans-serif, system-ui, sans-serif">`,
    `<title>${escapeXml(title)}</title>`,
    "<defs>",
    ...colors.map(
      (color) =>
        `<marker id="${marker(color)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${paint(color)}"/></marker>`,
    ),
    "</defs>",
    `<rect x="${round(left)}" y="${round(top)}" width="${width}" height="${height}" fill="${paint(theme.background)}"/>`,
  ];

  for (const frame of frames)
    out.push(
      `<g><rect x="${round(frame.x)}" y="${round(frame.y)}" width="${round(frame.width)}" height="${round(frame.height)}" rx="10" fill="${paint(theme.frameFill)}" stroke="${paint(theme.frameStroke)}" stroke-dasharray="4 3"/>` +
        `<text x="${round(frame.x + 14)}" y="${round(frame.y + 20)}" font-size="11" font-weight="700" letter-spacing="0.6" fill="${paint(theme.frameText)}">${escapeXml(frame.label.toUpperCase())}</text></g>`,
    );

  for (const edge of edges)
    out.push(
      `<path d="${escapeXml(edge.path)}" fill="none" stroke="${paint(edge.color)}" stroke-width="${edge.width}"${edge.dash ? ` stroke-dasharray="${escapeXml(edge.dash)}"` : ""}${edge.opacity !== undefined && edge.opacity < 1 ? ` opacity="${edge.opacity}"` : ""} marker-end="url(#${marker(edge.color)})"/>`,
    );

  for (const card of cards) {
    const textWidth = card.width - 20;
    out.push(
      `<g><rect x="${round(card.x)}" y="${round(card.y)}" width="${card.width}" height="${card.height}" rx="6" fill="${paint(card.fill)}" stroke="${paint(card.accent)}" stroke-width="2"${card.dashed ? ' stroke-dasharray="5 3"' : ""}/>` +
        `<text x="${round(card.x + 10)}" y="${round(card.y + 19)}" font-size="10" font-weight="700" fill="${paint(card.accent)}">${escapeXml(fitText(card.kind, textWidth, 6.2))}</text>` +
        `<text x="${round(card.x + 10)}" y="${round(card.y + 36)}" font-size="13" font-weight="600" fill="${paint(card.text)}">${escapeXml(fitText(card.name, textWidth, 7.4))}</text>` +
        (card.fact
          ? `<text x="${round(card.x + 10)}" y="${round(card.y + 51)}" font-size="10" fill="${paint(card.muted)}">${escapeXml(fitText(card.fact, textWidth, 5.8))}</text>`
          : "") +
        "</g>",
    );
  }

  // Labels last so they sit above cards and lines, as on screen.
  for (const edge of edges) {
    if (!edge.label.length || !edge.labelAt) continue;
    const longest = Math.max(...edge.label.map((line) => line.length));
    const boxWidth = Math.min(210, longest * 6.1 + 12);
    const boxHeight = edge.label.length * lineHeight + 4;
    const x = edge.labelAt.x - boxWidth / 2;
    const y = edge.labelAt.y - boxHeight / 2;
    out.push(
      `<g><rect x="${round(x)}" y="${round(y)}" width="${round(boxWidth)}" height="${round(boxHeight)}" rx="4" fill="${paint(theme.labelFill)}" stroke="${paint(edge.color)}"/>` +
        edge.label
          .map(
            (line, index) =>
              `<text x="${round(edge.labelAt!.x)}" y="${round(y + 12 + index * lineHeight)}" text-anchor="middle" font-size="10" font-weight="700" fill="${paint(theme.labelText)}">${escapeXml(fitText(line, boxWidth - 8, 6.1))}</text>`,
          )
          .join("") +
        "</g>",
    );
  }
  out.push("</svg>");
  return out.join("\n");
}
