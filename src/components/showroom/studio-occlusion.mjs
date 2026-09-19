import * as T from 'three';

/** Screen-space contact occlusion. All passes stay local; no scene or UI is replaced by an image. */
export function createStudioOcclusion(renderer, scene, camera, materials) {
  const targetOptions = { minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: true };
  const depthTarget = new T.WebGLRenderTarget(1, 1, targetOptions);
  depthTarget.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
  const aoTarget = new T.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const blurTarget = new T.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const resolution = new T.Vector2(1, 1), fullResolution = new T.Vector2(1, 1);
  const depthMaterial = new T.MeshDepthMaterial();
  const fullscreen = new T.Scene(), passCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new T.PlaneGeometry(2, 2);
  const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
  const reconstruct = `
    vec3 viewPoint(vec2 uv){float d=texture2D(depthTex,uv).x;vec4 p=inverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);return p.xyz/p.w;}
  `;
  const aoMaterial = new T.ShaderMaterial({
    uniforms: { depthTex: { value: depthTarget.depthTexture }, inverseProjection: { value: camera.projectionMatrixInverse }, resolution: { value: resolution }, projectionScale: { value: 1 } },
    vertexShader,
    fragmentShader: `
      varying vec2 vUv;uniform sampler2D depthTex;uniform mat4 inverseProjection;uniform vec2 resolution;uniform float projectionScale;
      ${reconstruct}
      void main(){
        vec3 p=viewPoint(vUv);if(p.z< -50.0){gl_FragColor=vec4(1.0);return;}
        vec3 dx=dFdx(p),dy=dFdy(p),n=normalize(cross(dx,dy));if(dot(n,-p)<0.0)n=-n;
        float radius=.24,occ=0.0;
        float screenRadius=clamp(projectionScale*radius/max(.1,-p.z),.001,.20);
        for(int i=0;i<24;i++){
          float k=float(i),a=k*2.39996323,r=sqrt((k+.5)/24.0);
          vec2 delta=vec2(cos(a)*resolution.y/resolution.x,sin(a))*screenRadius*r;
          vec3 v=viewPoint(clamp(vUv+delta,vec2(.001),vec2(.999)))-p;
          float dist=length(v);
          float visible=clamp((dot(n,v)-.014)/max(.02,dist),0.0,1.0);
          occ+=visible*(1.0-smoothstep(.02,radius*1.5,dist));
        }
        float ao=clamp(1.0-occ*.11,.60,1.0);gl_FragColor=vec4(vec3(ao),1.0);
      }`, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const blurMaterial = new T.ShaderMaterial({
    uniforms: { depthTex: { value: depthTarget.depthTexture }, aoTex: { value: aoTarget.texture }, inverseProjection: { value: camera.projectionMatrixInverse }, resolution: { value: resolution } },
    vertexShader,
    fragmentShader: `
      varying vec2 vUv;uniform sampler2D depthTex,aoTex;uniform mat4 inverseProjection;uniform vec2 resolution;
      ${reconstruct}
      void main(){float center=viewPoint(vUv).z,total=0.0,weight=0.0;
        for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++){
          vec2 q=vUv+vec2(float(x),float(y))/resolution;float z=viewPoint(q).z;
          float w=exp(-float(x*x+y*y)*.35)*exp(-abs(z-center)*10.0);
          total+=texture2D(aoTex,q).r*w;weight+=w;
        }gl_FragColor=vec4(vec3(total/max(.0001,weight)),1.0);
      }`, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new T.Mesh(geometry, aoMaterial); fullscreen.add(quad);
  const enabled = { value: 1 };
  for (const m of materials) {
    if (!m.isMeshStandardMaterial) continue;
    const oldHook = m.onBeforeCompile;
    const originalProgramKey = m.customProgramCacheKey();
    m.onBeforeCompile = shader => {
      oldHook.call(m, shader);
      shader.uniforms.studioAO = { value: blurTarget.texture };
      shader.uniforms.studioResolution = { value: fullResolution };
      shader.uniforms.studioAOEnabled = enabled;
      shader.fragmentShader = 'uniform sampler2D studioAO;uniform vec2 studioResolution;uniform float studioAOEnabled;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float contactAO=mix(1.0,texture2D(studioAO,gl_FragCoord.xy/studioResolution).r,studioAOEnabled);
        reflectedLight.indirectDiffuse*=contactAO;
        reflectedLight.directDiffuse*=mix(1.0,contactAO,.40);
        reflectedLight.indirectSpecular*=mix(1.0,contactAO,.40);
      `);
    };
    m.customProgramCacheKey = () => originalProgramKey+'|rnr-studio-contact-ao-v2-'+Boolean(m.userData.studioReflection);
  }
  let width = 0, height = 0;
  return {
    setEnabled(value) { enabled.value = value ? 1 : 0; },
    render() {
      renderer.getDrawingBufferSize(fullResolution);
      const w = Math.max(1, Math.round(fullResolution.x * .65)), h = Math.max(1, Math.round(fullResolution.y * .65));
      if (w !== width || h !== height) {
        width = w; height = h; resolution.set(w, h);depthTarget.setSize(w,h);aoTarget.setSize(w,h);blurTarget.setSize(w,h);
      }
      camera.updateMatrixWorld(); camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      aoMaterial.uniforms.projectionScale.value = camera.projectionMatrix.elements[5] * .5;
      const oldTarget = renderer.getRenderTarget(), oldOverride = scene.overrideMaterial;
      const oldShadows = renderer.shadowMap.enabled;
      enabled.value = 0;
      const hidden=[];scene.traverse(o=>{if(o.visible&&o.isMesh&&o.material?.transparent&&!o.material.depthWrite){hidden.push(o);o.visible=false;}});
      try {
        // Contact-occlusion depth does not need additional shadow renders.
        renderer.shadowMap.enabled = false;scene.overrideMaterial=depthMaterial;
        renderer.setRenderTarget(depthTarget);renderer.render(scene,camera);scene.overrideMaterial=oldOverride;
        quad.material=aoMaterial;renderer.setRenderTarget(aoTarget);renderer.render(fullscreen,passCamera);
        quad.material=blurMaterial;renderer.setRenderTarget(blurTarget);renderer.render(fullscreen,passCamera);
      } finally {
        hidden.forEach(o=>o.visible=true);renderer.shadowMap.enabled=oldShadows;scene.overrideMaterial=oldOverride;renderer.setRenderTarget(oldTarget);enabled.value=1;
      }
      renderer.render(scene,camera);
    },
    dispose() { depthTarget.depthTexture.dispose();depthTarget.dispose();aoTarget.dispose();blurTarget.dispose();depthMaterial.dispose();aoMaterial.dispose();blurMaterial.dispose();geometry.dispose(); },
  };
}
