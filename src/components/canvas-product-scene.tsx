"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CanvasPreviewProps } from "./canvas-product-preview";
import { createCanvasModel } from "./canvas-3d/model";
import { getCanvasProfile } from "./canvas-3d/profiles";
import styles from "./canvas-product-preview.module.css";

type Actions = { view: (name:string)=>void; zoom:(factor:number)=>void; rotate:()=>boolean };
// A fresh mounted scene gives every selection its own lifetime and cleanup.
export default function CanvasProductScene(props:CanvasPreviewProps) {
  return <Scene key={`${props.imageSrc}:${props.sizeKey}:${props.orientation}`} {...props}/>;
}
function Scene({imageSrc,sizeKey,orientation}:CanvasPreviewProps) {
  const host=useRef<HTMLDivElement>(null),panel=useRef<HTMLDivElement>(null),actions=useRef<Actions|null>(null);
  const [status,setStatus]=useState("Loading 3D preview…"),[auto,setAuto]=useState(false);
  const [displayProfile,setDisplayProfile]=useState(()=>getCanvasProfile(sizeKey,orientation)!);
  useEffect(()=>{
    let profile=getCanvasProfile(sizeKey,orientation)!;
    const element=host.current;
    if(!element)return;
    let renderer:THREE.WebGLRenderer;
    try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:true}); }
    catch { queueMicrotask(()=>setStatus("3D is unavailable in this browser. Close 3D view to return to the artwork image.")); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    element.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.005,20);
    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;controls.dampingFactor=.1;controls.enablePan=false;
    controls.minPolarAngle=.12;controls.maxPolarAngle=Math.PI-.12;controls.autoRotateSpeed=.8;
    const frontLight=new THREE.DirectionalLight(0xffffff,1.3);frontLight.position.set(-2,3,4);scene.add(frontLight);
    let alive=true,visible=true,frame=0,lastTime=0,fit=2,renderCount=0;
    const textures=new Set<THREE.Texture>();
    const geometry=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    function invalidate(){if(alive&&visible&&!document.hidden&&!frame)frame=requestAnimationFrame(draw);}
    function draw(time:number){frame=0;if(!alive||!visible||document.hidden)return;controls.update(Math.min((time-lastTime)/1000,.05));lastTime=time;renderer.render(scene,camera);renderCount++;
      if(process.env.NODE_ENV!=="production"){element!.dataset.camera=JSON.stringify(camera.position.toArray());element!.dataset.frames=String(renderCount);}
      if(controls.autoRotate)invalidate();
    }
    controls.addEventListener("change",invalidate);
    scene.add(new THREE.HemisphereLight(0xffffff,0xb7b09c,2.2));
    const light=new THREE.DirectionalLight(0xfff6e5,1.5);light.position.set(-1,2,-3);light.castShadow=true;
    light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-1;light.shadow.camera.right=1;light.shadow.camera.top=1;light.shadow.camera.bottom=-1;light.shadow.camera.near=.1;light.shadow.camera.far=7;light.shadow.bias=-.00015;scene.add(light);
    function resize(){const {width,height}=element!.getBoundingClientRect();if(!width||!height)return;const prev=fit;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);
      fit=Math.max(profile.height/2,profile.width/2/camera.aspect)/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*1.35;
      controls.minDistance=.12;controls.maxDistance=fit*3;
      if(camera.position.length()>0)camera.position.multiplyScalar(fit/prev);controls.update();invalidate();
    }
    const observer=new ResizeObserver(resize);observer.observe(element);
    const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;invalidate();});intersection.observe(element);
    document.addEventListener("visibilitychange",invalidate);
    const lost=(event:Event)=>{event.preventDefault();if(alive)setStatus("3D paused. Close and reopen the 3D view to try again.");};
    renderer.domElement.addEventListener("webglcontextlost",lost);
    const load=async()=>{
      const loader=new THREE.TextureLoader();
      const result=await Promise.allSettled([loader.loadAsync(imageSrc),loader.loadAsync("/canvas-3d/material-reference.jpg")]);
      for(const value of result)if(value.status==="fulfilled")textures.add(value.value);
      if(!alive){textures.forEach(t=>t.dispose());return;}
      if(result.some(r=>r.status==="rejected")){setStatus("Could not load the 3D texture. Close and reopen to retry; close 3D view to return to the artwork image.");return;}
      const [artwork,reference]=result.map(r=>(r as PromiseFulfilledResult<THREE.Texture>).value);
      for(const t of [artwork,reference]){t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());}
      const image=artwork.image as HTMLImageElement;
      profile=getCanvasProfile(sizeKey,orientation??(image.width>=image.height?"landscape":"portrait"))!;
      setDisplayProfile(profile);
      const model=createCanvasModel(profile,artwork,reference);model.textures.forEach(t=>textures.add(t));scene.add(model.root);
      model.root.traverse(object=>{if(object instanceof THREE.Mesh){geometry.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}});
      element.dataset.braceCount=String(model.root.userData.braceCount);
      element.dataset.dimensions=JSON.stringify([profile.width,profile.height,profile.depth]);
      element.dataset.artwork=imageSrc;
      function view(name:string){controls.autoRotate=false;setAuto(false);controls.enableDamping=false;controls.update();const poses:Record<string,number[]>={front:[0,0,1],back:[0,0,-1],side:[1,.1,.18],reset:[.36,.12,1]};camera.position.fromArray(poses[name]??poses.reset).normalize().multiplyScalar(fit*(name==="side"?1.2:1));controls.target.set(0,0,0);if(name==="detail"||name==="rear-detail"){controls.target.set(profile.width/2-.025,profile.height/2-.025,0);camera.position.copy(controls.target).add(new THREE.Vector3(name==="rear-detail"?-.09:.09,name==="rear-detail"?-.07:.07,name==="rear-detail"?-.18:.22));}if(name==="brace-detail"){controls.target.set(profile.braces==="single"&&profile.width>=profile.height?0:profile.width/2-profile.railWidth,profile.braces==="single"&&profile.width>=profile.height?profile.height/2-profile.railWidth:0,0);camera.position.copy(controls.target).add(new THREE.Vector3(.05,.04,-.18));}controls.update();controls.enableDamping=true;invalidate();}
      actions.current={view,zoom(factor){camera.position.sub(controls.target).multiplyScalar(factor).clampLength(controls.minDistance,controls.maxDistance).add(controls.target);controls.update();invalidate();},rotate(){controls.autoRotate=!controls.autoRotate;invalidate();return controls.autoRotate;}};
      resize();view("reset");setStatus("");element.dataset.ready="true";
    };
    void load().catch(()=>{if(alive)setStatus("Could not display 3D. Close 3D view to return to the artwork image.");});
    return ()=>{alive=false;actions.current=null;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();document.removeEventListener("visibilitychange",invalidate);renderer.domElement.removeEventListener("webglcontextlost",lost);controls.dispose();geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());light.shadow.map?.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
  // This component is keyed to the entire selection in CanvasProductScene.
  },[imageSrc,sizeKey,orientation]);

  return <div ref={panel} className={styles.panel}>
    <p className={styles.dimensions}>{sizeKey.toUpperCase()} · {Number((displayProfile.width*100).toFixed(1))} × {Number((displayProfile.height*100).toFixed(1))} × 3 cm</p>
    <div ref={host} className={styles.stage} title="Interactive canvas preview" role="application" aria-label="Interactive canvas. Drag to rotate; scroll or pinch to zoom." tabIndex={0} onKeyDown={event=>{
      if(event.key==="+"||event.key==="="){event.preventDefault();actions.current?.zoom(.85);}
      if(event.key==="-"){event.preventDefault();actions.current?.zoom(1/.85);}
    }}/>
    {status&&<p className={styles.status} role="status">{status}</p>}
    <div className={styles.controls} role="group" aria-label="3D view controls">
      {([['front','Front'],['back','Back'],['side','Side'],['detail','Detail'],['rear-detail','Back detail'],['reset','Reset']] as const).map(([view,label])=><button type="button" key={view} data-mobile-primary={["front", "back", "reset"].includes(view) || undefined} disabled={!!status} onClick={()=>actions.current?.view(view)}>{label}</button>)}
      {displayProfile.braces!=="none"&&<button type="button" disabled={!!status} onClick={()=>actions.current?.view("brace-detail")}>Brace detail</button>}
      <button type="button" disabled={!!status} aria-pressed={auto} onClick={()=>setAuto(actions.current?.rotate()??false)}>Rotate</button>
      <button type="button" disabled={!!status} aria-label="Zoom in" onClick={()=>actions.current?.zoom(.85)}>＋</button>
      <button type="button" disabled={!!status} aria-label="Zoom out" onClick={()=>actions.current?.zoom(1/.85)}>−</button>
      <button type="button" disabled={!!status} aria-label="Fullscreen 3D" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void panel.current?.requestFullscreen?.().catch(()=>{});}}>⛶</button>
    </div>
    <p className={styles.caption}>Drag to rotate · Scroll or pinch to zoom<br/>Artwork shown without cropping. Construction details are indicative.</p>
  </div>;
}
