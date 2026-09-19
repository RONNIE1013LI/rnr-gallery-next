/** Phones and touch-only tablets retain the original server-rendered flat hero. */
export const DESKTOP_SHOWROOM_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

/** Observe viewport AND input capability, including orientation and resizing. */
export function observeShowroomMode(onChange, match) {
  const matcher = match ?? window.matchMedia?.bind(window);
  if (!matcher) {
    onChange(false);
    return () => {};
  }
  const media = matcher(DESKTOP_SHOWROOM_QUERY);
  const update = () => onChange(media.matches);
  update();
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
