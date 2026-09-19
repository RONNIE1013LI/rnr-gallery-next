import * as T from 'three';
import {SHOWROOM_LAYOUT as L} from './layout.mjs';
import {createRollUpBannerModel, BANNER} from '../roll-up-banner-3d/model.ts';
import {createCanvasModel} from '../canvas-3d/model.ts';
import {getCanvasProfile} from '../canvas-3d/profiles.ts';
import {createFabricBannerModel} from '../fabric-banner-3d/model.ts';

/** Gallery instances of the existing catalogue models. No replacement product geometry. */
export function createShowroomProducts(photos, reference, resources) {
  const {geometries, materials, textures}=resources;
  const products=new Map();
  function own(id,root){
    root.traverse(object=>{
      object.userData.stop=id;
      if(object.geometry)geometries.add(object.geometry);
      if(!object.material)return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        materials.add(material);
        for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
      }
      if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}
    });
    return root;
  }
  const wallWidth=L.banner.width, wallHeight=wallWidth*photos.banner.image.height/photos.banner.image.width;
  // The rear fabric face is at local z=-1 mm. Keep an 8 mm mounting clearance.
  const bannerZ=L.wallSurfaceZ+L.wallMountGap+.001;
  const wall=createFabricBannerModel('wall',wallWidth,wallHeight,photos.banner,{
    eyeletInset:.060, cordRadius:.0007, cordReachX:.40, cordReachY:.25, cordAnchorZ:L.wallSurfaceZ+.002-bannerZ,
  });
  wall.name='Website wall banner';wall.position.set(L.banner.x,L.banner.y,bannerZ);
  wall.getObjectByName('artwork-front').material.toneMapped=false;
  // A full-size transparent hit plane keeps the thin fabric reliably clickable,
  // including over the real corner holes and fine suspension cords.
  const bannerHitMaterial=new T.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false});
  const bannerHitTarget=new T.Mesh(new T.PlaneGeometry(wallWidth,wallHeight),bannerHitMaterial);
  bannerHitTarget.name='Wall banner pointer target';bannerHitTarget.position.z=.012;wall.add(bannerHitTarget);
  wall.userData.source='src/components/fabric-banner-3d/model.ts';
  // Fasteners are part of the room, not a substitute banner construction.
  const anchorMetal=new T.MeshStandardMaterial({color:0xc7cbcc,metalness:.85,roughness:.29});
  for(let i=0;i<4;i++){
    const cord=wall.getObjectByName(`corner-cord-${i}`), end=cord.geometry.parameters.path.v2;
    cord.material.color.set('#d8cfbd');
    cord.material.roughness=.9;
    const pin=new T.Mesh(new T.CylinderGeometry(.005,.005,.006,16),anchorMetal);
    pin.rotation.x=Math.PI/2;pin.position.copy(end);pin.position.z-=.001;
    pin.name=`wall-pin-${i}`;wall.add(pin);
  }
  products.set('banner',{root:own('banner',wall),width:wallWidth,height:wallHeight,centre:wall.position.clone()});

  // Use the existing catalogue construction with the requested 120:85:3 profile.
  // Uniform scene scaling preserves width, height AND thickness ratios.
  const profile={...getCanvasProfile('a1','landscape'),width:L.canvas.width,height:L.canvas.height,depth:L.canvas.depth};
  const canvasModel=createCanvasModel(profile,photos.canvas,reference);
  canvasModel.textures.forEach(texture=>textures.add(texture));
  const canvas=canvasModel.root,canvasScale=L.canvas.displayWidth/profile.width;
  canvas.scale.setScalar(canvasScale);
  // Measure the actual back (including fixings), not just the nominal shell thickness.
  canvas.updateMatrixWorld(true);
  const canvasBack=new T.Box3().setFromObject(canvas).min.z;
  canvas.position.set(L.canvas.x,L.canvas.y,L.wallSurfaceZ+L.wallMountGap-canvasBack);
  canvas.userData.nominalDimensionsCm=[120,85,3];
  canvas.name='Website wrapped canvas';canvas.userData.source='src/components/canvas-3d/model.ts';
  canvas.traverse(object=>{
    if(!object.material)return;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(material.map?.source===photos.canvas.source){
        material.metalness=0;material.envMapIntensity=.12;
        if(material.bumpMap)material.bumpScale=.00012;
        if('sheen' in material){material.sheen=.035;material.sheenRoughness=1;}
        material.color?.setRGB(.86,.86,.86);
      }
    }
  });
  // The genuine manufacturing label is never replaced with an invented QR texture.
  canvas.getObjectByName('R&R manufacturing label').visible=reference.userData.authentic===true;
  products.set('canvas',{root:own('canvas',canvas),width:L.canvas.displayWidth,height:profile.height*canvasScale,centre:new T.Vector3(L.canvas.x,L.canvas.y,canvas.position.z+profile.depth*canvasScale/2)});

  const rollup=createRollUpBannerModel(photos.rollup),rollScale=L.rollup.displayWidth/BANNER.width;
  // Rotate the complete product as one rigid assembly so the print, top rail,
  // cassette and swivel feet all face the same inward direction.
  rollup.scale.setScalar(rollScale);rollup.rotation.y=-.20;
  rollup.updateMatrixWorld(true);
  const floorBounds=new T.Box3().setFromObject(rollup);
  // Derive floor contact from the actual swivel feet, not a guessed cassette centre.
  rollup.position.set(L.rollup.x,-floorBounds.min.y+.003,L.rollup.z);
  rollup.updateMatrixWorld(true);
  rollup.name='Website aluminium roll-up';rollup.userData.source='src/components/roll-up-banner-3d/model.ts';
  products.set('rollup',{root:own('rollup',rollup),width:BANNER.width*rollScale,height:BANNER.height*rollScale,centre:rollup.localToWorld(new T.Vector3(0,0,.025))});
  return products;
}

export function describeProducts(products){
  return [...products.entries()].map(([id,{root,width,height}])=>{
    root.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(root);
    const parts=[];
    root.traverse(o=>{if(o.isMesh)parts.push({name:o.name,geometry:o.geometry.type,position:o.position.toArray(),world:o.getWorldPosition(new T.Vector3()).toArray(),metalness:o.material?.metalness,roughness:o.material?.roughness,visible:o.visible});});
    return {id,source:root.userData.source,width,height,nominalDimensionsCm:root.userData.nominalDimensionsCm,scale:root.scale.toArray(),min:bounds.min.toArray(),max:bounds.max.toArray(),eyeletInset:root.userData.eyeletInset,cordRadius:root.userData.cordRadius,parts};
  });
}
