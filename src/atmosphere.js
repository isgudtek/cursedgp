import * as THREE from 'three';

/**
 * Midnight atmosphere: moonlight with shadows, exponential fog, a dark occult-grid floor,
 * procedural haunted props around the track, car underglow and beams, and drifting dust.
 * Everything is built from code. There are no external textures or models.
 */

const UP = new THREE.Vector3(0, 1, 0);
const HX = 1.35; // play-area half extents, matching main.js
const HZ = 0.825;
// Night and day palettes: sky/background, fog, moon, ambient, floor tint.
const PALETTE = {
  night: { bg: 0x243047, fog: 0.05, moon: 0xbcc8ff, moonI: 2.6, hemiSky: 0x7f93bf, hemiGround: 0x22202a, hemiI: 1.9, floor: 0xffffff, rim: 1 },
  day: { bg: 0xb4d6ee, fog: 0.02, moon: 0xfff6e6, moonI: 3.4, hemiSky: 0xeef5ff, hemiGround: 0xa89c84, hemiI: 2.6, floor: 0xffffff, rim: 0.2 },
  // Haunted: teal moonlight through smoke, like a horror-film churchyard. By day, a cold misty overcast.
  hauntedNight: { bg: 0x10292a, fog: 0.11, moon: 0xa6eadf, moonI: 2.3, hemiSky: 0x2e6a66, hemiGround: 0x070d0a, hemiI: 1.25, floor: 0xffffff, rim: 1.1 },
  hauntedDay: { bg: 0x1a2e2c, fog: 0.15, moon: 0xb9d8d2, moonI: 1.2, hemiSky: 0x4a7470, hemiGround: 0x0a0f0c, hemiI: 0.6, floor: 0xbfc7c4, rim: 0.25 },
};

/** Haunted sky: a teal gradient, brighter at the horizon, with soft smoky clouds. Drawn on the inside of a dome. */
function hauntedSkyTexture() {
  return canvasTexture(512, (g, S) => {
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, '#010505');
    grd.addColorStop(0.45, '#071a19');
    grd.addColorStop(0.62, '#1a3b39'); // a faint, cold horizon
    grd.addColorStop(0.72, '#0b2120');
    grd.addColorStop(1, '#030a09');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) {
      const x = rnd() * S;
      const y = S * (0.15 + rnd() * 0.5);
      const r = 18 + rnd() * 70;
      const lit = rnd() < 0.5;
      for (const ox of [0, S, -S]) {
        const c = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        c.addColorStop(0, lit ? 'rgba(120,175,168,0.07)' : 'rgba(0,4,4,0.35)'); // heavy storm clouds, barely lit
        c.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = c;
        g.fillRect(x + ox - r, y - r, r * 2, r * 2);
      }
    }
  });
}

const BOLT_EVERY = [0.5, 1.8]; // s between storm events (bolts, sheet lightning, quakes)
const QUAKE_EVERY = [6, 12]; // s between earthquakes during a race
const QUAKE_TIME = 2.6; // s an earthquake shakes
/** A long strike: the sky stays lit for `dur` seconds, flickering cold, then fades out slowly. */
function longFlash(t, dur) {
  if (t < 0.05) return 1;
  return Math.max(0, (0.3 + 0.2 * Math.sin(t * 7) + 0.1 * Math.sin(t * 19)) * (1 - t / dur));
}

/** Flash brightness t seconds into a strike: a double flicker, then a quick fade. */
function boltFlash(t) {
  if (t < 0) return 0;
  if (t < 0.06) return 1;
  if (t < 0.12) return 0.15;
  if (t < 0.2) return 0.8;
  return Math.max(0, 0.8 * (1 - (t - 0.2) / 0.35));
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function radialTexture(stops) {
  return canvasTexture(64, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [at, col] of stops) grd.addColorStop(at, col);
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
const underTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);

/** Occult floor: dark slate, a faint grid, concentric rings and a hexagram-like star. */
const floorTex = canvasTexture(512, (g, s) => {
  g.fillStyle = '#0b0d14';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#1b2233';
  g.lineWidth = 1;
  for (let i = 0; i <= s; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, s); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(s, i); g.stroke();
  }
  g.strokeStyle = '#2a3550';
  g.lineWidth = 2;
  for (const r of [120, 170, 220]) {
    g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = '#3a2a4a';
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI * 2) / 6 - Math.PI / 2;
    const p = [s / 2 + Math.cos(a) * 200, s / 2 + Math.sin(a) * 200];
    k ? g.lineTo(...p) : g.moveTo(...p);
  }
  g.closePath();
  g.stroke();
  const vig = g.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s / 2);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.fillStyle = vig;
  g.fillRect(0, 0, s, s);
});
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(3, 3);

// Shared geometry and materials for props (built once).
const G = {
  pumpkin: new THREE.SphereGeometry(0.014, 14, 10),
  stem: new THREE.CylinderGeometry(0.002, 0.0025, 0.007, 6),
  trunk: new THREE.CylinderGeometry(0.004, 0.009, 0.16, 7),
  branch: new THREE.CylinderGeometry(0.0015, 0.0035, 0.06, 5),
  stone: new THREE.BoxGeometry(0.026, 0.04, 0.008),
  stoneTop: new THREE.CylinderGeometry(0.013, 0.013, 0.008, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2),
  post: new THREE.BoxGeometry(0.006, 0.26, 0.006),
  beam: new THREE.BoxGeometry(0.24, 0.006, 0.008),
  lantern: new THREE.SphereGeometry(0.006, 10, 8),
  beamCone: new THREE.ConeGeometry(0.011, 0.07, 14, 1, true).rotateX(Math.PI / 2),
};
const M = {
  pumpkin: new THREE.MeshStandardMaterial({ color: 0xd9600f, emissive: 0xff6a12, emissiveIntensity: 0.9, roughness: 0.7 }),
  stem: new THREE.MeshStandardMaterial({ color: 0x2b3a1e, roughness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x3b3f4a, roughness: 0.95 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.6, metalness: 0.6 }),
  lantern: new THREE.MeshBasicMaterial({ color: 0xffb35c }),
};

function sprite(tex, color, scale, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(scale, scale, 1);
  return s;
}

function pumpkin() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(G.pumpkin, M.pumpkin);
  body.scale.set(1.15, 0.85, 1.15);
  body.position.y = 0.012;
  const stem = new THREE.Mesh(G.stem, M.stem);
  stem.position.y = 0.027;
  const glow = sprite(glowTex, 0xff7a1a, 0.09, 0.55);
  glow.position.y = 0.014;
  g.add(body, stem, glow);
  g.userData.glow = glow;
  return g;
}

function tree(depth = 2) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(G.trunk, M.wood);
  trunk.position.y = 0.08;
  g.add(trunk);
  const limb = (parent, d) => {
    if (d === 0) return;
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(G.branch, M.wood);
      b.position.set(side * 0.02 * d, 0.03, 0);
      b.rotation.z = side * (0.7 + 0.2 * (3 - d));
      const tip = new THREE.Group();
      tip.position.y = 0.06;
      b.add(tip);
      parent.add(b);
      limb(tip, d - 1);
    }
  };
  let top = trunk;
  limb(top, depth);
  g.position.y = 0;
  return g;
}

function stone() {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(G.stone, M.stone);
  slab.position.y = 0.02;
  const cap = new THREE.Mesh(G.stoneTop, M.stone);
  cap.position.y = 0.04;
  g.add(slab, cap);
  return g;
}

/** A gothic gate across the track at the start line, with two lanterns. */
// The start/finish gantry: violet like the KIROWEEN arches, sponsored by the square Kiroween artwork.
const gantryMat = new THREE.MeshStandardMaterial({ color: 0xb46bff, emissive: 0xb46bff, emissiveIntensity: 1.1, roughness: 0.35 });
let gantryFace = null;
function gantrySponsor() {
  if (!gantryFace) {
    const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}sponsors/kiroween-square.png`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    gantryFace = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.55 });
  }
  return gantryFace;
}
const GANTRY_PANEL = 0.13; // m: the square sponsor panel under the beam

function gantry(track, tableY) {
  const g = new THREE.Group();
  const p = track.curve.getPointAt(0);
  const t = track.tangentAt(0, new THREE.Vector3());
  const s = new THREE.Vector3().crossVectors(t, UP).normalize();
  const yaw = Math.atan2(-t.x, -t.z);
  g.position.set(p.x, tableY, p.z);
  g.rotation.y = yaw;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(G.post, gantryMat);
    post.position.set(side * 0.11, 0.13, 0);
    g.add(post);
  }
  // Beam runs across the track (along local X after the yaw). Posts stand outside the deck.
  const beam = new THREE.Mesh(G.beam, gantryMat);
  beam.position.set(0, 0.26, 0);
  g.add(beam);
  // The square Kiroween panel hangs from the beam over the line, readable from both directions.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(GANTRY_PANEL + 0.008, GANTRY_PANEL + 0.008, 0.004), gantryMat);
  frame.position.set(0, 0.26 - 0.006 - GANTRY_PANEL / 2, 0);
  g.add(frame);
  for (const back of [0, Math.PI]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(GANTRY_PANEL, GANTRY_PANEL), gantrySponsor());
    face.position.set(0, frame.position.y, back ? -0.0021 : 0.0021);
    face.rotation.y = back;
    g.add(face);
  }
  // The gate's small lamps are gone (they competed with the cars and the monsters for attention): the gate keeps its
  // frame and sponsor panel, and the start light (rims) still lights the line.
  return { group: g, lanterns: [], at: new THREE.Vector3(p.x, tableY + 0.26, p.z), s };
}

/** Car underglow and headlight beams, built from code. */
export function decorateCar(car, color) {
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(0.085, 0.11).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: underTex, color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  under.position.y = 0.0015;
  under.userData.kind = 'under';
  car.mesh.add(under);
  for (const x of [-0.009, 0.009]) {
    const beam = new THREE.Mesh(
      G.beamCone,
      new THREE.MeshBasicMaterial({ color: 0xfff0c2, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    beam.position.set(x, 0.0135, -0.091);
    beam.userData.kind = 'beam';
    car.mesh.add(beam);
  }
}

export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;
    this.day = false;
    scene.background = new THREE.Color(PALETTE.night.bg);
    scene.fog = new THREE.FogExp2(PALETTE.night.bg, PALETTE.night.fog);

    this.moon = new THREE.DirectionalLight(0xbcc8ff, 2.4);
    this.moon.position.set(-1.2, 3.2, 1.6);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(1024, 1024);
    this.moon.shadow.bias = -0.0008;
    Object.assign(this.moon.shadow.camera, { left: -1.8, right: 1.8, top: 1.8, bottom: -1.8, near: 0.5, far: 8 });
    this.moon.target.position.set(0, 0.75, 0);
    scene.add(this.moon, this.moon.target);

    this.hemi = new THREE.HemisphereLight(0x6a7ca8, 0x1a1620, 1.4);
    scene.add(this.hemi);

    // Warm rim lights at the gantry (set in setTrack).
    this.rims = [new THREE.PointLight(0xff9a3c, 0.35, 0.9, 2), new THREE.PointLight(0x8f5bff, 0.25, 0.9, 2)];
    this.rimBase = [0.35, 0.25];
    scene.add(...this.rims);

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(4, 64),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = false; // no dark silhouettes on the floor: shadows stay on the set
    this.floor.visible = false; // no grid floor: the circuit stands on its own
    scene.add(this.floor);

    this.props = new THREE.Group();
    scene.add(this.props);
    // Haunted atmosphere: a stormy teal sky dome, a low moon and lightning (shown only in haunted mode).
    this.haunted = false;
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(30, 32, 16),
      new THREE.MeshBasicMaterial({ map: hauntedSkyTexture(), color: 0x000000, side: THREE.BackSide, fog: false, depthWrite: false }), // a black sky
    );
    this.sky.visible = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
    // A pale moon low in the storm, and the lightning bolt (rebuilt for every strike).
    this.moonDisc = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 12), new THREE.MeshBasicMaterial({ color: 0xbfd9d3, fog: false }));
    this.moonHalo = sprite(glowTex, 0x7fb3aa, 7, 0.35);
    this.moonHalo.material.fog = false;
    this.moonDisc.visible = this.moonHalo.visible = false;
    scene.add(this.moonDisc, this.moonHalo);
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xe6fbff, transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.bolt.visible = false;
    scene.add(this.bolt);
    this.boltNext = 4;
    this.boltT = -1;
    this.thunderAt = -1;
    this.flash = 0;
    this.strike = null; // { kind: 'far' | 'near' | 'sheet' | 'quake', scale, level, quakeAt }
    this.quakeNext = QUAKE_EVERY[0];
    this.quakeT = 0;
    this.quake = 0; // 0..1 earthquake strength this frame, read by the main loop
    this.quakeOn = false;
    this.pumpkins = [];
    this.gantryLights = [];
  }

  /** A fresh jagged bolt with a branch, as a flat ribbon somewhere in the sky. */
  _newBolt() {
    const c = this.sky.position;
    const a = Math.random() * Math.PI * 2;
    const R = 22;
    const top = new THREE.Vector3(c.x + Math.cos(a) * R, c.y + 13, c.z + Math.sin(a) * R);
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)); // across the line of sight
    const lines = [];
    const main = [top.clone()];
    let p = top.clone();
    for (let i = 0; i < 14; i++) {
      p = p.clone().add(new THREE.Vector3(0, -0.9 - Math.random() * 0.4, 0)).addScaledVector(side, (Math.random() - 0.5) * 1.6);
      main.push(p);
    }
    lines.push([main, 0.22]);
    const from = 3 + Math.floor(Math.random() * 5);
    const branch = [main[from].clone()];
    p = main[from].clone();
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < 6; i++) {
      p = p.clone().add(new THREE.Vector3(0, -0.6 - Math.random() * 0.4, 0)).addScaledVector(side, dir * (0.5 + Math.random() * 0.7));
      branch.push(p);
    }
    lines.push([branch, 0.12]);
    const pos = [];
    for (const [pts, w] of lines) {
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i];
        const B = pts[i + 1];
        const o = side.clone().multiplyScalar(w * (1 - i / pts.length) + 0.04);
        pos.push(...A.clone().sub(o).toArray(), ...A.clone().add(o).toArray(), ...B.clone().add(o).toArray());
        pos.push(...A.clone().sub(o).toArray(), ...B.clone().add(o).toArray(), ...B.clone().sub(o).toArray());
      }
    }
    this.bolt.geometry.dispose();
    this.bolt.geometry = new THREE.BufferGeometry();
    this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  }

  /** Rebuild the start gantry and its light for a freshly built track. */
  setTrack(track, tableY) {
    for (const c of [...this.props.children]) this.props.remove(c);
    const box = new THREE.Box3().setFromObject(track.group);
    const samples = [];
    for (let i = 0; i < 240; i++) samples.push(track.curve.getPointAt(i / 240));

    // Gantry at the start line.
    const gate = gantry(track, tableY);
    this.props.add(gate.group);
    this.rims[0].position.copy(gate.at).add(new THREE.Vector3(0, 0.05, 0));
    this.rims[1].position.set(box.max.x + 0.05, tableY + 0.1, box.min.z - 0.05);
    // The moon's shadow covers the whole circuit, whatever its size (the 150 % circuits are up to ~5 m across).
    const c = box.getCenter(new THREE.Vector3());
    const ext = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 0.3;
    Object.assign(this.moon.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, far: 12 });
    this.moon.shadow.camera.updateProjectionMatrix();
    this.moon.target.position.set(c.x, tableY, c.z);
    this.moon.position.set(c.x - 1.2, tableY + 3.2, c.z + 1.6);
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.map?.dispose();
    this.moon.shadow.map = null;
    // The moon hangs low in the sky behind the moonlight's direction.
    const md = new THREE.Vector3(-1.2, 1.1, 1.6).normalize().multiplyScalar(-20);
    md.y = 7;
    this.moonDisc.position.set(c.x + md.x, tableY + md.y, c.z + md.z);
    this.moonHalo.position.copy(this.moonDisc.position);
    this.sky.position.set(c.x, tableY, c.z);
  }

  /** Haunted mode on or off: the teal smoky churchyard look, or the normal palette. */
  setHaunted(on) {
    this.haunted = on;
    this.sky.visible = on;
    this.moonDisc.visible = this.moonHalo.visible = on; // the moon hangs over the haunted sky in every haunted light
    if (!on) {
      this.bolt.visible = false;
      this.boltT = -1;
      this.quakeT = 0;
    }
    this.setDay(this.day);
  }

  /** Register a car so its underglow, beams and LEDs follow the day/night setting. */
  registerCar(car) {
    this.cars = this.cars || [];
    this.cars.push(car);
    this._applyCars();
  }

  /** Night: underglow, beams and LEDs at full strength. Day: all car lights off. */
  _applyCars() {
    const night = true; // the car lights stay on in every mode: the game is dark
    for (const car of this.cars || []) {
      car.lightBoost = night ? 3 : 0;
      car.mesh.traverse((o) => {
        if (o.userData.kind === 'under') o.material.opacity = night ? 1 : 0;
        if (o.userData.kind === 'beam') {
          o.visible = night;
          o.material.opacity = 0.42;
        }
      });
    }
  }

  /** Switch the whole scene between night and day (sky, fog, moon, ambient, floor tint). */
  setDay(on) {
    this.day = on;
    this._applyCars();
    const p = this.haunted ? (on ? PALETTE.hauntedDay : PALETTE.hauntedNight) : on ? PALETTE.day : PALETTE.night;
    this.moon.color.setHex(p.moon);
    this.moon.intensity = p.moonI;
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiI;
    this.baseHemi = p.hemiI;
    if (this.moonDisc) this.moonDisc.visible = this.moonHalo.visible = this.haunted;
    this.floor.material.color.setHex(p.floor);
    this.rimScale = p.rim;
    if (this.scene.background) this.scene.background.setHex(p.bg);
    if (this.scene.fog) {
      this.scene.fog.color.setHex(p.bg);
      this.scene.fog.density = p.fog;
    }
  }

  update(dt) {
    this.t += dt;
    for (const p of this.pumpkins) {
      const f = 0.5 + 0.25 * Math.sin(this.t * 6 + p.phase) + 0.1 * Math.sin(this.t * 13.7 + p.phase * 2);
      p.obj.userData.glow.material.opacity = f;
    }
    // Haunted storm: drifting clouds, and frequent storm events. Far bolts rumble late, near bolts crack at once,
    // sheet lightning glows inside the clouds, and every 16-30 s of a race a huge strike sets off an earthquake.
    this.flash = 0;
    this.quake = 0;
    if (this.haunted) {
      this.sky.material.map.offset.x = (this.sky.material.map.offset.x + dt * 0.0025) % 1;
      if (this.quakeOn) this.quakeNext -= dt;
      // Random haunted sounds: a wolf howl or a creak, every 14 to 36 seconds.
      this.sfxNext = (this.sfxNext ?? 6) - dt;
      if (this.sfxNext <= 0) {
        this.sfxNext = 14 + Math.random() * 22;
        if (Math.random() < 0.6) this.audio?.howl();
        else this.audio?.creak();
      }
      if (this.boltT < 0) {
        this.boltNext -= dt;
        if (this.boltNext <= 0) {
          const r = Math.random();
          let s;
          if (this.quakeOn && this.quakeNext <= 0) {
            s = { kind: 'quake', scale: 1, level: 1, thunder: 0.04, quakeAt: 0.15 };
            this.quakeNext = QUAKE_EVERY[0] + Math.random() * (QUAKE_EVERY[1] - QUAKE_EVERY[0]);
          } else if (r < 0.2) s = { kind: 'long', scale: 1, level: 0.9, thunder: 0.3 + Math.random() * 0.4, dur: 5.2, echo: 0.8 + Math.random() * 0.8 };
          else if (r < 0.4) s = { kind: 'sheet', scale: 0.3, level: 0.25 + Math.random() * 0.2, thunder: 0.8 + Math.random() * 1.2 };
          else if (r < 0.65) s = { kind: 'near', scale: 1, level: 1, thunder: 0.08 + Math.random() * 0.2, echo: 0.5 + Math.random() * 0.9 };
          else s = { kind: 'far', scale: 0.8, level: 0.5 + Math.random() * 0.3, thunder: 0.5 + Math.random() * 1.0 };
          this.strike = s;
          if (s.kind !== 'sheet') this._newBolt();
          this.boltT = 0;
          this.bolt.visible = s.kind !== 'sheet';
          this.thunderAt = s.thunder;
          this.boltNext = BOLT_EVERY[0] + Math.random() * (BOLT_EVERY[1] - BOLT_EVERY[0]);
        }
      } else {
        const s = this.strike;
        this.boltT += dt;
        // A second, ghostly flash follows the first on the near and long strikes: the sky hits twice.
        const echoFlash = s.echo ? 0.6 * boltFlash(this.boltT - s.echo) : 0;
        this.flash = Math.min(1, (s.kind === 'long' ? longFlash(this.boltT, s.dur) : boltFlash(this.boltT) * s.scale) + echoFlash);
        this.bolt.material.opacity = this.flash;
        if (this.thunderAt > 0 && this.boltT >= this.thunderAt) {
          this.thunderAt = -1;
          this.audio?.thunder(s.level, s.kind === 'long');
        }
        if (s.quakeAt > 0 && this.boltT >= s.quakeAt) {
          s.quakeAt = -1;
          this.quakeT = QUAKE_TIME;
          this.audio?.quake(1);
        }
        if (this.boltT > (s.dur || 2.4)) {
          this.boltT = -1;
          this.bolt.visible = false;
        }
      }
      if (this.quakeT > 0) {
        this.quakeT = Math.max(0, this.quakeT - dt);
        const age = QUAKE_TIME - this.quakeT;
        this.quake = Math.min(1, age / 0.15) * Math.pow(this.quakeT / QUAKE_TIME, 0.7);
      }
      // The flash lights the scene only a little: a brief cold flicker, the night stays dark.
      const k = this.flash;
      this.sky.material.color.setRGB(0, 0, 0); // the sky stays black; the storm's light still reaches the scene (the lights are not touched)
      this.hemi.intensity = this.baseHemi + 0.9 * k;
    }
    const rs = this.rimScale ?? 1;
    this.rims[0].intensity = (0.3 + 0.08 * Math.sin(this.t * 9) + 0.04 * Math.sin(this.t * 23.1)) * rs;
    this.rims[1].intensity = this.rimBase[1] * rs;
  }

  /** Mist under the time-trial ghost. */
  decorateGhost(car) {
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.13).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: underTex, color: 0xcfd8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    under.position.y = 0.002;
    under.userData.decor = true;
    car.mesh.add(under);
  }
}
