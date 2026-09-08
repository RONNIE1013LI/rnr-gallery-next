import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFabricBannerModel } from './model';
describe('fabric banner model', () => {
 it.each([[1.6,.8],[2,1],[3,1.5]])('keeps wall artwork at %s x %s metres', (w,h) => {
  const texture = new THREE.Texture(); const model=createFabricBannerModel('wall',w,h,texture);
  const front=model.getObjectByName('artwork-front') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>;
  const size=new THREE.Box3().setFromObject(front).getSize(new THREE.Vector3());
  expect(size.x).toBeCloseTo(w); expect(size.y).toBeCloseTo(h); expect(front.material.map).toBe(texture);
  const back=model.getObjectByName('plain-back') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  expect(back.material.map).toBeNull();
  expect(model.userData.eyelets).toBe(4);
  expect(model.getObjectByName("eyelet-4")).toBeUndefined();
 });
 it('lays the grave artwork horizontally at 100 x 200 cm with six eyelets',()=>{
  const model=createFabricBannerModel('grave',1,2); model.updateMatrixWorld(true);
  const front=model.getObjectByName('artwork-front')!;
  const size=new THREE.Box3().setFromObject(front).getSize(new THREE.Vector3());
  expect(size.x).toBeCloseTo(1); expect(size.z).toBeCloseTo(2); expect(size.y).toBeCloseTo(0);
  expect(model.userData.eyelets).toBe(6);
  for (const [index, x] of [[4, -.475], [5, .475]]) {
    const eyelet = model.getObjectByName(`eyelet-${index}`)!;
    const position = eyelet.getWorldPosition(new THREE.Vector3());
    expect(position.x).toBeCloseTo(x); expect(position.z).toBeCloseTo(0);
  }
  expect(model.getObjectByName('eyelet-6')).toBeUndefined();
  expect(model.getObjectByName('eyelet-3')).toBeDefined(); expect(model.getObjectByName('corner-cord-0')).toBeUndefined();
 });
});
