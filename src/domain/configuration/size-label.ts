import type { Orientation } from "./types";

type SizeLike = Readonly<{ label: string }>;

const DIMENSIONS = /^(.*?)(\s+—\s+)?(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)\s*cm$/;

export function formatConfigurationSizeLabel(
  size: SizeLike,
  orientation?: Orientation,
): string {
  if (!orientation) return size.label;

  const match = size.label.match(DIMENSIONS);
  if (!match) return size.label;

  const [, prefix, divider = "", first, second] = match;
  const [width, height] = orientation === "portrait"
    ? [second, first]
    : [first, second];
  return `${prefix}${divider}${width} × ${height} cm`;
}
