import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createCanvasModel } from "./canvas-3d/model";
import { getCanvasProfile } from "./canvas-3d/profiles";
import { createRollUpBannerModel } from "./roll-up-banner-3d/model";
import { createFabricBannerModel } from "./fabric-banner-3d/model";
import type { PublicGalleryItem } from "@/server/gallery/public-gallery-service";

// One short-lived renderer, serial work, and 2D snapshots avoid a WebGL context per card.
let queue: Promise<void> = Promise.resolve();
let renderer: THREE.WebGLRenderer | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;

export function renderOccasionModel(source: HTMLImageElement, item: Pick<PublicGalleryItem, "productTypeSlug" | "width" | "height">, destination: () => HTMLCanvasElement | null): Promise<void> {
  const task = queue.then(async () => {
    if (!destination()) return;
    clearTimeout(idle);
    const scene = new THREE.Scene();
    const textures = new Set<THREE.Texture>();
    let environmentTarget: THREE.WebGLRenderTarget | undefined;
    try {
      renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const grave = item.productTypeSlug === "grave-cover";
      const rollUp = item.productTypeSlug === "roll-up-banner";
      const canvas = item.productTypeSlug === "canvas";
      const profile = getCanvasProfile("a1", item.width >= item.height ? "landscape" : "portrait")!;
      const width = canvas ? profile.width : rollUp ? .85 : grave ? 1 : 1.6;
      const height = canvas ? profile.height : rollUp || grave ? 2 : .8;
      const textureCanvas = document.createElement("canvas");
      textureCanvas.width = Math.round(1024 * width / Math.max(width, height));
      textureCanvas.height = Math.round(1024 * height / Math.max(width, height));
      const context = textureCanvas.getContext("2d");
      if (!context) throw new Error("Texture canvas unavailable");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
      const scale = Math.min(textureCanvas.width / source.naturalWidth, textureCanvas.height / source.naturalHeight);
      const fittedWidth = source.naturalWidth * scale, fittedHeight = source.naturalHeight * scale;
      context.drawImage(source, (textureCanvas.width - fittedWidth) / 2, (textureCanvas.height - fittedHeight) / 2, fittedWidth, fittedHeight);
      const artwork = new THREE.CanvasTexture(textureCanvas);
      artwork.colorSpace = THREE.SRGBColorSpace;
      textures.add(artwork);
      if (canvas) {
        const reference = await new THREE.TextureLoader().loadAsync("/canvas-3d/material-reference.jpg");
        reference.colorSpace = THREE.SRGBColorSpace;
        textures.add(reference);
        const model = createCanvasModel(profile, artwork, reference);
        model.textures.forEach((texture) => textures.add(texture));
        scene.add(model.root);
      } else {
        scene.add(rollUp ? createRollUpBannerModel(artwork) : createFabricBannerModel(grave ? "grave" : "wall", width, height, artwork));
      }
      const target = destination();
      if (!target) return;
      const aspect = grave ? .8 : Math.max(.6, Math.min(2, width / height));
      target.width = 640;
      target.height = Math.round(640 / aspect);
      renderer.setSize(target.width, target.height, false);
      const environment = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(renderer);
      environmentTarget = pmrem.fromScene(environment, .04);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = .7;
      environment.dispose(); pmrem.dispose();
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb4b5b8, 1.6));
      const light = new THREE.DirectionalLight(0xffffff, 2.1);
      light.position.set(-2, 4, 4); scene.add(light);
      const camera = new THREE.PerspectiveCamera(35, aspect, .005, 30);
      const fit = Math.max(height / 2 + .08, (width / 2 + .1) / aspect) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.15;
      camera.position.set(...(grave ? [.6, 1, .9] : [.38, .12, 1]) as [number, number, number]).normalize().multiplyScalar(fit);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      const output = target.getContext("2d");
      if (!output) throw new Error("Snapshot canvas unavailable");
      output.drawImage(renderer.domElement, 0, 0);
    } finally {
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      environmentTarget?.dispose();
      idle = setTimeout(() => { renderer?.dispose(); renderer?.forceContextLoss(); renderer = undefined; }, 1000);
    }
  });
  queue = task.catch(() => {});
  return task;
}
