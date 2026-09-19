export type ShowroomStop = "overview" | "welcome" | "banner" | "canvas" | "rollup";
export interface ShowroomController {
  go(stop: ShowroomStop): void;
  step(amount: number): void;
  dispose(): void;
  inspect(): Record<string, unknown>;
}
export interface ShowroomOptions {
  artworks: { banner: string; canvas: string; rollup: string };
  signal?: AbortSignal;
  materialReference?: string | false;
  fontFamily?: string;
  displayFont?: string;
  reducedMotion?: boolean;
  onReady?: () => void;
  onStop?: (stop: ShowroomStop) => void;
  onNavigate?: (destination: "shop" | "transformation") => void;
  onError?: (error: Error) => void;
}
export function createShowroom(canvas: HTMLCanvasElement, options: ShowroomOptions): Promise<ShowroomController>;
