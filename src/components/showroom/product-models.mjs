import * as T from 'three';
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
  const wallWidth=3.7, wallHeight=wallWidth*photos.banner.image.height/photos.banner.image.width;
  const wall=createFabricBannerModel('wall',wallWidth,wallHeight,photos.banner,{
    eyeletInset:.060, cordRadius:.0007, cordReachX:.145, cordReachY:.11, cordAnchorZ:-.115,
  });
  wall.name='Website wall banner';wall.position.set(-1.28,2.10,-3.10);
  wall.getObjectByName('artwork-front').material.toneMapped=false;
  wall.userData.source='src/components/fabric-banner-3d/model.ts';
  // Fasteners are part of the room, not a substitute banner construction.
  const anchorMetal=new T.MeshStandardMaterial({color:0xc7cbcc,metalness:.85,roughness:.29});
  for(let i=0;i<4;i++){
    const cord=wall.getObjectByName(`corner-cord-${i}`), end=cord.geometry.parameters.path.v2;
    const pin=new T.Mesh(new T.CylinderGeometry(.005,.005,.006,16),anchorMetal);
    pin.rotation.x=Math.PI/2;pin.position.copy(end);pin.position.z-=.001;
    pin.name=`wall-pin-${i}`;wall.add(pin);
  }
  products.set('banner',{root:own('banner',wall),width:wallWidth,height:wallHeight,centre:wall.position.clone()});

  const profile=getCanvasProfile('a1','landscape');
  const canvasModel=createCanvasModel(profile,photos.canvas,reference);
  canvasModel.textures.forEach(texture=>textures.add(texture));
  const canvas=canvasModel.root,canvasScale=2.18/profile.width;
  canvas.scale.setScalar(canvasScale);
  // Front edge kept at the previous exhibition plane; all rear frame geometry remains intact.
  canvas.position.set(2.10,2.13,-2.99-profile.depth*canvasScale/2);
  canvas.name='Website wrapped canvas';canvas.userData.source='src/components/canvas-3d/model.ts';
  // The genuine manufacturing label is never replaced with an invented QR texture.
  canvas.getObjectByName('R&R manufacturing label').visible=reference.userData.authentic===true;
  products.set('canvas',{root:own('canvas',canvas),width:2.18,height:profile.height*canvasScale,centre:new T.Vector3(2.10,2.13,-2.99)});

  const rollup=createRollUpBannerModel(photos.rollup),rollScale=.94/BANNER.width;
  rollup.scale.setScalar(rollScale);rollup.rotation.y=-.13;
  rollup.updateMatrixWorld(true);
  const floorBounds=new T.Box3().setFromObject(rollup);
  // Derive floor contact from the actual swivel feet, not a guessed cassette centre.
  rollup.position.set(4.9,-floorBounds.min.y+.003,-1.90);
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
    return {id,source:root.userData.source,width,height,scale:root.scale.toArray(),min:bounds.min.toArray(),max:bounds.max.toArray(),eyeletInset:root.userData.eyeletInset,cordRadius:root.userData.cordRadius,parts};
  });
}
