import * as THREE from "three";

export type FabricBannerKind = "wall" | "grave";
export type FabricBannerFinishing = Readonly<{
  eyeletInset?: number;
  cordRadius?: number;
  cordReachX?: number;
  cordReachY?: number;
  cordAnchorZ?: number;
}>;
/** Dimensions in metres; construction is indicative until physical finishing is confirmed. */
export function createFabricBannerModel(kind: FabricBannerKind, width: number, height: number, artwork?: THREE.Texture, finishing: FabricBannerFinishing = {}) {
  const root = new THREE.Group(); root.name = "fabric-banner";
  const sheet = new THREE.Group(); root.add(sheet);
  const inset = finishing.eyeletInset ?? .025, radius = .008;
  const cordRadius = finishing.cordRadius ?? .0018;
  if (!Number.isFinite(inset) || inset < radius + .005 || inset >= Math.min(width, height) / 2) throw new RangeError("Eyelet inset must leave fabric around the entire eyelet.");
  if (!Number.isFinite(cordRadius) || cordRadius <= 0 || cordRadius >= radius) throw new RangeError("Cord must fit through the eyelet.");
  const corners = [-1, 1].flatMap(x => [-1, 1].map(y => new THREE.Vector2(x * (width / 2 - inset), y * (height / 2 - inset))));
  const eyelets = kind === "grave"
    ? [...corners, new THREE.Vector2(-width / 2 + inset, 0), new THREE.Vector2(width / 2 - inset, 0)]
    : kind === "wall" && width === 3 && height === 1.5
      ? [...corners, new THREE.Vector2(0, -height / 2 + inset), new THREE.Vector2(0, height / 2 - inset)]
      : corners;
  const outline = new THREE.Shape();
  outline.moveTo(-width / 2, -height / 2); outline.lineTo(width / 2, -height / 2);
  outline.lineTo(width / 2, height / 2); outline.lineTo(-width / 2, height / 2); outline.closePath();
  for (const p of eyelets) { const hole = new THREE.Path(); hole.absarc(p.x, p.y, radius, 0, Math.PI * 2, true); outline.holes.push(hole); }
  const geometry = new THREE.ShapeGeometry(outline, 24);
  const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i) / width + .5, positions.getY(i) / height + .5);
  const front = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: artwork, color: artwork ? 0xffffff : 0xfaf7ef }));
  front.name = "artwork-front"; front.position.z = .001; sheet.add(front);
  const back = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xe8e5df, roughness: .95, side: THREE.BackSide }));
  back.name = "plain-back"; back.position.z = -.001; sheet.add(back);
  const silver = new THREE.MeshStandardMaterial({ color: 0xc7cbcc, metalness: .85, roughness: .29, side: THREE.DoubleSide });
  for (const [index, p] of eyelets.entries()) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + .0025, .0025, 10, 32), silver);
    ring.name = `eyelet-${index}`; ring.position.set(p.x, p.y, .002); sheet.add(ring);
    if (kind === "wall" && index < corners.length) {
      const end = new THREE.Vector3(p.x + Math.sign(p.x) * (finishing.cordReachX ?? .12), p.y + Math.sign(p.y) * (finishing.cordReachY ?? .085), finishing.cordAnchorZ ?? -.04);
      const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(p.x, p.y, .002), end), 1, cordRadius, 6, false), new THREE.MeshStandardMaterial({ color: 0xb8afa0, roughness: 1 }));
      rope.name = `corner-cord-${index}`; sheet.add(rope);
    }
  }
  // Fine inset seam indicates the reinforced border without covering the original artwork.
  const seam = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-width / 2 + .014, -height / 2 + .014, .0018), new THREE.Vector3(width / 2 - .014, -height / 2 + .014, .0018),
    new THREE.Vector3(width / 2 - .014, height / 2 - .014, .0018), new THREE.Vector3(-width / 2 + .014, height / 2 - .014, .0018),
  ]);
  sheet.add(new THREE.LineLoop(seam, new THREE.LineBasicMaterial({ color: 0x817b70, transparent: true, opacity: .22 })));
  if (kind === "grave") { sheet.rotation.x = -Math.PI / 2; sheet.position.y = .012; }
  root.userData = { kind, width, height, eyelets: eyelets.length, eyeletInset: inset, cordRadius };
  return root;
}
