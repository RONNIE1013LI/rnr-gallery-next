import * as THREE from "three";

// Metres. Print dimensions are supplied; hardware dimensions approximate the reference photos.
export const BANNER = { width: .85, height: 2, baseWidth: .89, baseDepth: .115, baseHeight: .082, footLength: .40 } as const;

export function createRollUpBannerModel(artwork?: THREE.Texture) {
  const root = new THREE.Group();
  root.name = "Roll-up banner 85 × 200 cm";
  const aluminum = new THREE.MeshStandardMaterial({ color: 0xc8cdd0, metalness: .85, roughness: .32 });
  const endMetal = new THREE.MeshStandardMaterial({ color: 0xc4c9cb, metalness: .7, roughness: .43 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33393c, roughness: .7 });
  const back = new THREE.MeshStandardMaterial({ color: 0x858b95, roughness: .88 });
  const front = new THREE.MeshBasicMaterial({ color: 0xffffff, map: artwork ?? null, toneMapped: false });
  function mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
    const part = new THREE.Mesh(geometry, material);
    part.name = name; part.position.set(x, y, z); part.castShadow = true; part.receiveShadow = true;
    root.add(part); return part;
  }
  function box(name: string, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
    return mesh(name, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  }
  function rod(name: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, material = aluminum) {
    const delta = b.clone().sub(a);
    const part = mesh(name, new THREE.CylinderGeometry(radius, radius, delta.length(), 20), material);
    part.position.copy(a).add(b).multiplyScalar(.5);
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return part;
  }
  // Each side has its own outward-facing plane: the rear can never mirror the print.
  mesh("Printed face", new THREE.PlaneGeometry(BANNER.width, BANNER.height), front, 0, 0, .025);
  const rear = mesh("Opaque grey backing", new THREE.PlaneGeometry(BANNER.width, BANNER.height), back, 0, 0, .0242);
  rear.rotation.y = Math.PI;

  // X extrusion; profile coordinates are -Z and Y. The rear recess is real geometry.
  function extrudeProfile(shape: THREE.Shape, width: number) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 16 });
    g.translate(0, 0, -width / 2); g.rotateY(Math.PI / 2); return g;
  }
  function cassetteProfile(recess: boolean) {
    const s = new THREE.Shape(), d = BANNER.baseDepth / 2, h = BANNER.baseHeight / 2;
    s.moveTo(-d, -.024); s.quadraticCurveTo(-d, -.034, -.049, -.034);
    s.lineTo(-.036, -.034); s.quadraticCurveTo(-.027, -.034, -.027, -h);
    s.lineTo(-.023, -h); s.lineTo(-.023, -h + .004);
    s.lineTo(.023, -h + .004); s.lineTo(.023, -h); s.lineTo(.027, -h);
    s.quadraticCurveTo(.027, -.034, .036, -.034); s.lineTo(.049, -.034);
    s.quadraticCurveTo(d, -.034, d, -.026);
    if (recess) {
      s.lineTo(d, -.026); s.quadraticCurveTo(d, -.022, d - .006, -.022);
      s.lineTo(.026, -.022); s.quadraticCurveTo(.022, -.022, .022, -.018);
      s.lineTo(.022, .009); s.quadraticCurveTo(.022, .013, .026, .013);
      s.lineTo(d - .005, .013); s.quadraticCurveTo(d, .013, d, .019);
    }
    s.lineTo(d, .019);
    s.bezierCurveTo(d, .038, .039, .043, 0, .044);
    s.bezierCurveTo(-.039, .043, -d, .038, -d, .019);
    s.lineTo(-d, -.024);
    return s;
  }
  mesh("Aluminium cassette", extrudeProfile(cassetteProfile(true), BANNER.baseWidth), aluminum, 0, -1.037, -.012);
  for (const sign of [-1, 1]) {
    const cap = new THREE.Shape();
    // Two relieved bottom shoulders leave the central tab visible in the side photograph.
    // Use the outline instead of overlapping masks for the relieved bottom edge.
    cap.moveTo(-.0575, -.017);
    cap.bezierCurveTo(-.0585, .005, -.058, .022, -.048, .032);
    cap.bezierCurveTo(-.038, .042, -.018, .044, 0, .044);
    cap.bezierCurveTo(.024, .044, .046, .040, .053, .029);
    cap.bezierCurveTo(.059, .018, .059, -.006, .056, -.024);
    cap.quadraticCurveTo(.054, -.034, .049, -.034); cap.lineTo(.036, -.034);
    cap.quadraticCurveTo(.027, -.034, .027, -.041); cap.lineTo(-.027, -.041);
    cap.quadraticCurveTo(-.027, -.034, -.036, -.034); cap.lineTo(-.049, -.034);
    cap.quadraticCurveTo(-.054, -.034, -.0575, -.017);
    const hole = new THREE.Path(); hole.absarc(0, -.008, .0027, 0, Math.PI * 2, true); cap.holes.push(hole);
    mesh(`End cap ${sign}`, extrudeProfile(cap, .003), endMetal, sign * .446, -1.037, -.012);
    const screwPositions = [[.031, -.029], [.031, .029], [.015, .044], [-.026, -.033], [-.026, .033]];
    for (const [y, z] of screwPositions) {
      const screw = mesh(`End screw ${sign} ${y} ${z}`, new THREE.CylinderGeometry(.0038, .0038, .0015, 20), aluminum, sign * .448, -1.037 + y, -.012 + z);
      screw.rotation.z = Math.PI / 2;
      box("Screw cross horizontal", .0005, .0006, .004, dark, sign * .449, -1.037 + y, -.012 + z);
      box("Screw cross vertical", .0005, .004, .0006, dark, sign * .449, -1.037 + y, -.012 + z);
    }
    const axle = mesh(`Central axle ${sign}`, new THREE.CylinderGeometry(.0034, .0034, .005, 20), aluminum, sign * .450, -1.033, -.012);
    axle.rotation.z = Math.PI / 2;
    const holeInterior = mesh(`Axle access hole ${sign}`, new THREE.CircleGeometry(.0026, 20), dark, sign * .4476, -1.045, -.012);
    holeInterior.rotation.y = sign * Math.PI / 2;
    const footShape = new THREE.Shape();
    const r = .023, half = BANNER.footLength / 2 - r - .0007;
    footShape.moveTo(-r, -half); footShape.lineTo(-r, half);
    footShape.absarc(0, half, r, Math.PI, 0, true);
    footShape.lineTo(r, -half); footShape.absarc(0, -half, r, 0, -Math.PI, true);
    const footGeometry = new THREE.ExtrudeGeometry(footShape, { depth: .0035, bevelEnabled: true, bevelSize: .0007, bevelThickness: .0005, bevelSegments: 2, curveSegments: 12 });
    footGeometry.rotateX(-Math.PI / 2);
    footGeometry.computeBoundingBox();
    const footDepth = footGeometry.boundingBox!.max.z - footGeometry.boundingBox!.min.z;
    footGeometry.scale(1, 1, BANNER.footLength / footDepth);
    mesh(`Swivel foot ${sign}`, footGeometry, endMetal, sign * .235, -1.081, -.012);
    // The underside is an open channel, with two continuous turned-down edges.
    for (const side of [-1, 1]) {
      box(`Foot underside rail ${sign} ${side}`, .0032, .005, .372, aluminum, sign * .235 + side * .019, -1.083, -.012);
    }
    const washer = mesh(`Foot pivot washer ${sign}`, new THREE.CylinderGeometry(.0065, .0065, .001, 24), endMetal, sign * .235, -1.082, -.012);
    washer.userData.attachment = "foot-to-cassette";
    mesh(`Foot pivot rivet ${sign}`, new THREE.CylinderGeometry(.0044, .0044, .002, 24), aluminum, sign * .235, -1.0833, -.012);
    mesh(`Foot pivot stem ${sign}`, new THREE.CylinderGeometry(.0025, .0025, .009, 20), aluminum, sign * .235, -1.077, -.012);
  }
  // Longitudinal bottom rails border the recessed central sheet visible from below.
  for (const side of [-1, 1]) {
    box(`Underside channel edge ${side}`, .88, .0012, .0018, endMetal, 0, -1.0755, -.012 + side * .023);
    box(`Underside outer rail ${side}`, .88, .002, .008, aluminum, 0, -1.0705, -.012 + side * .040);
  }
  for (const sign of [-1, 1]) {
    box(`Underside end retainer ${sign}`, .018, .002, .060, endMetal, sign * .427, -1.075, -.012);
  }
  box("Print exit slot", .853, .0015, .004, dark, 0, -.999, .025);
  // Continuous lip seams stay readable without sub-pixel cylinder aliasing at normal viewing distance.
  for (const y of [-1.022, -1.066]) {
    box("Front cassette lip", .882, .001, .001, endMetal, 0, y, .046);

  }
  box("Recess upper lip", .882, .0012, .002, endMetal, 0, -1.022, -.068);
  box("Recess lower lip", .882, .0012, .002, endMetal, 0, -1.060, -.067);
  box("Top clamping rail", .864, .023, .016, aluminum, 0, 1.009, .020);
  box("Top rail seam", .85, .001, .0005, endMetal, 0, 1.002, .0284);
  for (const sign of [-1, 1]) box("Top rail end plug", .003, .023, .016, endMetal, sign * .433, 1.009, .020);
  const poleBottom = new THREE.Vector3(0, -1.065, -.049);
  const poleTop = new THREE.Vector3(0, 1.047, -.002);
  rod("Rear support pole", poleBottom, poleTop, .0065);
  for (const t of [.33, .66]) {
    const a = poleBottom.clone().lerp(poleTop, t);
    rod("Pole joint collar", a, a.clone().add(new THREE.Vector3(0, .011, .00027)), .0072, endMetal);
  }
  rod("Pole socket", poleBottom.clone().add(new THREE.Vector3(0, -.01, 0)), poleBottom.clone().add(new THREE.Vector3(0, .018, 0)), .009, endMetal);
  // Bent flat spring strip: its crest meets the pole tip, and its return grips the rail.
  const hook = new THREE.Shape();
  hook.moveTo(.002, 1.045); hook.bezierCurveTo(-.002, 1.054, -.008, 1.050, -.010, 1.041);
  hook.lineTo(-.017, 1.025); hook.quadraticCurveTo(-.018, 1.021, -.012, 1.020);
  hook.lineTo(-.012, 1.021); hook.quadraticCurveTo(-.016, 1.022, -.016, 1.025);
  hook.lineTo(-.009, 1.041); hook.bezierCurveTo(-.007, 1.049, -.002, 1.052, .001, 1.045);
  hook.closePath();
  const clipMetal = new THREE.MeshStandardMaterial({ color: 0xc4baa0, metalness: .85, roughness: .28 });
  mesh("Top support hook", extrudeProfile(hook, .005), clipMetal);
  root.userData.printDimensions = [BANNER.width, BANNER.height];
  return root;
}
