import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Three procedural slot-car models with distinct handling. Each model is built from code: side
 * profiles are extruded into bodywork, and wheels, wings, lights and roof details are primitives.
 * Car forward is -Z, and the origin sits on the slot surface, as before.
 *
 *   spec.vmax   multiplier on the top speed
 *   spec.accel  multiplier on how quickly the car responds to throttle (low = heavy momentum)
 *   spec.grip   multiplier on the safe corner speed (high = the derail threshold is higher)
 */
export const CAR_MODELS = {
  formula: {
    key: 'formula',
    name: 'CRIMSON FORMULA',
    color: 0xc8102e,
    under: 0xff3344,
    spec: { vmax: 0.92 * 1.1, accel: 1.4, grip: 1.2 }, // top speed +10%
    stats: { top: 70, accel: 92, grip: 95 },
  },
  coupe: {
    key: 'coupe',
    name: 'STUTTGART 911',
    color: 0xaab6c6,
    under: 0xdbe6ff,
    spec: { vmax: 1.0 * 1.1, accel: 1.0, grip: 1.0 }, // top speed +10%
    stats: { top: 80, accel: 78, grip: 80 },
  },
  // Ready-made models from the Kenney Car Kit (CC0, public domain): loaded from public/models/ at start-up.
  kracer: {
    key: 'kracer',
    name: 'RACER NINE',
    file: 'racer-nine.glb',
    color: 0xc8102e,
    under: 0xff3344,
    spec: { vmax: 1.04, accel: 1.3, grip: 0.95 },
    stats: { top: 80, accel: 88, grip: 70 },
  },
  kfuture: {
    key: 'kfuture',
    name: 'GHOST FUTURE',
    file: 'ghost-future.glb',
    color: 0x6fe8ff,
    under: 0x6fe8ff,
    spec: { vmax: 1.1, accel: 1.2, grip: 0.9 },
    stats: { top: 90, accel: 80, grip: 62 },
  },
  ksedan: {
    key: 'ksedan',
    name: 'NIGHT SEDAN',
    file: 'night-sedan.glb',
    color: 0x2a2a33,
    under: 0x9ff7e0,
    spec: { vmax: 1.03, accel: 0.9, grip: 1.0 },
    stats: { top: 78, accel: 60, grip: 74 },
  },
  hearse: {
    key: 'hearse',
    name: 'ECTO-HEARSE',
    color: 0xf2ead8,
    under: 0x6dff9a,
    spec: { vmax: 1.12 * 1.1, accel: 0.55, grip: 0.8 }, // top speed +10%
    stats: { top: 98, accel: 45, grip: 52 },
  },
  pumpkin: {
    key: 'pumpkin',
    name: 'PUMPKIN COACH',
    color: 0xff7a1a,
    under: 0xff9a2a,
    spec: { vmax: 1.06, accel: 1.1, grip: 0.9 }, // top speed above the red formula, grip below it: it can derail
    stats: { top: 84, accel: 70, grip: 66 },
  },
  banshee: {
    key: 'banshee',
    name: 'BANSHEE WAGON',
    color: 0xb9e9e0,
    under: 0x9ff7e0,
    spec: { vmax: 1.08, accel: 1.2, grip: 0.95 },
    stats: { top: 86, accel: 80, grip: 60 },
  },
  crypt: {
    key: 'crypt',
    name: 'COFFIN CRUISER',
    color: 0x1c1d26,
    under: 0xc8b070,
    spec: { vmax: 1.15, accel: 0.8, grip: 0.85 },
    stats: { top: 94, accel: 52, grip: 44 },
  },
};
export const CAR_KEYS = Object.keys(CAR_MODELS);

const UP = new THREE.Vector3(0, 1, 0);

const DARK = () => new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.8 });
const GLASS = () => new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.15, metalness: 0.4 });
const CHROME = () => new THREE.MeshStandardMaterial({ color: 0xaaaeb4, metalness: 0.9, roughness: 0.3 });

/** Extrude a side profile (u = along the car, v = height) into a body half-width `width` wide. */
function sideBody(points, width) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2); // profile length -> Z (forward is -Z), width -> X
  g.computeVertexNormals();
  return g;
}

const wheelGeo = (r, w) => new THREE.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2);

/** Build one car. Returns { group, lights, beacon } where lights are the LEDs the car drives. */
const kenneyScenes = {}; // key -> { scene, scale } once loaded

/** Loads the Kenney models (about 0.5 MB in all). Until a model has loaded, its slot builds the hearse instead. */
export async function loadKenneyModels(base = '') {
  const loader = new GLTFLoader();
  await Promise.all(
    Object.keys(CAR_MODELS)
      .filter((k) => CAR_MODELS[k].file)
      .map(async (k) => {
        const gltf = await loader.loadAsync(`${base}models/${CAR_MODELS[k].file}`);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const length = box.max.z - box.min.z; // the kit's cars run along Z
        kenneyScenes[k] = { scene: gltf.scene, scale: 0.094 / length }; // the same length as the other cars
      }),
  );
}

/** A Kenney car: turned to face -Z like the others, scaled to size, lifted onto the slot, with LED lights added. */
function buildKenneyModel(key) {
  const { scene, scale } = kenneyScenes[key];
  const g = new THREE.Group();
  const body = scene.clone(true);
  body.rotation.y = Math.PI; // the kit's front is +Z
  body.scale.setScalar(scale);
  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const c = box.getCenter(new THREE.Vector3());
  body.position.set(-c.x, -box.min.y, -c.z);
  g.add(body);
  const lights = {
    head: [led0(-0.008, 0.012, -0.046, 0xfff6d6, g), led0(0.008, 0.012, -0.046, 0xfff6d6, g)],
    tail: [led0(-0.009, 0.013, 0.046, 0xff2a1a, g), led0(0.009, 0.013, 0.046, 0xff2a1a, g)],
  };
  return { group: g, lights, beacon: null };
}

/** A small glowing light for the Kenney models (the same look as the procedural models' lights). */
function led0(x, y, z, hex, parent) {
  const mat = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1, roughness: 0.3 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.003, 0.003), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: hex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(0.022, 0.022, 1);
  halo.position.set(x, y, z);
  parent.add(halo);
  return { mat, halo, mesh };
}

export function buildCarModel(key, color = CAR_MODELS[key].color) {
  if (CAR_MODELS[key].file) return kenneyScenes[key] ? buildKenneyModel(key) : buildCarModel('hearse', color);
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.25 });
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const led = (x, y, z, hex) => {
    const mat = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1, roughness: 0.3 });
    const mesh = add(new THREE.BoxGeometry(0.006, 0.003, 0.003), mat, x, y, z);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: haloTexture(), color: hex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo.scale.set(0.022, 0.022, 1);
    halo.position.set(x, y, z);
    g.add(halo);
    return { mat, halo, mesh };
  };
  const lights = { head: [], tail: [] };
  let beacon = null;

  if (key === 'formula') {
    // Open wheel: low chassis, exposed wheels, front and rear wings, driver helmet.
    add(sideBody([[-0.045, 0.004], [-0.045, 0.01], [-0.022, 0.011], [0.0, 0.0125], [0.02, 0.011], [0.045, 0.009], [0.045, 0.004]], 0.026), paint);
    add(new THREE.BoxGeometry(0.018, 0.005, 0.02), DARK(), 0, 0.0115, -0.003); // cockpit tub
    add(new THREE.SphereGeometry(0.0055, 12, 8), paint, 0, 0.0175, 0.003); // driver helmet
    add(new THREE.BoxGeometry(0.034, 0.002, 0.008), paint, 0, 0.0075, -0.047); // front wing
    add(new THREE.BoxGeometry(0.036, 0.0025, 0.009), paint, 0, 0.0235, 0.041); // rear wing
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.002, 0.012, 0.004), DARK(), sx * 0.013, 0.0175, 0.041);
    for (const sx of [-1, 1]) {
      add(wheelGeo(0.0095, 0.008), DARK(), sx * 0.0195, 0.0095, -0.028);
      add(wheelGeo(0.0105, 0.009), DARK(), sx * 0.0195, 0.0105, 0.03);
    }
    lights.head = [led(-0.007, 0.0085, -0.047, 0xfff6d6), led(0.007, 0.0085, -0.047, 0xfff6d6)];
    lights.tail = [led(0, 0.0175, 0.0465, 0xff2a1a)]; // single F1 rain light
  } else if (key === 'coupe') {
    // Rear-engine coupe: sloped roof, round headlights, wide rear fenders, whale-tail spoiler.
    add(sideBody([[-0.045, 0.006], [-0.045, 0.012], [-0.02, 0.014], [-0.004, 0.026], [0.014, 0.03], [0.03, 0.026], [0.045, 0.02], [0.045, 0.006]], 0.03), paint);
    add(new THREE.BoxGeometry(0.024, 0.006, 0.02), GLASS(), 0, 0.0255, 0.0);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.006, 0.008, 0.03), paint, sx * 0.0165, 0.0095, 0.03); // rear fenders
    add(new THREE.BoxGeometry(0.02, 0.0025, 0.004), DARK(), 0, 0.0215, 0.047).rotation.x = -0.4; // whale tail
    for (const sx of [-1, 1]) {
      add(new THREE.SphereGeometry(0.0045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff6d6, emissive: 0xfff6d6, emissiveIntensity: 1 }), sx * 0.009, 0.0135, -0.046);
      add(wheelGeo(0.0085, 0.007), DARK(), sx * 0.0185, 0.0085, -0.027);
      add(wheelGeo(0.0095, 0.008), DARK(), sx * 0.0185, 0.0095, 0.029);
    }
    lights.head = [led(-0.009, 0.0135, -0.047, 0xfff6d6), led(0.009, 0.0135, -0.047, 0xfff6d6)];
    lights.tail = [led(-0.012, 0.0145, 0.046, 0xff2a1a), led(0.012, 0.0145, 0.046, 0xff2a1a)];
  } else if (key === 'pumpkin') {
    // Pumpkin coach: a round, bulging body, a stalk on the roof and carved glowing eyes.
    add(sideBody([[-0.045, 0.006], [-0.045, 0.02], [-0.03, 0.028], [0, 0.033], [0.03, 0.028], [0.045, 0.02], [0.045, 0.006]], 0.034), paint);
    add(new THREE.BoxGeometry(0.02, 0.004, 0.018), GLASS(), 0, 0.0265, -0.004); // canopy
    add(new THREE.CylinderGeometry(0.0022, 0.003, 0.008, 6), DARK(), 0, 0.0365, 0.012); // stalk
    add(new THREE.BoxGeometry(0.026, 0.0025, 0.004), DARK(), 0, 0.0215, 0.047).rotation.x = -0.3; // little spoiler
    for (const sx of [-1, 1]) {
      add(wheelGeo(0.0085, 0.007), DARK(), sx * 0.0195, 0.0085, -0.027);
      add(wheelGeo(0.0095, 0.008), DARK(), sx * 0.0195, 0.0095, 0.029);
    }
    lights.head = [led(-0.01, 0.015, -0.047, 0xffd27a), led(0.01, 0.015, -0.047, 0xffd27a)]; // carved eyes
    lights.tail = [led(0, 0.016, 0.047, 0xff2a1a)];
  } else if (key === 'banshee') {
    // Banshee wagon: a pale body, a glass roof and two ghostly wisps trailing from the roof.
    add(sideBody([[-0.045, 0.008], [-0.045, 0.014], [-0.025, 0.016], [-0.01, 0.03], [0.018, 0.034], [0.04, 0.026], [0.045, 0.008]], 0.028), paint);
    add(new THREE.BoxGeometry(0.026, 0.006, 0.022), GLASS(), 0, 0.0265, 0.002);
    const wisp = new THREE.MeshStandardMaterial({ color: 0x9ff7e0, emissive: 0x9ff7e0, emissiveIntensity: 1.2, transparent: true, opacity: 0.6 });
    add(new THREE.SphereGeometry(0.004, 10, 8), wisp, 0, 0.036, 0.03);
    add(new THREE.SphereGeometry(0.0028, 10, 8), wisp, 0.004, 0.04, 0.046);
    for (const sx of [-1, 1]) {
      add(wheelGeo(0.0085, 0.007), DARK(), sx * 0.0195, 0.0085, -0.027);
      add(wheelGeo(0.0085, 0.007), DARK(), sx * 0.0195, 0.0085, 0.031);
    }
    lights.head = [led(-0.009, 0.0125, -0.046, 0x9ff7e0), led(0.009, 0.0125, -0.046, 0x9ff7e0)]; // ghost-green eyes
    lights.tail = [led(-0.011, 0.0135, 0.045, 0xff2a1a), led(0.011, 0.0135, 0.045, 0xff2a1a)];
  } else if (key === 'crypt') {
    // Coffin cruiser: a low, tapered black body with a brass trim strip and a rear plate.
    add(sideBody([[-0.046, 0.005], [-0.046, 0.012], [-0.03, 0.016], [-0.012, 0.024], [0.02, 0.027], [0.046, 0.018], [0.046, 0.005]], 0.026), paint);
    add(new THREE.BoxGeometry(0.03, 0.004, 0.012), GLASS(), 0, 0.0225, -0.006);
    add(new THREE.BoxGeometry(0.004, 0.002, 0.03), new THREE.MeshStandardMaterial({ color: 0xc8b070, metalness: 0.6, roughness: 0.4 }), 0, 0.0245, 0.0); // brass trim
    add(new THREE.BoxGeometry(0.036, 0.0025, 0.006), DARK(), 0, 0.0185, 0.046); // rear plate
    for (const sx of [-1, 1]) {
      add(wheelGeo(0.0085, 0.007), DARK(), sx * 0.0195, 0.0085, -0.027);
      add(wheelGeo(0.0095, 0.008), DARK(), sx * 0.0195, 0.0095, 0.029);
    }
    lights.head = [led(-0.012, 0.0108, -0.047, 0xf0f0ff), led(0.012, 0.0108, -0.047, 0xf0f0ff)];
    lights.tail = [led(-0.014, 0.0118, 0.046, 0xff2a1a), led(0.014, 0.0118, 0.046, 0xff2a1a)];
  } else {
    // Hearse: long flat roof, tailfins, spectral roof rack and a flashing beacon.
    add(sideBody([[-0.045, 0.006], [-0.045, 0.015], [-0.03, 0.02], [-0.018, 0.033], [0.032, 0.035], [0.045, 0.031], [0.047, 0.006]], 0.032), paint);
    add(new THREE.BoxGeometry(0.03, 0.005, 0.02), GLASS(), 0, 0.0245, -0.01);
    for (const sx of [-1, 1]) {
      const fin = add(new THREE.BoxGeometry(0.004, 0.012, 0.012), paint, sx * 0.015, 0.03, 0.044);
      fin.rotation.z = sx * 0.5;
      const rack = new THREE.MeshStandardMaterial({ color: 0x6fe8ff, emissive: 0x6fe8ff, emissiveIntensity: 1.3 });
      add(new THREE.BoxGeometry(0.002, 0.002, 0.058), rack, sx * 0.012, 0.0365, 0.005); // spectral roof rack
    }
    beacon = add(new THREE.SphereGeometry(0.0035, 10, 8), new THREE.MeshStandardMaterial({ color: 0x4488ff, emissive: 0x4488ff, emissiveIntensity: 1 }), 0, 0.0395, 0.0);
    for (const sx of [-1, 1]) {
      add(new THREE.SphereGeometry(0.0045, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff6d6, emissive: 0xfff6d6, emissiveIntensity: 1 }), sx * 0.01, 0.0145, -0.046);
      add(wheelGeo(0.0085, 0.007), DARK(), sx * 0.0195, 0.0085, -0.027);
      add(wheelGeo(0.0085, 0.007), DARK(), sx * 0.0195, 0.0085, 0.031);
    }
    lights.head = [led(-0.01, 0.0145, -0.047, 0xfff6d6), led(0.01, 0.0145, -0.047, 0xfff6d6)];
    lights.tail = [led(-0.012, 0.0155, 0.047, 0xff2a1a), led(0.012, 0.0155, 0.047, 0xff2a1a)];
  }
  return { group: g, lights, beacon };
}

let _halo = null;
function haloTexture() {
  if (_halo) return _halo;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _halo = new THREE.CanvasTexture(c);
  _halo.colorSpace = THREE.SRGBColorSpace;
  return _halo;
}

/**
 * Garage preview: one model turning slowly, rendered through the main renderer into a small
 * canvas that the title screen shows.
 */
export class GaragePreview {
  constructor(renderer) {
    this.renderer = renderer;
    this.W = 240;
    this.H = 140;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(this.W, this.H);
    this.buf = new Uint8Array(this.W * this.H * 4);
    this.rt = new THREE.WebGLRenderTarget(this.W, this.H);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2018, 1.6));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
    key.position.set(0.6, 1, 0.8);
    this.scene.add(key);
    this.cam = new THREE.PerspectiveCamera(30, this.W / this.H, 0.005, 2);
    this.cam.position.set(0, 0.09, 0.3);
    this.cam.lookAt(0, 0.01, 0);
    this.spin = new THREE.Group();
    this.scene.add(this.spin);
    this.angle = 0;
    this.acc = 1;
    this.key = null;
  }

  setModel(key) {
    if (this.key === key) return;
    this.key = key;
    this.spin.clear();
    const { group } = buildCarModel(key);
    group.scale.setScalar(1.6);
    group.position.y = 0.0;
    this.spin.add(group);
  }

  update(dt, mainRenderer) {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    this.angle += 0.8 / 30;
    this.spin.rotation.y = this.angle;
    const r = mainRenderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cam);
    r.readRenderTargetPixels(this.rt, 0, 0, this.W, this.H, this.buf);
    r.setRenderTarget(prev);
    const row = this.W * 4;
    const d = this.img.data;
    for (let y = 0; y < this.H; y++) d.set(this.buf.subarray((this.H - 1 - y) * row, (this.H - y) * row), y * row);
    this.ctx.putImageData(this.img, 0, 0);
  }
}

export { UP };
