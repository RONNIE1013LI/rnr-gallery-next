/** Scene metres. Composition matches the supplied compact showroom reference.
 * Product factories remain unchanged; display scaling is uniform in all axes.
 */
export const SHOWROOM_LAYOUT = Object.freeze({
  wallSurfaceZ: -3.215,
  wallMountGap: .008,
  overview: Object.freeze({targetY:1.70}),
  banner: Object.freeze({x:-1.40, y:2.10, width:3.7, focusOffsetX:-.58}),
  canvas: Object.freeze({x:1.99, y:2.13, displayWidth:2.18, width:1.20, height:.85, depth:.03, focusOffsetX:-.32}),
  rollup: Object.freeze({x:3.08, z:-.56, displayWidth:1.28, focusPadding:1.68}),
});
