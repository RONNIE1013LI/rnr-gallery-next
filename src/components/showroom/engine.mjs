import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {SHOWROOM_LAYOUT as L} from './layout.mjs';
import {fitDistance,walkPath,samplePath,ease,overviewPose,focusPose} from './navigation.mjs';
import {createStudioMaterials,roundedBox} from './studio-materials.mjs';
import {createStudioOcclusion} from './studio-occlusion.mjs';
import {createStoneReflection} from './studio-reflection.mjs';
import {createShowroomProducts,describeProducts} from './product-models.mjs';

export function welcomeActionAt(u,v){
 if(u>.38&&u<.98&&v>.60&&v<.71)return 'shop';
 if(u>.56&&u<.98&&v>.72&&v<.80)return 'transformation';
}

/** Real perspective geometry. The original artworks are only used as print textures. */
export async function createShowroom(canvas, options={}) {
 if(options.signal?.aborted)throw new DOMException('Showroom cancelled.','AbortError');
 const abort=new AbortController(),scene=new T.Scene();
 let disposed=false,raf=0,inView=true,active='overview',frames=0,ready=false;
 let resizeObserver,observer,occlusion,reflection;
 let referenceStatus="not-loaded";
 const reduced=options.reducedMotion??matchMedia('(prefers-reduced-motion: reduce)').matches;
 const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
 renderer.outputColorSpace=T.SRGBColorSpace;
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.00;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
 renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
 scene.background=new T.Color('#e4dfd4');scene.fog=new T.Fog('#e4dfd4',22,55);
 const camera=new T.PerspectiveCamera(46,1,.05,65);
 const geometries=new Set(),materials=new Set(),textures=new Set(),clickable=[],exhibits=new Map(),labels=new Map();
 const font=options.fontFamily||getComputedStyle(canvas).fontFamily||'Arial, sans-serif';
 const display=options.displayFont||font;
 const bodyMat=(color,roughness=.8,metalness=0)=>{const m=new T.MeshStandardMaterial({color,roughness,metalness});materials.add(m);return m;};
 const palette=createStudioMaterials(renderer,{materials,textures});
 const {plaster,trim,stone,brass,black,wood,linen}=palette;
 function mesh(geometry,material,parent=scene,shadow=true){
  geometries.add(geometry);materials.add(material);const m=new T.Mesh(geometry,material);m.castShadow=shadow;m.receiveShadow=true;parent.add(m);return m;
 }
 function box(x,y,z,w,h,d,material,parent=scene,shadow=true){const m=mesh(shadow?roundedBox(w,h,d,Math.min(.02,w*.10,h*.10,d*.10),3):new T.BoxGeometry(w,h,d),material,parent,shadow);m.position.set(x,y,z);return m;}
 function cylinder(x,y,z,r,h,material,parent=scene,rt=r,shadow=true){const m=mesh(new T.CylinderGeometry(rt,r,h,32),material,parent,shadow);m.position.set(x,y,z);return m;}
 function paint(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');if(!ctx)throw new Error('Canvas text is unavailable.');draw(ctx);const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.add(map);return map;}
 function basic(map,extra={}){const m=new T.MeshBasicMaterial({map,toneMapped:false,...extra});materials.add(m);return m;}
 function label(x,y,z,w,title,detail='',parent=scene,stop){
  const map=paint(1000,174,c=>{c.fillStyle='#705c37';c.font=`600 25px ${font}`;c.fillText(title.toUpperCase(),38,61);c.fillStyle='#53584d';c.font=`400 23px ${font}`;c.fillText(detail,38,117);});
  const m=mesh(new T.PlaneGeometry(w,w*.174),basic(map,{transparent:true,depthWrite:false}),parent,false);m.position.set(x,y,z);
  if(stop){m.userData.stop=stop;clickable.push(m);labels.set(stop,m);}
  return m;
 }
 function register(id,object,width,height,centre){object.traverse(o=>{o.userData.stop=id;});clickable.push(object);exhibits.set(id,{object,width,height,centre:new T.Vector3(...centre)});}
 function contact(x,z,w,d,opacity=.16){
  const map=paint(256,256,c=>{const g=c.createRadialGradient(128,128,8,128,128,126);g.addColorStop(0,`rgba(43,37,26,${opacity})`);g.addColorStop(.45,`rgba(43,37,26,${opacity*.55})`);g.addColorStop(1,'rgba(43,37,26,0)');c.fillStyle=g;c.fillRect(0,0,256,256);});
  const m=mesh(new T.PlaneGeometry(w,d),basic(map,{transparent:true,depthWrite:false}),scene,false);m.rotation.x=-Math.PI/2;m.position.set(x,.012,z);return m;
 }
 // Warm window daylight, local exhibit lights and a cool low-level room bounce.
 // A low ambient level preserves the light/shadow hierarchy instead of flattening surfaces.
 scene.add(new T.HemisphereLight('#f5f5f1','#d9d4c9',.82));
 // Two window samples retain a soft daylight direction while halving shadow-map work.
 for(const x of [-4.2,4.2]){
  const key=new T.DirectionalLight('#fff7e9',.28);key.position.set(x,5.5,5.5);
  key.target.position.set(0,1,-2.7);key.castShadow=true;key.shadow.mapSize.set(1024,1024);
  Object.assign(key.shadow.camera,{left:-9,right:9,top:7,bottom:-5,near:.5,far:28});
  key.shadow.bias=-.0004;key.shadow.normalBias=.025;key.shadow.radius=4;key.shadow.blurSamples=8;scene.add(key,key.target);
 }
 const fill=new T.DirectionalLight('#e6e9ed',.18);fill.position.set(6,3.4,4);scene.add(fill);
 for(const x of [-5.17,L.banner.x,L.canvas.x,L.rollup.x]){
  const isCanvas=x===L.canvas.x;
  const spot=new T.SpotLight('#fff0d4',isCanvas?9.0:14,9,isCanvas?.47:.46,isCanvas?.92:.72,1.45);
  spot.position.set(x,4.03,-.8);spot.target.position.set(x,isCanvas?L.canvas.y:1.75,-3.2);scene.add(spot,spot.target);
 }
 // A bounded studio environment supplies reflections for metal, not a giant white highlight.
 const envScene=new T.Scene();envScene.background=new T.Color('#6c6961');
 const envBox=new T.Mesh(new T.BoxGeometry(20,12,20),new T.MeshBasicMaterial({color:'#9a9488',side:T.BackSide}));envScene.add(envBox);
 const envLights=[];
 for(const [pos,size,strength] of [[[-7,3,2],[3,4],2.8],[[6,3,5],[3,2],.55],[[0,5,-2],[10,.3],1.25]]){
  const light=new T.Mesh(new T.PlaneGeometry(...size),new T.MeshBasicMaterial({color:new T.Color(strength,strength*.96,strength*.86)}));
  light.position.set(...pos);light.lookAt(0,1,0);envScene.add(light);envLights.push(light);
 }
 const pmrem=new T.PMREMGenerator(renderer),envTarget=pmrem.fromScene(envScene,0,.1,50);scene.environment=envTarget.texture;
 pmrem.dispose();envBox.geometry.dispose();envBox.material.dispose();for(const l of envLights){l.geometry.dispose();l.material.dispose();}
 // Architectural volume. The camera moves inside this room at human eye height.
 const floorMesh=box(0,-.14,4,15,.28,17,stone,scene,false);
 box(0,2.25,-3.34,15,4.5,.22,plaster,scene,false);
 box(-7.35,2.25,4,.20,4.5,15,plaster,scene,false);box(7.35,2.25,4,.20,4.5,15,plaster,scene,false);
 box(0,4.53,4,15,.18,15,plaster,scene,false);
 box(0,.10,-3.17,14.7,.20,.055,trim,scene,false);
 for(const x of [-7.21,7.21])box(x,.1,3.8,.045,.2,14,trim,scene,false);
 // Very fine travertine tile joints and wall reveals.
 const joint=bodyMat('#c0b7a6');
 for(let x=-7.2;x<=7.2;x+=1.8)box(x,.003,4,.007,.003,15,joint,scene,false);
 for(let z=-3.2;z<12;z+=1.8)box(0,.003,z,14.6,.003,.007,joint,scene,false);
 // Fine shadow gaps at floor and ceiling, not gold outlines around every panel.
 box(0,.025,-3.12,14.7,.05,.018,black,scene,false);
 box(0,4.24,-3.02,14.7,.16,.38,trim,scene,false);
 box(0,4.43,-2.86,14.7,.08,.09,trim,scene,false);
 box(0,4.33,-3.16,14.65,.025,.035,new T.MeshBasicMaterial({color:'#fff1cd',toneMapped:false}),scene,false);
 for(const x of [-7.18,7.18]){box(x,4.24,3.8,.38,.16,13.4,trim,scene,false);box(x,4.36,3.8,.026,.025,13.4,new T.MeshBasicMaterial({color:'#fff2db'}),scene,false);}
 const alcove=box(5.32,2.12,-3.13,3.45,4.23,.12,black,scene,false);
 alcove.name='walnut-acoustic-alcove';
 const slatGeometry=roundedBox(.068,4.12,.067,.005,2);geometries.add(slatGeometry);
 const slats=new T.InstancedMesh(slatGeometry,wood,39),slatDummy=new T.Object3D();scene.add(slats);slats.castShadow=true;slats.receiveShadow=true;
 for(let i=0;i<39;i++){slatDummy.position.set(3.65+i*.087,2.12,-3.045);slatDummy.updateMatrix();slats.setMatrixAt(i,slatDummy.matrix);}
 // Ambient-occlusion data is separate from colour data and has its own UV channel.
 const wallAO=paint(768,256,c=>{
  c.fillStyle='#fff';c.fillRect(0,0,768,256);
  for(const [cx,cy,w,h] of [[L.banner.x,L.banner.y,L.banner.width,L.banner.width/2],[L.canvas.x,L.canvas.y,L.canvas.displayWidth,L.canvas.displayWidth*L.canvas.height/L.canvas.width]]){
   const x=(cx+7.5)/15*768,y=(4.5-cy)/4.5*256,rw=w/15*768,rh=h/4.5*256;
   c.save();c.filter='blur(4px)';c.fillStyle='rgba(0,0,0,.44)';c.fillRect(x-rw/2+2,y-rh/2+3,rw,rh);c.restore();
  }
 });wallAO.colorSpace=T.NoColorSpace;wallAO.channel=1;
 const wallMaterial=plaster.clone();wallMaterial.name='plaster-with-contact-occlusion';wallMaterial.aoMap=wallAO;wallMaterial.aoMapIntensity=.65;materials.add(wallMaterial);
 const wallGeometry=new T.PlaneGeometry(15,4.5);wallGeometry.setAttribute('uv1',wallGeometry.attributes.uv.clone());
 const wallFace=mesh(wallGeometry,wallMaterial,scene,false);wallFace.position.set(0,2.25,L.wallSurfaceZ);

 const luminous=new T.MeshBasicMaterial({color:'#fff1d0',toneMapped:false});materials.add(luminous);
 for(const x of [-5.1,5.1]){box(x,4.27,2.1,.065,.16,10.3,trim,scene,false);box(x,4.181,2.1,.041,.015,10.2,luminous,scene,false);}
 box(0,4.40,3.2,11,.11,6.8,trim,scene,false);
 box(0,4.04,-1.05,12.4,.045,.07,black,scene,false);
 for(const x of [-5.17,L.banner.x,L.canvas.x,L.rollup.x]){
  const fixture=new T.Group();fixture.position.set(x,3.94,-1.05);scene.add(fixture);fixture.rotation.x=.45;
  cylinder(0,0,0,.052,.19,black,fixture,.052,false);
  cylinder(0,-.101,0,.039,.005,luminous,fixture,.039,false);
 }

 for(const z of [0,2.8,5.6]){
  box(-7.23,2.55,z,.022,2.95,1.95,bodyMat('#e3e8e4'),scene,false);
  box(-7.20,2.55,z,.025,2.99,.032,brass,scene,false);
  for(const y of [1.075,4.025])box(-7.19,y,z,.04,.035,1.99,brass,scene,false);
 }
 // The complete existing hero copy and both real CTA hit areas live on this wall.
 const info=new T.Group();info.position.set(-5.17,0,-2.68);info.rotation.y=.045;scene.add(info);
 box(0,2.04,-.17,3.23,3.92,.24,trim,info);
 box(0,4.008,-.15,3.25,.02,.25,brass,info,false);
 const copy=paint(1800,1670,c=>{
  c.textAlign='right';
  c.fillStyle='#715933';c.font=`600 35px ${font}`;c.letterSpacing='4px';c.fillText('CUSTOM STORY & ARTWORK STUDIO',1740,125);c.letterSpacing='0px';
  c.fillStyle='#182f26';c.font=`600 166px ${display}`;
  ['Custom Canvas','& Banners, made','for your story.'].forEach((line,i)=>c.fillText(line,1740,420+i*194));
  c.fillStyle='#ab8d59';c.fillRect(80,915,1660,3);
  c.fillStyle='#173c31';c.beginPath();c.roundRect(695,1010,1045,153,78);c.fill();c.fillStyle='#fff8ee';c.font=`600 48px ${font}`;c.textAlign='center';c.fillText('Choose Your Product',1217,1106);
  c.fillStyle='#173c31';c.font=`600 43px ${font}`;c.textAlign='right';c.fillText('See Transformations  →',1740,1270);
  c.fillStyle='#545e52';c.font=`400 38px ${font}`;
  c.fillText('Custom design, proof before printing and delivery',1740,1460);c.fillText('across New Zealand and Australia.',1740,1525);
 });
 const infoPlane=mesh(new T.PlaneGeometry(3.05,2.83),basic(copy,{transparent:true,depthWrite:false}),info,false);infoPlane.position.set(0,2.05,0);register('welcome',infoPlane,3.05,2.83,[-5.17,2.05,-2.68]);
 // Exact original artwork files, loaded with cancellation and a finite timeout.
 const loader=new T.TextureLoader();
 function load(url){return new Promise((resolve,reject)=>{
  let settled=false;const timer=setTimeout(()=>finish(new Error('Artwork loading timed out.')),18000);
  function finish(error,map){if(settled){map?.dispose();return;}settled=true;clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);if(error)reject(error);else resolve(map);}
  function cancel(){finish(new Error('Showroom cancelled.'));}
  abort.signal.addEventListener('abort',cancel,{once:true});
  loader.load(url,map=>{map.colorSpace=T.SRGBColorSpace;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.add(map);finish(null,map);},undefined,()=>finish(new Error('An original artwork could not be loaded.')));
 });}
 // Allow a desktop-to-mobile switch to release GPU resources and pending loads.
 const onExternalAbort=()=>release();
 options.signal?.addEventListener('abort',onExternalAbort,{once:true});
 let photos,reference,plantAsset;
 const plantLoader=new GLTFLoader();plantLoader.setMeshoptDecoder(MeshoptDecoder);
 const referenceLoad=options.materialReference===false?Promise.resolve((()=>{
  const neutral=document.createElement('canvas');neutral.width=neutral.height=4;
  const context=neutral.getContext('2d');context.fillStyle='#b79a73';context.fillRect(0,0,4,4);
  const texture=new T.CanvasTexture(neutral);texture.colorSpace=T.SRGBColorSpace;textures.add(texture);return texture;
 })()):load(options.materialReference||'/media/showroom/canvas-material-reference.jpg');
 try{
  [photos,reference,plantAsset]=await Promise.all([
   Promise.all(['banner','canvas','rollup'].map(id=>load(options.artworks[id]))),
   referenceLoad,
   plantLoader.loadAsync(options.plantModel||'/media/showroom/potted-plant.glb'),
  ]);
 }catch(error){release();throw error;}
 // Use the catalogue's original mesh builders, with no simplified product stand-ins.
 // A neutral back is shown only until the existing photographic timber reference arrives.
 reference.userData.authentic=options.materialReference!==false;
 const products=createShowroomProducts(Object.fromEntries(['banner','canvas','rollup'].map((id,i)=>[id,photos[i]])),reference,{geometries,materials,textures});
 for(const [id,product] of products){scene.add(product.root);register(id,product.root,product.width,product.height,product.centre.toArray());}
 label(L.banner.x,.90,L.wallSurfaceZ+.020,1.62,'01 / Wall banner','Made for your milestone.',scene,'banner');
 label(L.canvas.x,1.06,L.wallSurfaceZ+.025,1.62,'02 / Canvas','Your photographs. One family piece.',scene,'canvas');
 contact(L.rollup.x,L.rollup.z,L.rollup.displayWidth*1.55,L.rollup.displayWidth*.75,.20);
 // Keep the physical aluminium cassette and its feet unobscured by labels.
 label(L.rollup.x,3.55,L.wallSurfaceZ+.025,1.50,'03 / Roll-up banner','Stand out. Celebrate.',scene,'rollup');
 referenceStatus=reference.userData.authentic?'optimized-authentic-site-reference':'offline-neutral-back';
 // Tailored upholstered bench, inside the existing navigation obstacle footprint.
 box(.15,.362,1.42,2.80,.095,.82,wood);
 for(const x of [-1.05,1.35]){
  const leg=box(x,.178,1.42,.11,.345,.70,wood);leg.rotation.z=x<0?-.045:.045;
  contact(x,1.42,.42,.97,.25);
 }
 const seat=mesh(roundedBox(2.74,.125,.79,.045,5),linen);seat.position.set(.15,.458,1.42);seat.name='tailored-linen-seat';
 contact(.15,1.42,3.25,1.38,.20);
 const seamMat=bodyMat('#ab9b84',1);seamMat.name='textile-piping';
 const seamPoints=[];const hw=1.344,hd=.377,rr=.044;
 for(let corner=0;corner<4;corner++)for(let j=0;j<=8;j++){
  const angle=corner*Math.PI/2+j/8*Math.PI/2;
  const cx=corner===0||corner===3?hw-rr:-hw+rr,cz=corner<2?hd-rr:-hd+rr;
  seamPoints.push(new T.Vector3(.15+cx+Math.cos(angle)*rr,.465,1.42+cz+Math.sin(angle)*rr));
 }
 const seamCurve=new T.CatmullRomCurve3(seamPoints,true);mesh(new T.TubeGeometry(seamCurve,128,.002,4,true),seamMat);
 // CC0 Poly Haven Potted Plant 01, reduced and texture-compressed for the desktop-only scene.
 const tree=plantAsset.scene;tree.name='Potted Plant 01';scene.add(tree);
 const rawPlantBounds=new T.Box3().setFromObject(tree),plantScale=1.92/rawPlantBounds.getSize(new T.Vector3()).y;
 tree.scale.setScalar(plantScale);tree.rotation.y=-.52;tree.updateMatrixWorld(true);
 const scaledPlantBounds=new T.Box3().setFromObject(tree);
 tree.position.set(6.0,-scaledPlantBounds.min.y,-2.0);
 tree.traverse(object=>{
  if(object.geometry)geometries.add(object.geometry);
  if(!object.material)return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   materials.add(material);material.envMapIntensity=.08;
   for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  }
  if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}
 });
 contact(6.0,-2.0,.98,.95,.24);
 label(5.01,3.54,-3.19,2.08,'R&R GALLERY','CUSTOM PRINTS / NEW ZEALAND');
 scene.updateMatrixWorld(true);renderer.shadowMap.needsUpdate=true;
 reflection=createStoneReflection(renderer,scene,camera,floorMesh,stone);
 occlusion=createStudioOcclusion(renderer,scene,camera,materials);
 // Navigation and physical camera movement.
 const target=new T.Vector3(),look=new T.Vector2(),desiredLook=new T.Vector2();
 let route=[],fromTarget=new T.Vector3(),toTarget=new T.Vector3(),started=0,duration=0,dolly=0,lastTime=0;
 let lastW=canvas.clientWidth,lastH=canvas.clientHeight,pointer=null;
 const narrow=()=>canvas.clientWidth<720;
 function pose(id){
  const aspect=Math.max(.25,canvas.clientWidth/Math.max(1,canvas.clientHeight));camera.fov=narrow()?55:46;
  if(id==='overview'){
   if(narrow())return {eye:[-5.17,1.65,fitDistance(3.05,2.83,camera.fov,aspect,1.20)-2.68],target:[-5.17,2.10,-2.68]};
   return overviewPose(camera.fov,aspect,dolly);
  }
  const ex=exhibits.get(id);if(!ex)throw new Error('Unknown showroom destination.');
  return focusPose(id,ex,camera.fov,aspect,dolly);
 }
 function invalidate(){if(!disposed&&inView&&!document.hidden&&!raf)raf=requestAnimationFrame(draw);}
 function go(id){
  if(disposed)return;active=id;dolly=0;desiredLook.set(0,0);look.set(0,0);const dest=pose(id);
  for(const [labelId,productLabel] of labels)productLabel.visible=id==='overview'||labelId===id;
  route=walkPath(camera.position.toArray(),dest.eye);fromTarget.copy(target);toTarget.fromArray(dest.target);started=performance.now();duration=reduced?0:Math.min(2900,1400+route.reduce((sum,p,i)=>sum+(i?new T.Vector3(...p).distanceTo(new T.Vector3(...route[i-1])):0),0)*100);
  options.onStop?.(id);canvas.dataset.stop=id;invalidate();
 }
 function step(amount){
  if(active==='overview')dolly=Math.max(-1.4,Math.min(2.2,dolly+amount));
  else {const ex=exhibits.get(active);const base=fitDistance(ex.width,ex.height,camera.fov,camera.aspect,1.27);dolly=Math.max(-.8,Math.min(Math.max(.3,base-1.2),dolly+amount));}
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
  occlusion.setEnabled(false);reflection.render();occlusion.setEnabled(true);occlusion.render();frames++;
  if(!ready){ready=true;started=performance.now();canvas.dataset.ready='true';options.onReady?.();if(!reduced)invalidate();}
  if(progress<1||look.distanceTo(desiredLook)>.0003)invalidate();
 }
 const raycaster=new T.Raycaster();
 function pick(e){const r=canvas.getBoundingClientRect();raycaster.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),camera);return raycaster.intersectObjects(clickable,true)[0];}
 function pickedStop(object){for(let node=object;node;node=node.parent)if(node.userData.stop)return node.userData.stop;}
 function down(e){if(e.button!==0)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,drag:false};canvas.setPointerCapture(e.pointerId);}
 function move(e){
  if(pointer?.id===e.pointerId){if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>7)pointer.drag=true;if(pointer.drag){desiredLook.x=Math.max(-3.0,Math.min(3.0,desiredLook.x-(e.clientX-pointer.lastX)*.007));desiredLook.y=Math.max(-1.1,Math.min(1.1,desiredLook.y+(e.clientY-pointer.lastY)*.005));invalidate();}pointer.lastX=e.clientX;pointer.lastY=e.clientY;}
  if(e.pointerType==='mouse')canvas.style.cursor=pointer?.drag?'grabbing':pick(e)?'pointer':'grab';
 }
 function up(e){
  if(!pointer||e.pointerId!==pointer.id)return;const dragged=pointer.drag;pointer=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(dragged)return;
  const hit=pick(e);if(!hit)return;const id=pickedStop(hit.object);if(!id)return;
  if(id==='welcome'&&hit.uv){
   const u=hit.uv.x,v=1-hit.uv.y;
   // Current artwork is right-aligned: keep the interactive regions aligned
   // with the visible CTA button and transformation link on the canvas texture.
   const action=welcomeActionAt(u,v);if(action){options.onNavigate?.(action);return;}
  }
  go(id);
 }
 const eventOptions={signal:abort.signal};canvas.addEventListener('pointerdown',down,eventOptions);canvas.addEventListener('pointermove',move,eventOptions);canvas.addEventListener('pointerup',up,eventOptions);canvas.addEventListener('pointercancel',()=>{pointer=null;},eventOptions);
 canvas.addEventListener('keydown',e=>{if(e.key==='Escape')go('overview');if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')desiredLook.x-=.2;if(e.key==='ArrowRight')desiredLook.x+=.2;if(e.key==='ArrowUp')desiredLook.y+=.15;if(e.key==='ArrowDown')desiredLook.y-=.15;desiredLook.x=Math.max(-3,Math.min(3,desiredLook.x));desiredLook.y=Math.max(-1.1,Math.min(1.1,desiredLook.y));invalidate();}if(e.key==='+'||e.key==='=')step(.25);if(e.key==='-')step(-.25);},eventOptions);
 canvas.addEventListener('wheel',e=>{e.preventDefault();const scale=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;step(Math.max(-.38,Math.min(.38,-e.deltaY*scale*.0025)));},{...eventOptions,passive:false});
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();options.onError?.(new Error('3D context interrupted. Standard gallery restored.'));release();},eventOptions);
 resizeObserver=new ResizeObserver(()=>{const w=canvas.clientWidth,h=canvas.clientHeight;if(w===lastW&&h===lastH)return;lastW=w;lastH=h;const p=pose(active);route=[p.eye,p.eye];fromTarget.fromArray(p.target);toTarget.copy(fromTarget);duration=0;invalidate();});resizeObserver.observe(canvas);
 observer=new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting??true;if(inView)invalidate();else if(raf){cancelAnimationFrame(raf);raf=0;}},{rootMargin:'100px'});observer.observe(canvas);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&raf){cancelAnimationFrame(raf);raf=0;}else invalidate();},eventOptions);
 const p=pose('overview');const entry=[p.eye[0],p.eye[1],p.eye[2]+(reduced?0:1.5)];camera.position.fromArray(entry);target.fromArray(p.target);route=[entry,p.eye];fromTarget.copy(target);toTarget.copy(target);started=performance.now();duration=reduced?0:1800;canvas.dataset.stop='overview';invalidate();
 function release(){
  if(disposed)return;disposed=true;options.signal?.removeEventListener('abort',onExternalAbort);abort.abort();if(raf)cancelAnimationFrame(raf);
  // Observers are created only after all assets have loaded.
  if(typeof resizeObserver!=='undefined')resizeObserver.disconnect();if(typeof observer!=='undefined')observer.disconnect();
  scene.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.isLight&&o.shadow?.map)o.shadow.map.dispose();if(o.isLight&&o.shadow?.mapPass)o.shadow.mapPass.dispose();});
  for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();occlusion?.dispose();reflection?.dispose();envTarget.dispose();renderer.dispose();canvas.style.cursor='';
 }
 return {go,step,dispose:release,inspect:()=>({active,ready,frames,framePending:!!raf,inView,documentVisibility:document.visibilityState,eye:camera.position.toArray(),target:target.toArray(),fov:camera.fov,disposed,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,referenceStatus,products:describeProducts(products),materials:[...materials].filter(m=>m.name).map(m=>({name:m.name,type:m.type,map:!!m.map,bumpMap:!!m.bumpMap,aoMap:!!m.aoMap,roughness:m.roughness,metalness:m.metalness})),artworks:photos.map(t=>({width:t.image.width,height:t.image.height})),route,screenTargets:[...exhibits.entries()].map(([id,ex])=>{const p=ex.centre.clone().project(camera);return{id,x:(p.x+1)/2*canvas.clientWidth,y:(1-p.y)/2*canvas.clientHeight};})})};
}
