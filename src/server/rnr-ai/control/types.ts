export type AiControlConfig = Readonly<{
  revision: number;
  mode: "ON" | "OFF" | "SCHEDULE";
  timezone: "Pacific/Auckland";
  periods: readonly Readonly<{
    day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    start: string;
    end: string;
  }>[];
  override: null | Readonly<{
    state: "ON" | "OFF";
    expiresAt: string;
    actorUserId: string;
  }>;
}>;
