import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { CanvasProfile } from "./profiles";

// Texture coordinates sample the original product-detail photo; no original portrait is baked into the rear.
export function createCanvasModel(profile: CanvasProfile, artwork: THREE.Texture, reference: THREE.Texture) {
  const root = new THREE.Group();
  root.name = "Canvas";
  const { width: w, height: h, depth: d, railWidth: r, braceWidth: bw, braceDepth: bd } = profile;
  const textures: THREE.Texture[] = [];
  // Both timber surfaces sample unchanged pixels from the supplied close-up photograph.
  // UVs are expressed in physical lengths, so grain is not stretched across an entire frame.
  function photoWood(kind:"rail"|"brace"){
    const map=reference.clone();map.needsUpdate=true;textures.push(map);
    const material=new THREE.MeshStandardMaterial({map,roughness:.9,color:0xffffff});
    material.onBeforeCompile=shader=>{
      const sample=kind==="rail"
        ? `vec2 timberUV=1.0-abs(1.0-mod(vMapUv,2.0));
           float px=mix(30.0,1780.0,timberUV.y);
           float py=mix(mix(693.0,627.0,timberUV.y),mix(754.0,703.0,timberUV.y),timberUV.x);
           vec4 sampledDiffuseColor=texture2D(map,vec2(px/1824.0,1.0-py/1368.0));`
        : `vec2 timberUV=1.0-abs(1.0-mod(vMapUv,2.0));
           vec4 sampledDiffuseColor=texture2D(map,vec2(mix(938.0,1193.0,timberUV.x)/1824.0,1.0-mix(34.0,540.0,timberUV.y)/1368.0));`;
      shader.fragmentShader=shader.fragmentShader.replace("#include <map_fragment>",THREE.ShaderChunk.map_fragment.replace("vec4 sampledDiffuseColor = texture2D( map, vMapUv );",sample));
    };
    material.customProgramCacheKey=()=>`photographic-timber-${kind}`;
    return material;
  }
  const wood=photoWood("brace"),railWood=photoWood("rail");
  const white=new THREE.MeshStandardMaterial({color:0xeeeae0,roughness:.96});
  const metal=new THREE.MeshStandardMaterial({color:0xa8aaa4,metalness:.75,roughness:.48});
  function box(name:string,x:number,y:number,z:number,width:number,height:number,depth:number,mat:THREE.Material) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),mat);
    if(mat===wood){
      const position=mesh.geometry.attributes.position,normal=mesh.geometry.attributes.normal,uv=mesh.geometry.attributes.uv;
      const horizontal=width>height;
      for(let i=0;i<position.count;i++){
        const along=horizontal?position.getX(i):position.getY(i);
        const across=Math.abs(normal.getZ(i))>.5?(horizontal?position.getY(i):position.getX(i)):position.getZ(i);
        uv.setXY(i,across/.029+.5,along/.058+.37);
      }
    }
    mesh.position.set(x,y,z);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;
  }
  // Mitred stretcher rails: 30 mm at the outer lip, 20 mm at the inner edge.
  const ox=w/2-.002,oy=h/2-.002,ix=w/2-r+.002,iy=h/2-r+.002;
  function rail(name:string,points:number[][]){
    const horizontal=name==="Top rail"||name==="Bottom rail";
    const shape=new THREE.Shape();
    points.forEach(([x,y],i)=>{if(i===0)shape.moveTo(x,y);else shape.lineTo(x,y);});shape.closePath();
    // The new reference reveals small open mortise slots beside the corner seam.
    if(horizontal){
      const sy=name==="Top rail"?1:-1;
      for(const sx of [-1,1]){
        const cx=sx*(ix+.0015),cy=sy*(iy+.0035),half=.001;
        const hole=new THREE.Path();hole.moveTo(cx-half,cy-half);hole.lineTo(cx-half,cy+half);hole.lineTo(cx+half,cy+half);hole.lineTo(cx+half,cy-half);hole.closePath();shape.holes.push(hole);
        const floor=box("Mortise recess floor",cx,cy,-d/2+.004,.002,.002,.0005,railWood);
        floor.userData.approximate=true;
      }
    }
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:false,steps:1});
    geometry.translate(0,0,-d/2);
    const vertices=geometry.attributes.position;
    for(let i=0;i<vertices.count;i++){
      if(vertices.getZ(i)>0){
        const inset=horizontal?oy-Math.abs(vertices.getY(i)):ox-Math.abs(vertices.getX(i));
        const t=THREE.MathUtils.clamp(inset/(r-.004),0,1);
        vertices.setZ(i,d/2-.0006-t*(d-.02-.0006));
      }
    }
    geometry.computeVertexNormals();
    geometry.userData={outerDepth:d,innerDepth:.02,canvasClearance:d-.02};
    // Preserve wood texture density independently of the trapezoid's world coordinates.
    const position=geometry.attributes.position,uv=geometry.attributes.uv;
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i);
      // Grain follows each rail independently, exposing the diagonal join naturally.
      const across=(Math.abs(geometry.attributes.normal.getZ(i))>.5?(horizontal?oy-Math.abs(y):ox-Math.abs(x)):position.getZ(i)+d/2)/.008;
      const along=(horizontal?x+ox:y+oy)/.20+(name==="Bottom rail"||name==="Left rail"?.31:0);
      uv.setXY(i,across,along);
    }
    const mesh=new THREE.Mesh(geometry,railWood);mesh.name=name;
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  rail("Top rail",[[-ox,oy],[ox,oy],[ix,iy],[-ix,iy]]);
  rail("Bottom rail",[[-ox,-oy],[-ix,-iy],[ix,-iy],[ox,-oy]]);
  rail("Left rail",[[-ox,-oy],[-ox,oy],[-ix,iy],[-ix,-iy]]);
  rail("Right rail",[[ox,-oy],[ix,-iy],[ix,iy],[ox,oy]]);
  const jointMaterial=new THREE.MeshStandardMaterial({color:0x625542,roughness:1,transparent:true,opacity:.65});
  for(const sx of [-1,1])for(const sy of [-1,1]){
    const path=new THREE.LineCurve3(new THREE.Vector3(sx*ox,sy*oy,-d/2-.0001),new THREE.Vector3(sx*ix,sy*iy,-d/2-.0001));
    const joint=new THREE.Mesh(new THREE.TubeGeometry(path,1,.00012,4,false),jointMaterial);
    joint.name="45-degree timber joint";root.add(joint);
  }
  // Neutral procedural weave avoids repeating the reference's lighting bands or original portrait.
  const weaveBytes=new Uint8Array(64*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const i=(y*64+x)*4;
    const value=128+Math.round(24*Math.sin(x*Math.PI/4)*Math.cos(y*Math.PI/4));
    weaveBytes[i]=weaveBytes[i+1]=weaveBytes[i+2]=value;weaveBytes[i+3]=255;
  }
  const weave=new THREE.DataTexture(weaveBytes,64,64);
  weave.wrapS=weave.wrapT=THREE.RepeatWrapping;weave.repeat.set(w*300,h*300);
  weave.magFilter=THREE.LinearFilter;weave.minFilter=THREE.LinearMipmapLinearFilter;weave.generateMipmaps=true;weave.needsUpdate=true;textures.push(weave);
  const cloth=new THREE.MeshStandardMaterial({color:0xecebe6,bumpMap:weave,bumpScale:.00005,roughness:1});
  box("Recessed canvas",0,0,d/2-.0003,w-.008,h-.008,.0002,cloth);
  // One continuous rounded skin carries the image from face onto the wrapped sides.
  // 2 mm corner radius approximates the photographed fabric-over-timber edge.
  const image=artwork.image as {width:number;height:number};
  const ratio=image.width/image.height;
  const aw=Math.min(w,h*ratio), ah=aw/ratio;
  const matches=Math.abs(ratio-w/h)/(w/h)<.025;
  const picture=new THREE.MeshPhysicalMaterial({map:artwork,roughness:.84,metalness:0,bumpMap:weave,bumpScale:.000045,sheen:.12,sheenRoughness:.9,sheenColor:0xffffff});
  picture.onBeforeCompile=(shader)=>{
    const mapChunk=THREE.ShaderChunk.map_fragment.replace(
      "vec4 sampledDiffuseColor = texture2D( map, vMapUv );",
      matches
        ? "vec2 canvasUV = 1.0 - abs(1.0 - mod(vMapUv, 2.0)); vec4 sampledDiffuseColor = texture2D(map, canvasUV);"
        : "vec4 sampledDiffuseColor = texture2D( map, vMapUv ); if (vMapUv.x < 0.0 || vMapUv.x > 1.0 || vMapUv.y < 0.0 || vMapUv.y > 1.0) sampledDiffuseColor = vec4(1.0);",
    );
    shader.fragmentShader=shader.fragmentShader.replace("#include <map_fragment>",mapChunk);
  };
  picture.customProgramCacheKey=()=>`contained-canvas-artwork-${matches}`;
  const shellGeometry=new RoundedBoxGeometry(w,h,d,5,.002);
  const positions=shellGeometry.attributes.position,uv=shellGeometry.attributes.uv;
  // A single position-based mapping gives duplicated seam vertices identical UVs.
  // Separate per-face mappings introduce a visible jump across the rounded shoulder.
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),y=positions.getY(i);
    const inward=Math.max(0,d/2-positions.getZ(i));
    const wx=THREE.MathUtils.smoothstep(Math.abs(x),w/2-.006,w/2-.002);
    const wy=THREE.MathUtils.smoothstep(Math.abs(y),h/2-.006,h/2-.002);
    uv.setXY(i,(x-Math.sign(x)*inward*wx)/aw+.5,(y-Math.sign(y)*inward*wy)/ah+.5);
  }
  // Keep the rear shoulder, trimming only the open centre. Deleting the whole rear
  // material group also deleted half of the rounded edge and left a visible slit.
  const rearGroup=shellGeometry.groups.find(group=>group.materialIndex===5)!;
  const bridgeVertices:number[]=[];
  function clipPolygon(polygon:THREE.Vector3[],axis:"x"|"y",limit:number,greater:boolean){
    const result:THREE.Vector3[]=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      const insideA=greater?a[axis]>=limit:a[axis]<=limit;
      const insideB=greater?b[axis]>=limit:b[axis]<=limit;
      if(insideA)result.push(a);
      if(insideA!==insideB)result.push(a.clone().lerp(b,(limit-a[axis])/(b[axis]-a[axis])));
    }
    return result;
  }
  const innerX=w/2-.018,innerY=h/2-.018;
  for(let i=rearGroup.start;i<rearGroup.start+rearGroup.count;i+=3){
    const triangle=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,i+j));
    const middle=clipPolygon(clipPolygon(triangle,"y",-innerY,true),"y",innerY,false);
    const strips=[clipPolygon(triangle,"y",innerY,true),clipPolygon(triangle,"y",-innerY,false),clipPolygon(middle,"x",innerX,true),clipPolygon(middle,"x",-innerX,false)];
    for(const polygon of strips)for(let j=1;j<polygon.length-1;j++){
      for(const point of [polygon[0],polygon[j],polygon[j+1]])bridgeVertices.push(point.x,point.y,point.z);
    }
  }
  const bridgeGeometry=new THREE.BufferGeometry();
  bridgeGeometry.setAttribute("position",new THREE.Float32BufferAttribute(bridgeVertices,3));
  const bridgeUV:number[]=[],bridgeNormals:number[]=[];
  for(let i=0;i<bridgeVertices.length;i+=3){
    const [x,y,z]=bridgeVertices.slice(i,i+3);
    const inward=Math.max(0,d/2-z);
    bridgeUV.push((x-Math.sign(x)*inward*THREE.MathUtils.smoothstep(Math.abs(x),w/2-.006,w/2-.002))/aw+.5,(y-Math.sign(y)*inward*THREE.MathUtils.smoothstep(Math.abs(y),h/2-.006,h/2-.002))/ah+.5);
    const normal=new THREE.Vector3(x-THREE.MathUtils.clamp(x,-w/2+.002,w/2-.002),y-THREE.MathUtils.clamp(y,-h/2+.002,h/2-.002),z-THREE.MathUtils.clamp(z,-d/2+.002,d/2-.002)).normalize();
    bridgeNormals.push(normal.x,normal.y,normal.z);
  }
  bridgeGeometry.setAttribute("uv",new THREE.Float32BufferAttribute(bridgeUV,2));
  bridgeGeometry.setAttribute("normal",new THREE.Float32BufferAttribute(bridgeNormals,3));
  const bridge=new THREE.Mesh(bridgeGeometry,picture);bridge.name="Continuous rear wrap shoulder";bridge.castShadow=true;bridge.receiveShadow=true;root.add(bridge);
  shellGeometry.groups=shellGeometry.groups.filter(group=>group.materialIndex!==5);
  const shell=new THREE.Mesh(shellGeometry,[picture,picture,picture,picture,picture,white]);
  shell.name="Wrapped canvas shell";shell.castShadow=true;shell.receiveShadow=true;root.add(shell);
  const foldLineMaterial=new THREE.MeshStandardMaterial({color:0x514b43,roughness:1,transparent:true,opacity:.2});
  for(const sx of [-1,1])for(const sy of [-1,1]){
    const curve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx*(w/2-.0019),sy*(h/2-.0001),d/2-.004),
      new THREE.Vector3(sx*(w/2-.001),sy*(h/2-.0002),-.003),
      new THREE.Vector3(sx*(w/2-.002),sy*(h/2-.001),-d/2+.002),
    ]);
    const seam=new THREE.Mesh(new THREE.TubeGeometry(curve,12,.00013,4,false),foldLineMaterial);
    seam.name="Folded corner seam";root.add(seam);
  }
  // Printed fabric returns onto the rear; the unprinted selvage peeks out inside it.
  const fold=.027, printedFold=.018, rz=-d/2-.00002;
  white.bumpMap=weave;white.bumpScale=.00009;
  box("Top folded canvas",0,h/2-(fold+printedFold)/2,rz,w-2*printedFold,fold-printedFold,.00035,white);
  box("Bottom folded canvas",0,-h/2+(fold+printedFold)/2,rz,w-2*printedFold,fold-printedFold,.00035,white);
  box("Left folded canvas",-w/2+(fold+printedFold)/2,0,rz,fold-printedFold,h-2*fold,.00035,white);
  box("Right folded canvas",w/2-(fold+printedFold)/2,0,rz,fold-printedFold,h-2*fold,.00035,white);
  const returnMaterial=picture.clone();
  returnMaterial.side=THREE.DoubleSide;
  returnMaterial.onBeforeCompile=picture.onBeforeCompile;
  returnMaterial.customProgramCacheKey=picture.customProgramCacheKey;
  // Each return is a curved cloth strip rather than a squared-off solid block.
  function rearStrip(name:string,sx:number,sy:number,corner=false){
    const horizontal=sy!==0;
    const length=corner?printedFold:(horizontal?w-.002:h-2*printedFold);
    const geometry=new THREE.PlaneGeometry(length,printedFold,24,12);
    const position=geometry.attributes.position,texcoord=geometry.attributes.uv;
    for(let i=0;i<position.count;i++){
      const along=position.getX(i),inward=position.getY(i)+printedFold/2;
      let x=horizontal?along:sx*(w/2-inward);
      const y=horizontal?sy*(h/2-inward):along;
      if(corner)x=sx*(w/2-printedFold/2)+along;
      // Rounded outer roll and a raised lip on the overlapping corner flap.
      const roll=.00012*Math.exp(-inward/.0012);
      const lip=corner?.00065*Math.sin(Math.PI*inward/printedFold):0;
      const z=rz-.00042+roll-lip;
      position.setXYZ(i,x,y,z);
      const sampleX=horizontal?x:sx*(w/2-d-inward);
      const sampleY=horizontal?sy*(h/2-d-inward):y;
      texcoord.setXY(i,sampleX/aw+.5,sampleY/ah+.5);
    }
    geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,returnMaterial);mesh.name=name;
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  rearStrip("Top printed return",0,1);rearStrip("Bottom printed return",0,-1);
  rearStrip("Left printed return",-1,0);rearStrip("Right printed return",1,0);
  for(const sx of [-1,1])for(const sy of [-1,1]){
    rearStrip("Overlapping rear corner",sx,sy,true);
    // A curved tucked edge ends at the white selvage, where three staples pin both layers.
    const points=[
      new THREE.Vector3(sx*(w/2-.001),sy*(h/2-.0175),rz-.0006),
      new THREE.Vector3(sx*(w/2-.009),sy*(h/2-.018),rz-.0009),
      new THREE.Vector3(sx*(w/2-.016),sy*(h/2-.019),rz-.0009),
      new THREE.Vector3(sx*(w/2-.019),sy*(h/2-.023),rz-.0005),
    ];
    const edge=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),18,.00022,6,false),foldLineMaterial);
    edge.name="Rear tucked fold";root.add(edge);
  }
  // Reach 1 mm into the actual rail opening, eliminating background slivers at joints.
  const clearWidth=2*ix,clearHeight=2*iy,engagement=.001;
  const bz=-d/2+bd/2;
  if(profile.braces==="cross"){
    box("Horizontal brace",0,0,bz,clearWidth+2*engagement,bw,bd,wood);
    // Split the vertical at the centre, representing the flush half-lap joint without coplanar overlaps.
    const len=(clearHeight-bw)/2+engagement;
    box("Upper vertical brace",0,(bw+len)/2,bz,bw,len,bd,wood);
    box("Lower vertical brace",0,-(bw+len)/2,bz,bw,len,bd,wood);
  } else if(profile.braces==="single"){
    if(w>=h)box("Short central brace",0,0,bz,bw,clearHeight+2*engagement,bd,wood);
    else box("Short central brace",0,0,bz,clearWidth+2*engagement,bw,bd,wood);
  }
  const placements:{x:number;y:number;angle:number}[]=[];
  for(const sign of [-1,1]){
    const nx=Math.max(2,Math.floor(w/.23)),ny=Math.max(2,Math.floor(h/.23));
    for(let i=1;i<nx;i++)placements.push({x:-w/2+w*i/nx,y:sign*(h/2-.023),angle:0});
    for(let i=1;i<ny;i++)placements.push({x:sign*(w/2-.023),y:-h/2+h*i/ny,angle:Math.PI/2});
    for(const sx of [-1,1])for(let j=0;j<3;j++)placements.push({x:sx*(w/2-.019-j*.0035),y:sign*(h/2-.019-j*.0035),angle:-sx*sign*Math.PI/4});
  }
  // Curved staple crown with two short legs pressed into the folded fabric.
  const staplePath=new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.004,0,.00065),new THREE.Vector3(-.0038,0,0),
    new THREE.Vector3(0,0,-.00012),new THREE.Vector3(.0038,0,0),new THREE.Vector3(.004,0,.00065),
  ]);
  const staples=new THREE.InstancedMesh(new THREE.TubeGeometry(staplePath,16,.00023,6,false),metal,placements.length);
  const transform=new THREE.Object3D();
  placements.forEach((p,i)=>{transform.position.set(p.x,p.y,rz-.0008);transform.rotation.set(0,0,p.angle);transform.updateMatrix();staples.setMatrixAt(i,transform.matrix);});
  staples.name="Staples";root.add(staples);
  // Exact printed label from the detail reference, including its original QR pattern.
  const logoGeo=new THREE.PlaneGeometry(.073,.02,12,4);
  const logoUV=logoGeo.attributes.uv;
  for(let i=0;i<logoUV.count;i++){
    const u=logoUV.getX(i),v=1-logoUV.getY(i);
    const x=(790*(1-u)+1385*u)*(1-v)+(790*(1-u)+1393*u)*v;
    const y=(756*(1-u)+737*u)*(1-v)+(920*(1-u)+900*u)*v;
    logoUV.setXY(i,x/1824,1-y/1368);
  }
  const logo=new THREE.Mesh(logoGeo,new THREE.MeshBasicMaterial({map:reference}));
  logo.rotation.y=Math.PI;logo.position.set(0,-h/2+.011,rz-.0008);logo.name="R&R manufacturing label";root.add(logo);
  root.userData={...profile,artworkFits:matches,braceCount:profile.braces==="cross"?2:profile.braces==="single"?1:0};
  return {root,textures};
}
