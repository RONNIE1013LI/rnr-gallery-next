import * as T from 'three';

/** Restrained, deliberately blurred reflection on honed stone, rather than a mirror floor. */
export function createStoneReflection(renderer, scene, camera, floor, material) {
  const target = new T.WebGLRenderTarget(640, 360, { type: T.UnsignedByteType, depthBuffer: true });
  const virtual = new T.PerspectiveCamera();
  const projection = new T.Matrix4(), rotation = new T.Matrix4();
  const look = new T.Vector3(), up = new T.Vector3();
  const resolution = new T.Vector2(640, 360);
  material.userData.studioReflection = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.stoneReflection = { value: target.texture };
    shader.uniforms.stoneProjection = { value: projection };
    shader.uniforms.stoneResolution = { value: resolution };
    shader.vertexShader = 'uniform mat4 stoneProjection;varying vec4 vStoneProjection;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvStoneProjection=stoneProjection*modelMatrix*vec4(transformed,1.0);');
    shader.fragmentShader = 'uniform sampler2D stoneReflection;uniform vec2 stoneResolution;varying vec4 vStoneProjection;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec2 stoneUV=vStoneProjection.xy/vStoneProjection.w;
      vec3 reflectionColour=vec3(0.0);float reflectionWeight=0.0;
      for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++){
        float w=exp(-float(x*x+y*y)*.40);
        reflectionColour+=texture2D(stoneReflection,clamp(stoneUV+vec2(float(x),float(y))*3.5/stoneResolution,vec2(.001),vec2(.999))).rgb*w;reflectionWeight+=w;
      }
      float incidence=clamp(dot(normalize(vViewPosition),normal),0.0,1.0);
      float gloss=.035+.085*pow(1.0-incidence,4.0);
      vec3 reflectionValue=reflectionColour/max(.001,reflectionWeight);
      if(all(lessThan(abs(reflectionValue),vec3(100.0))))outgoingLight=mix(outgoingLight,reflectionValue,gloss);
      #include <opaque_fragment>
    `);
  };
  return {
    render() {
      const size=renderer.getSize(new T.Vector2());
      const h=Math.max(192,Math.min(600,Math.round(640*size.y/Math.max(1,size.x))));
      if(resolution.y!==h){target.setSize(640,h);resolution.set(640,h);}
      camera.updateMatrixWorld();virtual.copy(camera,false);rotation.extractRotation(camera.matrixWorld);
      look.set(0,0,-1).applyMatrix4(rotation).add(camera.position);look.y=-look.y;
      virtual.position.copy(camera.position);virtual.position.y=-virtual.position.y;
      up.set(0,1,0).applyMatrix4(rotation);up.y=-up.y;virtual.up.copy(up);virtual.lookAt(look);virtual.updateMatrixWorld();
      projection.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);
      const hidden=[];
      scene.traverse(o=>{if(o.visible&&o.isMesh&&(o===floor||(o.material?.transparent&&!o.material.depthWrite))){hidden.push(o);o.visible=false;}});
      const previous=renderer.getRenderTarget(),shadows=renderer.shadowMap.enabled;
      try{renderer.shadowMap.enabled=false;renderer.setRenderTarget(target);renderer.render(scene,virtual);}
      finally{hidden.forEach(o=>o.visible=true);renderer.shadowMap.enabled=shadows;renderer.setRenderTarget(previous);}
    },
    dispose(){target.dispose();},
  };
}
