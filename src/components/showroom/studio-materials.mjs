import * as T from 'three';

/** Deterministic, locally generated material maps. No CDN, network or font dependency. */
export function createStudioMaterials(renderer, resources) {
  const { materials, textures } = resources;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const clamp = (x, a = 0, b = 255) => Math.min(b, Math.max(a, x));
  const fract = x => x - Math.floor(x);
  const hash = (x, y, seed = 1) => fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
  function noise(x, y, seed = 1) {
    const ix = Math.floor(x), iy = Math.floor(y), a = x - ix, b = y - iy;
    const u = a * a * (3 - 2 * a), v = b * b * (3 - 2 * b);
    const p = hash(ix, iy, seed), q = hash(ix + 1, iy, seed);
    const r = hash(ix, iy + 1, seed), s = hash(ix + 1, iy + 1, seed);
    return (p + (q - p) * u) * (1 - v) + (r + (s - r) * u) * v;
  }
  function makeMap(kind, channel, size = 512) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Material canvas unavailable.');
    const image = ctx.createImageData(size, size), data = image.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, fine = hash(x, y, 9) - .5;
      const cloud = noise(u * 7, v * 7, 3) - .5;
      let rgb, height = .5, rough = .95;
      if (kind === 'plaster') {
        const t = cloud * 3.0 + (noise(u * 50, v * 50, 2) - .5) * 2 + fine * 2;
        rgb = [232 + t, 227 + t, 216 + t]; height = .5 + fine * .24 + cloud * .06; rough = .97 + cloud * .025;
      } else if (kind === 'limestone') {
        const drift = noise(u * 3, v * 4, 14), vein = noise(u * 8 + drift * 2, v * 65, 5);
        const pore = Math.pow(Math.max(0, noise(u * 150, v * 160, 8) - .56) * 2.2, 2);
        const t = cloud * 7 + (vein - .5) * 5 + fine * 1.3 - pore * 14;
        rgb = [216 + t, 206 + t, 189 + t]; height = .5 + (vein - .5) * .09 - pore * .10 + fine * .015; rough = .9 + cloud * .06;
      } else if (kind === 'walnut') {
        const drift = noise(u * 3, v * 5, 11) * 2.2;
        const grain = noise(u * 75 + drift, v * 2.1, 19), long = noise(u * 18 + drift, v * .7, 21);
        const t = (grain - .5) * 13 + (long - .5) * 15 + fine * 1.2;
        rgb = [101 + t, 78 + t * .8, 57 + t * .65]; height = .5 + (grain - .5) * .10; rough = .83 + (grain - .5) * .08;
      } else if (kind === 'linen') {
        const thread = Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2);
        const t = thread * 4 + fine * 2 + cloud * 3;
        rgb = [205 + t, 193 + t, 174 + t]; height = .5 + thread * .28 + fine * .08; rough = .99;
      } else {
        const stroke = noise(u * 220, v * 1.2, 17) - .5;
        rgb = [185 + stroke * 6, 187 + stroke * 6, 184 + stroke * 6]; height = .5 + stroke * .10; rough = .6 + stroke * .08;
      }
      const n = (y * size + x) * 4;
      if (channel === 'height') data[n] = data[n + 1] = data[n + 2] = clamp(height * 255);
      else if (channel === 'roughness') data[n] = data[n + 1] = data[n + 2] = clamp(rough * 255);
      else { data[n] = clamp(rgb[0]); data[n + 1] = clamp(rgb[1]); data[n + 2] = clamp(rgb[2]); }
      data[n + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    const map = new T.CanvasTexture(c); map.name = `${kind}-${channel}`;
    map.colorSpace = channel === 'colour' ? T.SRGBColorSpace : T.NoColorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping; map.anisotropy = anisotropy;
    textures.add(map); return map;
  }
  function physical(name, properties) {
    const m = new T.MeshStandardMaterial(properties); m.name = name; materials.add(m); return m;
  }
  function surface(kind, repeat, bumpScale, roughness = 1) {
    const maps = ['colour', 'height', 'roughness'].map(channel => makeMap(kind, channel));
    maps.forEach(map => map.repeat.set(...repeat));
    return physical(kind, { map: maps[0], bumpMap: maps[1], bumpScale, roughnessMap: maps[2], roughness, metalness: 0, envMapIntensity: .3 });
  }
  const plaster = surface('plaster', [6, 2], .012);
  const stone = surface('limestone', [8, 9], .011);
  const wood = surface('walnut', [1, 2], .004);
  const linen = surface('linen', [5, 1.5], .003);
  const aluminium = surface('aluminium', [2, 1], .001, .74); aluminium.metalness = 1; aluminium.envMapIntensity = .75;
  return {
    plaster, stone, wood, linen, aluminium,
    trim: physical('painted-plaster-trim', { color: '#dcd5c8', roughness: .94, envMapIntensity: .25 }),
    brass: physical('satin-aged-brass', { color: '#9a8254', metalness: 1, roughness: .57, envMapIntensity: .55 }),
    black: physical('powder-coated-metal', { color: '#292b26', roughness: .88, metalness: .15, envMapIntensity: .25 }),
    ceramic: physical('matte-ceramic', { color: '#b0a593', roughness: .95, envMapIntensity: .25 }),
    makeMap,
  };
}

/** Rounded-box vertex construction adapted from Three.js r180 RoundedBoxGeometry (MIT).
 * Local world-unit UVs are used so wood and textile have consistent physical grain size.
 */
export function roundedBox(width, height, depth, radius = .018, segments = 3) {
  const count = segments * 2 + 1;
  radius = Math.min(radius, width / 2, height / 2, depth / 2);
  const indexed = new T.BoxGeometry(1, 1, 1, count, count, count);
  const g = indexed.toNonIndexed(); indexed.dispose();
  const pos = g.attributes.position, normals = g.attributes.normal, uv = g.attributes.uv;
  const box = new T.Vector3(width / 2 - radius, height / 2 - radius, depth / 2 - radius);
  const p = new T.Vector3(), normal = new T.Vector3(), halfSegment = .5 / count;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); normal.copy(p);
    for (const axis of ['x', 'y', 'z']) normal[axis] -= Math.sign(normal[axis]) * halfSegment;
    normal.normalize();
    const x = box.x * Math.sign(p.x) + normal.x * radius;
    const y = box.y * Math.sign(p.y) + normal.y * radius;
    const z = box.z * Math.sign(p.z) + normal.z * radius;
    pos.setXYZ(i, x, y, z); normals.setXYZ(i, normal.x, normal.y, normal.z);
    const face = Math.floor(i / (pos.count / 6));
    uv.setXY(i, face < 2 ? z : x, face === 2 || face === 3 ? z : y);
  }
  return g;
}
