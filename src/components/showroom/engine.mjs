import * as T from 'three';
import {fitDistance,walkPath,samplePath,ease} from './navigation.mjs';

/** Real perspective geometry. The original artworks are only used as print textures. */
export async function createShowroom(canvas, options={}) {
 const abort=new AbortController(),scene=new T.Scene();
 let disposed=false,raf=0,inView=true,active='overview',frames=0,ready=false;
 let resizeObserver,observer;
 const reduced=options.reducedMotion??matchMedia('(prefers-reduced-motion: reduce)').matches;
 const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
 renderer.outputColorSpace=T.SRGBColorSpace;
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.10;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
 scene.background=new T.Color('#e4dfd4');scene.fog=new T.Fog('#e4dfd4',22,55);
 const camera=new T.PerspectiveCamera(46,1,.05,65);
 const geometries=new Set(),materials=new Set(),textures=new Set(),clickable=[],exhibits=new Map();
 const font=options.fontFamily||getComputedStyle(canvas).fontFamily||'Arial, sans-serif';
 const display=options.displayFont||font;
 const bodyMat=(color,roughness=.8,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});materials.add(m);return m;};
 const plaster=bodyMat('#e9e2d5'),trim=bodyMat('#d4c8b3'),stone=bodyMat('#cfc8b9',.52),brass=bodyMat('#a48959',.33,.7),aluminium=bodyMat('#c2c5c2',.26,.9),black=bodyMat('#29332d',.6),wood=bodyMat('#8f7150'),linen=bodyMat('#cabb9e');
 function mesh(geometry,material,parent=scene,shadow=true){
  geometries.add(geometry);materials.add(material);const m=new T.Mesh(geometry,material);m.castShadow=shadow;m.receiveShadow=true;parent.add(m);return m;
 }
 function box(x,y,z,w,h,d,material,parent=scene,shadow=true){const m=mesh(new T.BoxGeometry(w,h,d),material,parent,shadow);m.position.set(x,y,z);return m;}
 function cylinder(x,y,z,r,h,material,parent=scene,rt=r,shadow=true){const m=mesh(new T.CylinderGeometry(rt,r,h,32),material,parent,shadow);m.position.set(x,y,z);return m;}
 function paint(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');if(!ctx)throw new Error('Canvas text is unavailable.');draw(ctx);const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.add(map);return map;}
 function basic(map,extra={}){const m=new T.MeshBasicMaterial({map,toneMapped:false,...extra});materials.add(m);return m;}
 function label(x,y,z,w,title,detail='',parent=scene){
  const map=paint(1000,174,c=>{c.fillStyle='#e9e2d5';c.fillRect(0,0,1000,174);c.fillStyle='#705c37';c.font=`600 25px ${font}`;c.fillText(title.toUpperCase(),38,61);c.fillStyle='#53584d';c.font=`400 23px ${font}`;c.fillText(detail,38,117);});
  const m=mesh(new T.PlaneGeometry(w,w*.174),basic(map),parent,false);m.position.set(x,y,z);return m;
 }
 function register(id,object,width,height,centre){object.userData.stop=id;clickable.push(object);exhibits.set(id,{object,width,height,centre:new T.Vector3(...centre)});}
 function contact(x,z,w,d,opacity=.16){
  const map=paint(256,256,c=>{const g=c.createRadialGradient(128,128,8,128,128,126);g.addColorStop(0,`rgba(43,37,26,${opacity})`);g.addColorStop(.45,`rgba(43,37,26,${opacity*.55})`);g.addColorStop(1,'rgba(43,37,26,0)');c.fillStyle=g;c.fillRect(0,0,256,256);});
  const m=mesh(new T.PlaneGeometry(w,d),basic(map,{transparent:true,depthWrite:false}),scene,false);m.rotation.x=-Math.PI/2;m.position.set(x,.012,z);return m;
 }
 // Soft daylight plus a restrained warm gallery key light.
 scene.add(new T.HemisphereLight('#fff5df','#a49b86',1.15));
 const key=new T.DirectionalLight('#fff3d9',1.65);key.position.set(-3,6,5);key.target.position.set(0,1,-3);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-9,right:9,top:7,bottom:-5,near:1,far:24});key.shadow.bias=-.0004;key.shadow.normalBias=.024;key.shadow.radius=4;scene.add(key,key.target);
 const fill=new T.DirectionalLight('#e6eff2',.45);fill.position.set(6,3,4);scene.add(fill);
 // A room-scale environment provides metallic highlights without external HDR downloads.
 const envScene=new T.Scene();envScene.background=new T.Color('#bbb6a8');
 const envBox=new T.Mesh(new T.BoxGeometry(20,12,20),new T.MeshBasicMaterial({color:'#d5d0c3',side:T.BackSide}));envScene.add(envBox);
 const envLights=[];
 for(const p of [[-6,4,1],[5,4,-1],[0,5,4]]){const light=new T.Mesh(new T.PlaneGeometry(4,3),new T.MeshBasicMaterial({color:new T.Color(5,4.5,3.7)}));light.position.set(...p);light.lookAt(0,0,0);envScene.add(light);envLights.push(light);}
 const pmrem=new T.PMREMGenerator(renderer),envTarget=pmrem.fromScene(envScene,.08,.1,50);scene.environment=envTarget.texture;pmrem.dispose();envBox.geometry.dispose();envBox.material.dispose();for(const l of envLights){l.geometry.dispose();l.material.dispose();}
 // Architectural volume. The camera moves inside this room at human eye height.
 box(0,-.14,4,15,.28,17,stone,scene,false);
 box(0,2.25,-3.34,15,4.5,.22,plaster,scene,false);
 box(-7.35,2.25,4,.20,4.5,15,plaster,scene,false);box(7.35,2.25,4,.20,4.5,15,plaster,scene,false);
 box(0,4.53,4,15,.18,15,plaster,scene,false);
 box(0,.10,-3.17,14.7,.20,.055,trim,scene,false);
 for(const x of [-7.21,7.21])box(x,.1,3.8,.045,.2,14,trim,scene,false);
 // Very fine travertine tile joints and wall reveals.
 const joint=bodyMat('#c0b7a6');
 for(let x=-7.2;x<=7.2;x+=1.8)box(x,.003,4,.007,.003,15,joint,scene,false);
 for(let z=-3.2;z<12;z+=1.8)box(0,.003,z,14.6,.003,.007,joint,scene,false);
 for(const x of [-6.9,-3.42,.93,3.6,6.4])box(x,2.19,-3.21,.012,4.18,.017,brass,scene,false);
 const luminous=new T.MeshBasicMaterial({color:'#fff1d0',toneMapped:false});materials.add(luminous);
 for(const x of [-5.1,0,5.1]){box(x,4.27,2.1,.065,.16,10.3,trim,scene,false);box(x,4.181,2.1,.041,.015,10.2,luminous,scene,false);}
 for(const z of [-1.5,2.8,7.1])box(0,4.36,z,14.7,.18,.13,plaster,scene,false);
 box(0,4.04,-1.05,12.4,.045,.07,black,scene,false);
 for(const x of [-5.2,-2.5,-.2,2.2,4.9]){cylinder(x,3.96,-1.05,.060,.17,black,scene,.060,false);cylinder(x,3.87,-1.05,.046,.012,luminous,scene,.046,false);}
 for(const z of [0,2.8,5.6]){
  box(-7.23,2.55,z,.022,2.95,1.95,bodyMat('#e3e8e4'),scene,false);
  box(-7.20,2.55,z,.025,2.99,.032,brass,scene,false);
  for(const y of [1.075,4.025])box(-7.19,y,z,.04,.035,1.99,brass,scene,false);
 }
 // The complete existing hero copy and both real CTA hit areas live on this wall.
 const info=new T.Group();info.position.set(-5.17,0,-2.68);info.rotation.y=.045;scene.add(info);
 box(0,2.04,-.17,3.23,3.92,.24,bodyMat('#e6dece'),info);
 box(0,4.008,-.15,3.25,.02,.25,brass,info,false);
 const copy=paint(1800,1670,c=>{
  c.fillStyle='#e6dece';c.fillRect(0,0,1800,1670);
  c.fillStyle='#715933';c.font=`600 35px ${font}`;c.letterSpacing='4px';c.fillText('CUSTOM STORY & ARTWORK STUDIO',60,125);c.letterSpacing='0px';
  c.fillStyle='#182f26';c.font=`600 166px ${display}`;
  ['Custom Canvas','& Banners, made','for your story.'].forEach((line,i)=>c.fillText(line,52,420+i*194));
  c.fillStyle='#ab8d59';c.fillRect(60,915,1660,3);
  c.fillStyle='#173c31';c.beginPath();c.roundRect(55,1010,1030,153,78);c.fill();c.fillStyle='#fff8ee';c.font=`600 48px ${font}`;c.fillText('Choose Your Product',140,1106);
  c.fillStyle='#173c31';c.font=`600 43px ${font}`;c.fillText('See Transformations  →',60,1270);
  c.fillStyle='#545e52';c.font=`400 38px ${font}`;
  c.fillText('Custom design, proof before printing and delivery',60,1460);c.fillText('across New Zealand and Australia.',60,1525);
 });
 const infoPlane=mesh(new T.PlaneGeometry(3.05,2.83),basic(copy),info,false);infoPlane.position.set(0,2.05,0);register('welcome',infoPlane,3.05,2.83,[-5.17,2.05,-2.68]);
 // Exact original artwork files, loaded with cancellation and a finite timeout.
 const loader=new T.TextureLoader();
 function load(url){return new Promise((resolve,reject)=>{
  let settled=false;const timer=setTimeout(()=>finish(new Error('Artwork loading timed out.')),18000);
  function finish(error,map){if(settled){map?.dispose();return;}settled=true;clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);if(error)reject(error);else resolve(map);}
  function cancel(){finish(new Error('Showroom cancelled.'));}
  abort.signal.addEventListener('abort',cancel,{once:true});
  loader.load(url,map=>{map.colorSpace=T.SRGBColorSpace;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.add(map);finish(null,map);},undefined,()=>finish(new Error('An original artwork could not be loaded.')));
 });}
 let photos;
 try{photos=await Promise.all(['banner','canvas','rollup'].map(id=>load(options.artworks[id])));}catch(error){release();throw error;}
 const widths=[3.7,2.18,.94],centres=[[-1.28,2.10,-3.10],[2.10,2.13,-2.99],[4.9,1.35,-1.90]];
 const ids=['banner','canvas','rollup'];
 const rollGroup=new T.Group();rollGroup.position.set(...centres[2]);rollGroup.rotation.y=-.13;scene.add(rollGroup);
 photos.forEach((map,i)=>{
  const w=widths[i],h=w*map.image.height/map.image.width,centre=centres[i];
  if(i===0){box(centre[0],centre[1],centre[2]-.024,w+.025,h+.025,.026,bodyMat('#d2c6ad'));
   const print=mesh(new T.PlaneGeometry(w,h),basic(map));print.position.set(...centre);register(ids[i],print,w,h,centre);
   for(const dx of [-1,1])for(const dy of [-1,1]){const ring=mesh(new T.TorusGeometry(.015,.004,7,18),aluminium);ring.position.set(centre[0]+dx*(w/2-.024),centre[1]+dy*(h/2-.024),centre[2]+.014);}
   label(centre[0],.90,-3.195,1.62,'01 / Wall banner','Made for your milestone.');
  }else if(i===1){box(centre[0],centre[1],centre[2]-.066,w+.045,h+.045,.09,brass);box(centre[0],centre[1],centre[2]-.028,w,h,.045,bodyMat('#ece6d8'));
   const print=mesh(new T.PlaneGeometry(w,h),basic(map));print.position.set(...centre);register(ids[i],print,w,h,centre);
   label(centre[0],1.06,-3.19,1.62,'02 / Canvas','Your photographs. One family piece.');
  }else{
   const geom=new T.PlaneGeometry(w,h,24,1),pos=geom.attributes.position;
   for(let j=0;j<pos.count;j++){const x=pos.getX(j);pos.setZ(j,-.016*Math.pow(x/(w/2),2));}geom.computeVertexNormals();
   const print=mesh(geom,basic(map,{side:T.DoubleSide}),rollGroup);register(ids[i],print,w,h,centre);
   const floor=-centre[1];
   const base=cylinder(0,floor+.145,0,.09,1.045,aluminium,rollGroup,.09);base.rotation.z=Math.PI/2;
   box(0,floor+.178,0,1.05,.064,.17,aluminium,rollGroup);
   for(const x of [-.32,.32]){box(x,floor+.044,0,.055,.052,.51,aluminium,rollGroup);box(x,floor+.015,.23,.054,.023,.07,black,rollGroup);}
   box(0,h/2+.017,-.002,.99,.036,.046,aluminium,rollGroup);cylinder(0,-.01,-.07,.011,h,aluminium,rollGroup,.011);
   contact(4.9,-1.90,1.65,.95,.23);label(5.02,.18,-1.22,1.07,'03 / Roll-up banner','Stand out. Celebrate.');
  }
 });
 // Bench position matches the obstacle used by the walking-path planner.
 for(const x of [-1.16,1.46])for(const z of [1.04,1.78])box(x,.225,z,.065,.41,.065,brass);
 box(.15,.448,1.42,2.84,.09,.86,wood);box(.15,.57,1.42,2.94,.17,.84,linen);contact(.15,1.42,3.7,1.45,.20);
 for(const x of [-.83,.15,1.13])box(x,.657,1.42,.006,.003,.75,bodyMat('#b2a184'),scene,false);
 // Slender olive tree; leaf geometry is instanced for low draw-call cost.
 const tree=new T.Group();tree.position.set(-6.78,0,-.20);scene.add(tree);
 cylinder(0,.31,0,.27,.62,bodyMat('#b4aa95'),tree,.38);cylinder(0,.61,0,.337,.024,bodyMat('#484834'),tree,.337);
 cylinder(0,1.30,0,.026,1.48,wood,tree,.018);
 const leafGeometry=new T.SphereGeometry(1,7,4),leafMaterial=bodyMat('#6d7b52');geometries.add(leafGeometry);
 const leaves=new T.InstancedMesh(leafGeometry,leafMaterial,180);tree.add(leaves);leaves.castShadow=true;leaves.receiveShadow=true;const dummy=new T.Object3D();
 for(let i=0;i<180;i++){const a=i*2.399,r=.15+(i%9)*.066;dummy.position.set(Math.cos(a)*r,1.23+(i%17)*.074,Math.sin(a)*r);dummy.rotation.set(a*.21,a,.6);dummy.scale.set(.10,.027,.044);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);}
 contact(-6.78,-.20,1.1,1.1,.2);
 label(5.01,3.54,-3.19,2.08,'R&R GALLERY','CUSTOM PRINTS / NEW ZEALAND');
 scene.updateMatrixWorld(true);renderer.shadowMap.needsUpdate=true;
 // Navigation and physical camera movement.
 const target=new T.Vector3(),look=new T.Vector2(),desiredLook=new T.Vector2();
 let route=[],fromTarget=new T.Vector3(),toTarget=new T.Vector3(),started=0,duration=0,dolly=0,lastTime=0;
 let lastW=canvas.clientWidth,lastH=canvas.clientHeight,pointer=null;
 const narrow=()=>canvas.clientWidth<720;
 function pose(id){
  const aspect=Math.max(.25,canvas.clientWidth/Math.max(1,canvas.clientHeight));camera.fov=narrow()?55:46;
  if(id==='overview'){
   if(narrow())return {eye:[-5.17,1.65,fitDistance(3.05,2.83,camera.fov,aspect,1.20)-2.68],target:[-5.17,2.10,-2.68]};
   return {eye:[-.25,1.65,Math.max(7.0,fitDistance(13.8,4.5,camera.fov,aspect,1.02)-2.9)],target:[-.40,2.0,-2.9]};
  }
  const ex=exhibits.get(id);if(!ex)throw new Error('Unknown showroom destination.');
  const yaw=id==='rollup'?-.13:id==='welcome'?.045:0;
  const d=Math.max(id==='rollup'?3.25:2.1,fitDistance(ex.width,ex.height,camera.fov,aspect,1.27))-dolly;
  return {eye:[ex.centre.x+Math.sin(yaw)*d+(id==='canvas'?.17:0),1.65,ex.centre.z+Math.cos(yaw)*d],target:ex.centre.toArray()};
 }
 function invalidate(){if(!disposed&&inView&&!document.hidden&&!raf)raf=requestAnimationFrame(draw);}
 function go(id){
  if(disposed)return;active=id;dolly=0;desiredLook.set(0,0);look.set(0,0);const dest=pose(id);
  route=walkPath(camera.position.toArray(),dest.eye);fromTarget.copy(target);toTarget.fromArray(dest.target);started=performance.now();duration=reduced?0:Math.min(2900,1400+route.reduce((sum,p,i)=>sum+(i?new T.Vector3(...p).distanceTo(new T.Vector3(...route[i-1])):0),0)*100);
  options.onStop?.(id);canvas.dataset.stop=id;invalidate();
 }
 function step(amount){
  if(active==='overview')return;const ex=exhibits.get(active);const base=fitDistance(ex.width,ex.height,camera.fov,camera.aspect,1.27);dolly=Math.max(-.8,Math.min(Math.max(.3,base-1.2),dolly+amount));
  const p=pose(active);route=walkPath(camera.position.toArray(),p.eye);fromTarget.copy(target);toTarget.fromArray(p.target);started=performance.now();duration=reduced?0:450;invalidate();
 }
 function draw(time){
  raf=0;if(disposed||!inView||document.hidden)return;const progress=duration?Math.min(1,(time-started)/duration):1;
  camera.position.fromArray(samplePath(route,ease(progress)));target.lerpVectors(fromTarget,toTarget,ease(progress));
  const dt=Math.min(.08,(time-lastTime)/1000||.016);lastTime=time;look.lerp(desiredLook,reduced?1:1-Math.exp(-dt*10));
  const forward=target.clone().sub(camera.position).normalize(),right=new T.Vector3().crossVectors(forward,new T.Vector3(0,1,0)).normalize();
  camera.lookAt(target.clone().addScaledVector(right,look.x).add(new T.Vector3(0,look.y,0)));
  const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);camera.aspect=w/h;camera.updateProjectionMatrix();
  const dpr=Math.min(window.devicePixelRatio||1,narrow()?1.35:1.65);if(renderer.getPixelRatio()!==dpr)renderer.setPixelRatio(dpr);const size=renderer.getSize(new T.Vector2());if(size.x!==w||size.y!==h)renderer.setSize(w,h,false);
  renderer.render(scene,camera);frames++;
  if(!ready){ready=true;started=performance.now();canvas.dataset.ready='true';options.onReady?.();if(!reduced)invalidate();}
  if(progress<1||look.distanceTo(desiredLook)>.0003)invalidate();
 }
 const raycaster=new T.Raycaster();
 function pick(e){const r=canvas.getBoundingClientRect();raycaster.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);return raycaster.intersectObjects(clickable,false)[0];}
 function down(e){if(e.button!==0)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,drag:false};canvas.setPointerCapture(e.pointerId);}
 function move(e){
  if(pointer?.id===e.pointerId){if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>7)pointer.drag=true;if(pointer.drag){desiredLook.x=Math.max(-3.0,Math.min(3.0,desiredLook.x-(e.clientX-pointer.lastX)*.007));desiredLook.y=Math.max(-1.1,Math.min(1.1,desiredLook.y+(e.clientY-pointer.lastY)*.005));invalidate();}pointer.lastX=e.clientX;pointer.lastY=e.clientY;}
  if(e.pointerType==='mouse')canvas.style.cursor=pointer?.drag?'grabbing':pick(e)?'pointer':'grab';
 }
 function up(e){
  if(!pointer||e.pointerId!==pointer.id)return;const dragged=pointer.drag;pointer=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(dragged)return;
  const hit=pick(e);if(!hit)return;const id=hit.object.userData.stop;
  if(id==='welcome'&&hit.uv){const u=hit.uv.x,v=1-hit.uv.y;if(u>.03&&u<.61&&v>.603&&v<.699){options.onNavigate?.('shop');return;}if(u>.02&&u<.72&&v>.72&&v<.80){options.onNavigate?.('transformation');return;}}
  go(id);
 }
 const eventOptions={signal:abort.signal};canvas.addEventListener('pointerdown',down,eventOptions);canvas.addEventListener('pointermove',move,eventOptions);canvas.addEventListener('pointerup',up,eventOptions);canvas.addEventListener('pointercancel',()=>{pointer=null;},eventOptions);
 canvas.addEventListener('keydown',e=>{if(e.key==='Escape')go('overview');if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')desiredLook.x-=.2;if(e.key==='ArrowRight')desiredLook.x+=.2;if(e.key==='ArrowUp')desiredLook.y+=.15;if(e.key==='ArrowDown')desiredLook.y-=.15;desiredLook.x=Math.max(-3,Math.min(3,desiredLook.x));desiredLook.y=Math.max(-1.1,Math.min(1.1,desiredLook.y));invalidate();}if(e.key==='+'||e.key==='=')step(.25);if(e.key==='-')step(-.25);},eventOptions);
 canvas.addEventListener('wheel',e=>{if(e.altKey&&active!=='overview'){e.preventDefault();step(-Math.sign(e.deltaY)*.15);}},{...eventOptions,passive:false});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();options.onError?.(new Error('3D context interrupted. Standard gallery restored.'));release();},eventOptions);
 resizeObserver=new ResizeObserver(()=>{const w=canvas.clientWidth,h=canvas.clientHeight;if(w===lastW&&h===lastH)return;lastW=w;lastH=h;const p=pose(active);route=[p.eye,p.eye];fromTarget.fromArray(p.target);toTarget.copy(fromTarget);duration=0;invalidate();});resizeObserver.observe(canvas);
 observer=new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting??true;if(inView)invalidate();else if(raf){cancelAnimationFrame(raf);raf=0;}},{rootMargin:'100px'});observer.observe(canvas);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&raf){cancelAnimationFrame(raf);raf=0;}else invalidate();},eventOptions);
 const p=pose('overview');const entry=[p.eye[0],p.eye[1],p.eye[2]+(reduced?0:1.5)];camera.position.fromArray(entry);target.fromArray(p.target);route=[entry,p.eye];fromTarget.copy(target);toTarget.copy(target);started=performance.now();duration=reduced?0:1800;canvas.dataset.stop='overview';invalidate();
 function release(){
  if(disposed)return;disposed=true;abort.abort();if(raf)cancelAnimationFrame(raf);
  // Observers are created only after all assets have loaded.
  if(typeof resizeObserver!=='undefined')resizeObserver.disconnect();if(typeof observer!=='undefined')observer.disconnect();
  for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();envTarget.dispose();renderer.dispose();canvas.style.cursor='';
 }
 return {go,step,dispose:release,inspect:()=>({active,ready,frames,eye:camera.position.toArray(),target:target.toArray(),fov:camera.fov,disposed,drawCalls:renderer.info.render.calls,artworks:photos.map(t=>({width:t.image.width,height:t.image.height})),route,screenTargets:[...exhibits.entries()].map(([id,ex])=>{const p=ex.centre.clone().project(camera);return{id,x:(p.x+1)/2*canvas.clientWidth,y:(1-p.y)/2*canvas.clientHeight};})})};
}
