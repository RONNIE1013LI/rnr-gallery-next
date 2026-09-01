export const FOLLOW_LATEST_THRESHOLD_PX = 48;

type ScrollGeometry = Readonly<{
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}>;

export function isNearBottom(
  element: ScrollGeometry,
  threshold = FOLLOW_LATEST_THRESHOLD_PX,
) {
  const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
  return remaining <= Math.max(0, threshold);
}

export function scrollTranscriptToLatest(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTo">,
  behavior: ScrollBehavior,
) {
  element.scrollTo({ top: element.scrollHeight, behavior });
}
