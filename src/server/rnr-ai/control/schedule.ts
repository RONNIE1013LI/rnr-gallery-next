import type { AiControlSnapshot } from "../runtime-store/reply-runtime-store";

export type EffectiveAiControl = Readonly<{
  effectiveState: "ON" | "OFF";
  source: "master_kill" | "override" | "mode" | "schedule" | "invalid";
  nextTransitionAt: string | null;
}>;

const dayByName: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function minute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minutes = Number(match[2]);
  return hour < 24 && minutes < 60 ? hour * 60 + minutes : null;
}

function localClock(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = dayByName[values.weekday];
  const hour = Number(values.hour);
  const minutes = Number(values.minute);
  if (day === undefined || !Number.isInteger(hour) || !Number.isInteger(minutes)) return null;
  return { day, minute: hour * 60 + minutes };
}

function scheduleState(snapshot: AiControlSnapshot, date: Date) {
  const local = localClock(date);
  if (!local || snapshot.config.timezone !== "Pacific/Auckland" || !snapshot.config.periods.length) {
    return { valid: false, on: false };
  }
  let on = false;
  for (const period of snapshot.config.periods) {
    const start = minute(period.start);
    const end = minute(period.end);
    if (start === null || end === null || start === end || period.day < 0 || period.day > 6) {
      return { valid: false, on: false };
    }
    if (start < end) {
      if (local.day === period.day && local.minute >= start && local.minute < end) on = true;
    } else if (
      (local.day === period.day && local.minute >= start)
      || (local.day === (period.day + 1) % 7 && local.minute < end)
    ) {
      on = true;
    }
  }
  return { valid: true, on };
}

function nextScheduleTransition(snapshot: AiControlSnapshot, now: Date, current: boolean) {
  const rounded = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let offset = 1; offset <= 8 * 24 * 60; offset += 1) {
    const candidate = new Date(rounded + offset * 60_000);
    const state = scheduleState(snapshot, candidate);
    if (!state.valid) return null;
    if (state.on !== current) return candidate.toISOString();
  }
  return null;
}

export function evaluateAiControl(
  snapshot: AiControlSnapshot,
  now: Date,
  masterEnabled: boolean,
): EffectiveAiControl {
  if (!masterEnabled) return { effectiveState: "OFF", source: "master_kill", nextTransitionAt: null };
  if (!Number.isFinite(now.getTime())) return { effectiveState: "OFF", source: "invalid", nextTransitionAt: null };

  const override = snapshot.config.override;
  if (override) {
    const expiresAt = Date.parse(override.expiresAt);
    if (!Number.isFinite(expiresAt)) return { effectiveState: "OFF", source: "invalid", nextTransitionAt: null };
    if (expiresAt > now.getTime()) {
      return { effectiveState: override.state, source: "override", nextTransitionAt: new Date(expiresAt).toISOString() };
    }
  }

  if (snapshot.config.mode === "ON" || snapshot.config.mode === "OFF") {
    return { effectiveState: snapshot.config.mode, source: "mode", nextTransitionAt: null };
  }
  if (snapshot.config.mode !== "SCHEDULE") {
    return { effectiveState: "OFF", source: "invalid", nextTransitionAt: null };
  }

  const state = scheduleState(snapshot, now);
  if (!state.valid) return { effectiveState: "OFF", source: "invalid", nextTransitionAt: null };
  return {
    effectiveState: state.on ? "ON" : "OFF",
    source: "schedule",
    nextTransitionAt: nextScheduleTransition(snapshot, now, state.on),
  };
}
