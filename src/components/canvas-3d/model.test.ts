import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createCanvasModel } from "./model";
import { getCanvasProfile } from "./profiles";

describe("wrapped canvas geometry",()=>{
  it.each(["a0","a4"])("extends only the outer artwork edge across %s side depth",size=>{
    for(const orientation of ["landscape","portrait"] as const){
      const profile=getCanvasProfile(size,orientation)!;
      const art=new THREE.Texture({width:profile.width*10000,height:profile.height*10000} as HTMLImageElement);
      const {root}=createCanvasModel(profile,art,new THREE.Texture());
      const shell=root.getObjectByName("Wrapped canvas shell") as THREE.Mesh;
      const {normal,uv}=shell.geometry.attributes;
      let checked=0;
      for(let i=0;i<normal.count;i++){
        if(Math.abs(normal.getX(i))>.99999){expect(uv.getX(i)).toBeCloseTo(normal.getX(i)>0?1:0,5);checked++;}
        if(Math.abs(normal.getY(i))>.99999){expect(uv.getY(i)).toBeCloseTo(normal.getY(i)>0?1:0,5);checked++;}
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it("uses edge-only sampling for every rear printed surface",()=>{
    const art=new THREE.Texture({width:1190,height:840} as HTMLImageElement);
    const {root}=createCanvasModel(getCanvasProfile("a0")!,art,new THREE.Texture());
    const shell=root.getObjectByName("Wrapped canvas shell") as THREE.Mesh;
    const front=(shell.material as THREE.Material[])[0];
    const rear=root.children.filter(object=>/printed return|Overlapping rear corner|Continuous rear wrap shoulder/.test(object.name)) as THREE.Mesh[];
    expect(rear).toHaveLength(9);
    for(const mesh of rear){
      expect(mesh.material).not.toBe(front);
      const material=mesh.material as THREE.MeshPhysicalMaterial;
      const shader={fragmentShader:"#include <map_fragment>"};
      material.onBeforeCompile(shader as never,{} as never);
      expect(shader.fragmentShader).toContain("edgeUV");
      expect(material.map!.generateMipmaps).toBe(false);
    }
  });

  it("joins the printed face and sides with rounded normals while leaving the back open",()=>{
    const art=new THREE.Texture({width:1190,height:840} as HTMLImageElement);
    const {root}=createCanvasModel(getCanvasProfile("a0")!,art,new THREE.Texture());
    const shell=root.getObjectByName("Wrapped canvas shell") as THREE.Mesh;
    expect(shell).toBeDefined();
    expect(shell.geometry.type).toBe("RoundedBoxGeometry");
    expect(shell.geometry.groups.some(group=>group.materialIndex===5)).toBe(false);
    shell.geometry.computeBoundingBox();
    const extent=shell.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(extent.x).toBeCloseTo(1.19,5);expect(extent.y).toBeCloseTo(.84,5);expect(extent.z).toBeCloseTo(.03,5);
    const position=shell.geometry.attributes.position,uv=shell.geometry.attributes.uv;
    const shared=new Map<string,[number,number]>();
    for(let i=0;i<position.count;i++){
      const key=[position.getX(i),position.getY(i),position.getZ(i)].map(v=>v.toFixed(6)).join(":");
      const prior=shared.get(key);
      if(prior){expect(uv.getX(i)).toBeCloseTo(prior[0],5);expect(uv.getY(i)).toBeCloseTo(prior[1],5);}
      else shared.set(key,[uv.getX(i),uv.getY(i)]);
    }
    const normals=shell.geometry.attributes.normal;
    expect(Array.from({length:normals.count},(_,i)=>Math.abs(normals.getX(i))>.1&&Math.abs(normals.getZ(i))>.1).some(Boolean)).toBe(true);
  });
  it("seals every exposed rear shoulder edge while keeping the back centre open",()=>{
    const {root}=createCanvasModel(getCanvasProfile("a0")!,new THREE.Texture({width:1190,height:840} as HTMLImageElement),new THREE.Texture());
    const shell=(root.getObjectByName("Wrapped canvas shell") as THREE.Mesh).geometry;
    const bridge=(root.getObjectByName("Continuous rear wrap shoulder") as THREE.Mesh).geometry;
    const key=(p:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(6)).join(":");
    const edges=new Map<string,{count:number;ends:string[]}>();
    const p=shell.attributes.position,b=bridge.attributes.position;
    for(const group of shell.groups)for(let i=group.start;i<group.start+group.count;i+=3)for(const [a,c] of [[0,1],[1,2],[2,0]]){
      const ends=[key(p,i+a),key(p,i+c)].sort(),id=ends.join("|");
      const current=edges.get(id);edges.set(id,{count:(current?.count??0)+1,ends});
    }
    const vertices=new Set(Array.from({length:b.count},(_,i)=>key(b,i)));
    const boundary=[...edges.values()].filter(edge=>edge.count===1);
    expect(boundary.length).toBeGreaterThan(0);
    for(const edge of boundary)for(const point of edge.ends)expect(vertices.has(point)).toBe(true);
    for(let i=0;i<b.count;i+=3){
      const cx=(b.getX(i)+b.getX(i+1)+b.getX(i+2))/3,cy=(b.getY(i)+b.getY(i+1)+b.getY(i+2))/3;
      expect(Math.abs(cx)>=1.19/2-.018-.000001||Math.abs(cy)>=.84/2-.018-.000001).toBe(true);
    }
  });
  it.each(["a0","a1"])("seats %s brace ends inside the rail opening",size=>{
    for(const orientation of ["landscape","portrait"] as const){
      const profile=getCanvasProfile(size,orientation)!;
      const {root}=createCanvasModel(profile,new THREE.Texture({width:1190,height:840} as HTMLImageElement),new THREE.Texture());
      root.updateMatrixWorld(true);
      const braces=root.children.filter(object=>/brace/i.test(object.name));
      const bounds=new THREE.Box3();braces.forEach(object=>bounds.union(new THREE.Box3().setFromObject(object)));
      const innerX=profile.width/2-profile.railWidth+.002,innerY=profile.height/2-profile.railWidth+.002;
      if(size==="a0"||profile.width<profile.height){expect(bounds.min.x).toBeLessThan(-innerX);expect(bounds.max.x).toBeGreaterThan(innerX);}
      if(size==="a0"||profile.width>=profile.height){expect(bounds.min.y).toBeLessThan(-innerY);expect(bounds.max.y).toBeGreaterThan(innerY);}
      expect(bounds.min.z).toBeCloseTo(-profile.depth/2,6);
    }
  });
  it.each([['a0',true],['a1',true],['a2',false],['a3',false],['a4',false]] as const)("creates real supports for %s only when required",(size,hasSupports)=>{
    const {root}=createCanvasModel(getCanvasProfile(size)!,new THREE.Texture({width:1190,height:840} as HTMLImageElement),new THREE.Texture());
    expect(root.children.some(object=>/brace/i.test(object.name))).toBe(hasSupports);
    const corners=root.children.filter(object=>object.name==="Overlapping rear corner") as THREE.Mesh[];
    expect(corners).toHaveLength(4);
    const rail=root.getObjectByName("Top rail") as THREE.Mesh;
    expect(rail.geometry.userData.innerDepth).toBe(.02);
    const pos=rail.geometry.attributes.position;
    const front=Array.from({length:pos.count},(_,i)=>pos.getZ(i)).filter(z=>z>0);
    expect(Math.max(...front)-Math.min(...front)).toBeCloseTo(.0094,6);
    expect(root.children.filter(object=>object.name==="Mortise recess floor")).toHaveLength(4);
    expect(root.children.filter(object=>object.name==="45-degree timber joint")).toHaveLength(4);
    expect((root.getObjectByName("Top rail") as THREE.Mesh).geometry.type).toBe("ExtrudeGeometry");
    expect(root.children.filter(object=>object.name==="Rear tucked fold")).toHaveLength(4);
    for(const corner of corners){
      const z=Array.from(corner.geometry.attributes.position.array).filter((_,i)=>i%3===2);
      expect(Math.max(...z)-Math.min(...z)).toBeGreaterThan(.0004);
      expect((corner.material as THREE.MeshPhysicalMaterial).map).toBeDefined();
    }
  });
});
