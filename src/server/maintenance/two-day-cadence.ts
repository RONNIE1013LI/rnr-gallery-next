const UTC_DAY_MS = 24 * 60 * 60 * 1_000;
const CADENCE_ANCHOR_UTC_DAY = Math.floor(Date.UTC(2026, 8, 1) / UTC_DAY_MS);

export function shouldRunTwoDayMaintenance(now: Date): boolean {
  const utcDay = Math.floor(now.getTime() / UTC_DAY_MS);
  const daysSinceAnchor = utcDay - CADENCE_ANCHOR_UTC_DAY;
  return ((daysSinceAnchor % 2) + 2) % 2 === 0;
}
