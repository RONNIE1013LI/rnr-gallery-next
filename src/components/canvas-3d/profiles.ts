import type { Orientation } from "@/domain/configuration/types";

// Customer measurements supplied 6 September 2026. Metres, width × height × depth.
const dimensions = {
  a0: [1.19, .84], a1: [.841, .594], a2: [.594, .42],
  a3: [.42, .297], a4: [.297, .21],
} as const;
export type CanvasProfile = {
  width: number; height: number; depth: number; railWidth: number;
  braceWidth: number; braceDepth: number; braces: "cross" | "single" | "none";
};
export function getCanvasProfile(size: string, orientation: Orientation = "landscape"): CanvasProfile | null {
  if (!Object.hasOwn(dimensions, size)) return null;
  const [long, short] = dimensions[size as keyof typeof dimensions];
  return {
    width: orientation === "portrait" ? short : long,
    height: orientation === "portrait" ? long : short,
    depth: .03, railWidth: .035, braceWidth: .04, braceDepth: .015,
    braces: size === "a0" ? "cross" : size === "a1" ? "single" : "none",
  };
}
