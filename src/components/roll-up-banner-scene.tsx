"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createRollUpBannerModel } from "./roll-up-banner-3d/model";
import styles from "./canvas-product-preview.module.css";

type Actions = { view: (name: string) => void; zoom: (factor: number) => void; rotate: () => boolean };
export default function RollUpBannerScene({ imageSrc }: { imageSrc: string }) {
  const host = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), actions = useRef<Actions | null>(null);
  const [status, setStatus] = useState("Loading 3D preview…"), [auto, setAuto] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { queueMicrotask(() => setStatus("3D is unavailable in this browser. Close 3D view to return to the artwork image.")); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .005, 30);
    const environment = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(environment, .04);
    scene.environment = envTarget.texture; scene.environmentIntensity = .7;
    environment.dispose(); pmrem.dispose();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false; controls.autoRotateSpeed = .8;
    controls.minPolarAngle = .1; controls.maxPolarAngle = Math.PI - .1;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb4b5b8, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-2, 4, 4); scene.add(key);
    const rearLight = new THREE.DirectionalLight(0xffffff, 1.5); rearLight.position.set(-2, 3, -4); scene.add(rearLight);
    const bottomLight = new THREE.DirectionalLight(0xffffff, 1.2); bottomLight.position.set(-1, -3, 2); scene.add(bottomLight);
    const shadowCanvas = document.createElement("canvas"); shadowCanvas.width = shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext("2d")!;
    const gradient = shadowContext.createRadialGradient(64, 64, 8, 64, 64, 64);
    gradient.addColorStop(0, "rgba(40,45,42,.22)"); gradient.addColorStop(1, "rgba(40,45,42,0)");
    shadowContext.fillStyle = gradient; shadowContext.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1.25, .56), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.087; scene.add(floor);
    let alive = true, visible = true, frame = 0, lastTime = 0, fit = 4;
    const textures = new Set<THREE.Texture>([shadowTexture]);
    function invalidate() { if (alive && visible && !document.hidden && !frame) frame = requestAnimationFrame(draw); }
    function draw(time: number) {
      frame = 0; if (!alive || !visible || document.hidden) return;
      controls.update(Math.min((time - lastTime) / 1000, .05)); lastTime = time; renderer.render(scene, camera);
      if (controls.autoRotate) invalidate();
    }
    controls.addEventListener("change", invalidate);
    function resize() {
      const { width, height } = element!.getBoundingClientRect(); if (!width || !height) return;
      const previousFit = fit;
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
      fit = Math.max(1.09, .48 / camera.aspect) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.19;
      controls.minDistance = .12; controls.maxDistance = fit * 3;
      camera.position.sub(controls.target).multiplyScalar(fit / previousFit).add(controls.target);
      controls.update(); invalidate();
    }
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; invalidate(); }); intersection.observe(element);
    document.addEventListener("visibilitychange", invalidate);
    const lost = (event: Event) => { event.preventDefault(); if (alive) setStatus("3D paused. Close and reopen the 3D view to try again."); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    async function load() {
      let artwork: THREE.Texture | undefined;
      if (imageSrc) {
        artwork = await new THREE.TextureLoader().loadAsync(imageSrc);
        textures.add(artwork);
        if (!alive) { artwork.dispose(); return; }
        artwork.colorSpace = THREE.SRGBColorSpace;
        artwork.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        // Fit the whole original artwork without stretching or cropping if an older design differs in ratio.
        const image = artwork.image as HTMLImageElement;
        const imageAspect = image.width / image.height, printAspect = .85 / 2;
        if (Math.abs(imageAspect / printAspect - 1) > .005) {
          const canvas = document.createElement("canvas"); canvas.width = 850; canvas.height = 2000;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Texture canvas unavailable");
          context.fillStyle = "#fff"; context.fillRect(0, 0, 850, 2000);
          const scale = Math.min(850 / image.width, 2000 / image.height);
          const width = image.width * scale, height = image.height * scale;
          context.drawImage(image, (850 - width) / 2, (2000 - height) / 2, width, height);
          artwork = new THREE.CanvasTexture(canvas); artwork.colorSpace = THREE.SRGBColorSpace;
          artwork.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); textures.add(artwork);
        }
      }
      if (!alive) return;
      scene.add(createRollUpBannerModel(artwork));
      function view(name: string) {
        controls.autoRotate = false; setAuto(false); controls.enableDamping = false; controls.update();
        controls.target.set(0, -.02, 0);
        const poses: Record<string, number[]> = { front: [0, 0, 1], back: [0, 0, -1], side: [1, .03, .05], reset: [.38, .1, 1] };
        camera.position.fromArray(poses[name] ?? poses.reset).normalize().multiplyScalar(fit).add(controls.target);
        if (name === "base") { controls.target.set(0, -1.025, 0); camera.position.copy(controls.target).add(new THREE.Vector3(.58, .33, .85)); }
        if (name === "rear-base") { controls.target.set(0, -1.032, -.03); camera.position.copy(controls.target).add(new THREE.Vector3(.22, .2, -1.05)); }
        if (name === "end-cap") { controls.target.set(.446, -1.037, -.012); camera.position.copy(controls.target).add(new THREE.Vector3(.29, .09, -.05)); }
        if (name === "underside") { controls.target.set(0, -1.076, -.012); camera.position.copy(controls.target).add(new THREE.Vector3(.3, -.87, .46)); }
        if (name === "top") { controls.target.set(0, 1.015, .01); camera.position.copy(controls.target).add(new THREE.Vector3(.17, .1, -.38)); }
        controls.update(); controls.enableDamping = true; invalidate();
      }
      actions.current = {
        view,
        zoom(factor) { camera.position.sub(controls.target).multiplyScalar(factor).clampLength(controls.minDistance, controls.maxDistance).add(controls.target); controls.update(); invalidate(); },
        rotate() { controls.autoRotate = !controls.autoRotate; invalidate(); return controls.autoRotate; },
      };
      resize(); view("reset"); setStatus(""); element!.dataset.ready = "true";
      element!.dataset.artwork = imageSrc; element!.dataset.dimensions = "85 × 200 cm";
    }
    void load().catch(() => { if (alive) setStatus("Could not load the 3D preview. Close and reopen to retry, or close 3D view to see the artwork image."); });
    return () => {
      alive = false; actions.current = null; cancelAnimationFrame(frame);
      resizeObserver.disconnect(); intersection.disconnect(); document.removeEventListener("visibilitychange", invalidate);
      renderer.domElement.removeEventListener("webglcontextlost", lost); controls.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      scene.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m); } });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
      key.shadow.map?.dispose(); envTarget.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [imageSrc]);
  return <div ref={panel} className={styles.panel}>
    <p className={styles.dimensions}>Roll-Up Banner · 85 × 200 cm</p>
    <div ref={host} className={styles.stage} title="Interactive roll-up banner preview" role="application" aria-label="Interactive roll-up banner. Drag to rotate; scroll or pinch to zoom." tabIndex={0} onKeyDown={event => {
      if (event.key === "+" || event.key === "=") { event.preventDefault(); actions.current?.zoom(.85); }
      if (event.key === "-") { event.preventDefault(); actions.current?.zoom(1 / .85); }
    }} />
    {status && <p className={styles.status} role="status">{status}</p>}
    <div className={styles.controls} role="group" aria-label="3D view controls">
      {[["front", "Front"], ["back", "Back"], ["side", "Side"], ["base", "Base detail"], ["rear-base", "Back base detail"], ["reset", "Reset"]].map(([name, label]) => <button type="button" key={name} data-mobile-primary={["front", "back", "reset"].includes(name) || undefined} disabled={!!status} onClick={() => actions.current?.view(name)}>{label}</button>)}
      <button type="button" disabled={!!status} aria-pressed={auto} onClick={() => setAuto(actions.current?.rotate() ?? false)}>Rotate</button>
      <button type="button" disabled={!!status} data-mobile-primary aria-label="Zoom in" onClick={() => actions.current?.zoom(.85)}>＋</button>
      <button type="button" disabled={!!status} data-mobile-primary aria-label="Zoom out" onClick={() => actions.current?.zoom(1 / .85)}>−</button>
      <button type="button" disabled={!!status} data-mobile-primary aria-label="Fullscreen 3D" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void panel.current?.requestFullscreen?.().catch(() => {}); }}>⛶</button>
    </div>
    <p className={styles.caption}>Drag to rotate · Scroll or pinch to zoom<br />{imageSrc ? "Artwork shown without cropping. Stand details are indicative." : "Choose a banner design to preview your artwork on the stand."}</p>
  </div>;
}
