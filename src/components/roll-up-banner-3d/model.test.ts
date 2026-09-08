import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createRollUpBannerModel } from "./model";
describe("roll-up banner construction", () => {
  it("has an 85 × 200 cm print with a separate opaque unprinted rear", () => {
    const texture = new THREE.Texture();
    const model = createRollUpBannerModel(texture);
    const front = model.getObjectByName("Printed face") as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
    const back = model.getObjectByName("Opaque grey backing") as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
    expect(front.geometry.parameters.width).toBe(.85); expect(front.geometry.parameters.height).toBe(2);
    expect(front.material.map).toBe(texture); expect(back.material.map).toBeNull();
    expect(back.material.transparent).toBe(false); expect(back.rotation.y).toBe(Math.PI);
    model.traverse(object => { if (object instanceof THREE.Mesh && object !== front) expect(object.material.map).not.toBe(texture); });
  });
  it("connects the print, feet, cassette and rear support rather than floating them", () => {
    const model = createRollUpBannerModel(); model.updateMatrixWorld(true);
    const bounds = (name: string) => new THREE.Box3().setFromObject(model.getObjectByName(name)!);
    const cassette = bounds("Aluminium cassette"), print = bounds("Printed face"), pole = bounds("Rear support pole"), clamp = bounds("Top clamping rail");
    expect(cassette.max.y).toBeGreaterThanOrEqual(print.min.y);
    expect(pole.min.y).toBeLessThan(cassette.max.y); expect(pole.max.y).toBeGreaterThan(clamp.min.y);
    for (const sign of [-1, 1]) {
      const foot = bounds(`Swivel foot ${sign}`);
      expect(foot.max.y).toBeGreaterThanOrEqual(cassette.min.y);
      expect(foot.min.z).toBeLessThan(cassette.min.z); expect(foot.max.z).toBeGreaterThan(cassette.max.z);
    }
    const whole = new THREE.Box3().setFromObject(model);
    expect(whole.getSize(new THREE.Vector3()).y).toBeLessThan(2.15);
  });
  it("measures each foot as 40 cm including its rounded and bevelled ends", () => {
    const model = createRollUpBannerModel();
    for (const sign of [-1, 1]) {
      const size = new THREE.Box3().setFromObject(model.getObjectByName(`Swivel foot ${sign}`)!).getSize(new THREE.Vector3());
      expect(size.z).toBeCloseTo(.40, 6);
    }
  });
  it("has a recessed rear channel and five fasteners on each end cap", () => {
    const model = createRollUpBannerModel(); model.updateMatrixWorld(true);
    const cassette = model.getObjectByName("Aluminium cassette")!;
    const ray = new THREE.Raycaster(new THREE.Vector3(.1, -1.04, -.2), new THREE.Vector3(0, 0, 1));
    const recessed = ray.intersectObject(cassette)[0].point.z;
    ray.set(new THREE.Vector3(.1, -1.065, -.2), new THREE.Vector3(0, 0, 1));
    const lip = ray.intersectObject(cassette)[0].point.z;
    expect(recessed - lip).toBeGreaterThan(.02);
    for (const sign of [-1, 1]) expect(model.children.filter(part => part.name.startsWith(`End screw ${sign} `))).toHaveLength(5);
    const hook = model.getObjectByName("Top support hook") as THREE.Mesh;
    expect(hook.geometry.type).toBe("ExtrudeGeometry");
    expect(new THREE.Box3().setFromObject(hook).getSize(new THREE.Vector3()).x).toBeCloseTo(.005);
  });

});
