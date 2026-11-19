import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANE_OFFSETS, SLOT_HALF, RAIL_W } from './track.js';

/**
 * Haunted Mode monsters. Each one sits at a place chosen from the track's own curvature:
 *   1. Kaiju: beside the longest straight. Telegraphed stomp; the epicentre de-slots cars and the outer shockwave
 *      jolts them.
 *   2. Spider: on an arch over a corner exit. Drops web patches across the lanes (webbed cars crawl until they
 *      hold full throttle) and occasionally pounces on a car.
 *   3. Phantom: a hovering spectre whose beam lifts cars off the slot and cuts their grip.
 *   4. Gargoyle: at the hairpin apex. It turns to the nearest car and hurls ectoplasm at a landing spot. A direct hit
 *      de-slots, a near miss gives a spectral boost.
 *   5. Claws: out of the track bed, alternating lanes. A rumble warns, then the claw closes over one lane.
 *   6. Bats: a swarm leaves its dead-tree roost, finds a car and engulfs it. The car crawls at half speed until
 *      the swarm lets go.
 *   7. Portal: a glowing arch over a straight. Now and then it opens; a car that drives through while it is open
 *      slides across into the other lane.
 * The AI reads the same zones through capAt(). Rookie and Pro brake for them; Maniac (caution 0) ignores them.
 *
 * Online: the host decides every monster action and logs it as an event (exportState). The guest runs in puppet
 * mode: it makes no decisions and hurts no car, it replays the host's events (importState), fast-forwarded by the
 * network delay, so both screens show the same stomps, webs, orbs, claws and swarms.
 */

const UP = new THREE.Vector3(0, 1, 0);
const KAIJU_CHARGE = 1.8;
const KAIJU_SCALE = 0.4; // half the previous size (0.8; the original was 1.6)
const KAIJU_SIDE = 0.085; // m from the centreline: its head still leans over the track (half the size, half the offset)
const SLAM_TIME = 0.22;
const RECOVER_TIME = 0.9;
const EPI = 0.1; // epicentre radius: de-slotted
const RING = 0.22; // outer shockwave ring: jolted
const WEB_LIFE = 6;
const CLAW_CYCLE = { idle: 3.2, telegraph: 1.4, closing: 0.35, closed: 1.2, release: 0.5 };
const BAT_COUNT = 56;
const BAT_CYCLE = { rest: 6, hunt: 1.1, engulf: 2.6, scatter: 1.2 };
const SAME_LANE_CONTACT = 0.04; // m: a car this close ahead in its lane is hit from behind
const BAT_SLOW = 2.6; // seconds a swarmed car crawls
const EV = { kaiju: 1, web: 2, pounce: 3, orb: 4, claw: 5, bats: 6, portal: 7, pumpkin: 8, swipe: 9, skel: 10, ghost: 11 };
// Ghosts: now and then a ghost swoops onto a car for one second, keeping pace a few centimetres behind it. If the car
// brakes, the ghost closes the gap and knocks it off the slot. The host decides; guests see the swoop.
const GHOST_DASH = 1.0; // s of the swoop
const GHOST_GAP = 0.12; // m the ghost trails behind the car
const GHOST_COOL = [4, 7]; // s between swoops
const GHOST_SLOW = 2.5; // s a car caught by a ghost crawls at half speed
// Skeletons: two bony figures on the verge, shaking. One reaches its arm across to its lane as a car comes by; a car
// under the arm while it is out is knocked off. Host-decided, like the other hazards.
const SKEL_REACH = 1.3; // s per reach
const SKEL_LATERAL = 0.12; // m from the centre line (just outside the track edge)
const SKEL_COOLDOWN = [5, 9]; // s between reaches
const SWIPE_TIME = 1.3; // s for the head swipe across the lanes
// Pumpkins: a pumpkin hops in from the verge, sits on a lane for a moment, then hops back off. A car that runs into
// it while it sits on the lane is knocked off the slot (the host decides this; guests see the hop).
const PUMPKIN_HOP = 1.0; // s for each hop
const PUMPKIN_REST = 2.4; // s it sits on the lane
const PUMPKIN_EVERY = [5, 9]; // s between pumpkins
const PORTAL_CYCLE = { opening: 0.5, open: 4.5, closing: 0.5 };
const MAX_PORTALS = 3;
const PORTAL_KEEP = 0.06; // share of a lap a portal keeps from banners, the start gantry and other portals
const XOVER_LEN = 0.24; // m: the crossover drawn on the deck after each portal, which a swapping car follows
const PORTAL_R = 0.11; // m: arch radius, wide enough for the whole deck
const EVENT_KEEP = 4; // seconds of events resent in every snapshot, so a lost packet loses nothing

const _p = new THREE.Vector3();

/** A violet pac-man ghost with its eyes and the word KIRO on its body, drawn once (like the ghosts on the Kiroween banners). */
let _ghostTex = null;
function ghostTexture() {
  if (_ghostTex) return _ghostTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 160;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, '#b38bff');
  grd.addColorStop(1, '#6a2fd6');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(64, 62, 52, Math.PI, 0);
  g.lineTo(116, 132);
  // the wavy skirt: three scallops
  g.quadraticCurveTo(102, 154, 90, 132);
  g.quadraticCurveTo(77, 154, 64, 132);
  g.quadraticCurveTo(51, 154, 38, 132);
  g.quadraticCurveTo(26, 154, 12, 132);
  g.closePath();
  g.fill();
  for (const x of [46, 82]) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(x, 60, 11, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a0a36';
    g.beginPath();
    g.arc(x + 2, 63, 5.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.font = 'bold 15px monospace';
  g.textAlign = 'center';
  g.fillText('KIRO', 64, 120);
  _ghostTex = new THREE.CanvasTexture(c);
  _ghostTex.colorSpace = THREE.SRGBColorSpace;
  return _ghostTex;
}
const _spinQ = new THREE.Quaternion();
const _t = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _bp = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const _bs = new THREE.Vector3();
const _s = new THREE.Vector3();

const circ = (a, b) => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

const stone = () => new THREE.MeshStandardMaterial({ color: 0x3a3440, roughness: 0.85 });
const glowM = (hex, i = 1) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: i, roughness: 0.4 });

function ringMesh(r, color) {
  return new THREE.Mesh(
    new THREE.RingGeometry(r * 0.8, r, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
}

function webTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(220,255,235,0.9)';
  g.lineWidth = 1.6;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    g.beginPath();
    g.moveTo(64, 32);
    g.lineTo(64 + Math.cos(a) * 62, 32 + Math.sin(a) * 30);
    g.stroke();
  }
  for (const r of [12, 24, 36, 48]) {
    g.beginPath();
    g.ellipse(64, 32, r, r * 0.5, 0, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildKaiju() {
  const g = new THREE.Group();
  const plateMat = glowM(0xff3322, 0.4);
  const eyeMat = glowM(0xffe0a0, 0.8);
  const mouthMat = glowM(0xff4a1a, 0.4);
  const bone = stone();
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.1, 28, 18), bone);
  torso.scale.set(1.9, 1.0, 1.1);
  torso.position.y = 0.13;
  g.add(torso);
  const head = new THREE.Group();
  head.position.set(0, 0.23, -0.2);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.14), bone);
  head.add(skull);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.03, -0.06);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.1), bone);
  lower.position.set(0, -0.015, -0.03);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.08), mouthMat);
  mouth.position.set(0, -0.004, -0.03);
  jaw.add(lower, mouth);
  head.add(jaw);
  for (const x of [-0.03, 0.03]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), eyeMat);
    eye.position.set(x, 0.03, -0.06);
    head.add(eye);
  }
  g.add(head);
  const plates = [];
  for (let i = 0; i < 11; i++) {
    const p = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.1, 5), plateMat);
    p.position.set(0, 0.24, -0.2 + i * 0.05);
    g.add(p);
    plates.push(p);
  }
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.1, 0.16, -0.06);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.14, 8), bone);
    upper.position.set(sx * 0.02, -0.07, 0);
    upper.rotation.z = sx * 0.3;
    arm.add(upper);
    arm.userData.side = sx;
    g.add(arm);
    arms.push(arm);
  }
  for (const [x, z] of [[-0.12, -0.1], [0.12, -0.1], [-0.12, 0.12], [0.12, 0.12]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 10), bone);
    leg.position.set(x, 0.06, z);
    g.add(leg);
  }
  // The tail hangs from a pivot at its root, so it can swish.
  const tail = new THREE.Group();
  tail.position.set(0, 0.12, 0.14);
  const tailMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.06, 0.4, 10), bone);
  tailMesh.rotation.x = Math.PI / 2 - 0.25;
  tailMesh.position.set(0, -0.02, 0.18);
  tail.add(tailMesh);
  g.add(tail);
  g.scale.setScalar(KAIJU_SCALE);
  return { group: g, head, jaw, arms, plates, plateMat, eyeMat, mouthMat, torso, tail };
}

function buildSpider() {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0a10, roughness: 0.6 });
  const eyeMat = glowM(0xff3a2a, 1.2);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), black);
  abdomen.scale.set(1, 0.9, 1.3);
  abdomen.position.set(0, 0.03, 0.02);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10), black);
  head.position.set(0, 0.03, -0.025);
  g.add(abdomen, head);
  for (let i = 0; i < 4; i++) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 6), eyeMat);
    e.position.set((i % 2 ? 0.006 : -0.006), 0.04, -0.04 - (i >> 1) * 0.004);
    g.add(e);
  }
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const k = i % 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.06, 4), black);
    leg.position.set(side * 0.03, 0.035, -0.02 + k * 0.02);
    leg.rotation.z = side * 0.9;
    g.add(leg);
  }
  return { group: g, eyeMat, abdomen };
}

function buildPhantom() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.14, 16, 1, true).rotateX(Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x9b5cff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  body.position.y = 0.02;
  g.add(body);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), new THREE.MeshBasicMaterial({ color: 0x1a1030 }));
  hood.position.y = 0.07;
  g.add(hood);
  for (const x of [-0.013, 0.013]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9fffb0 }));
    eye.position.set(x, 0.068, 0.03);
    g.add(eye);
  }
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.12, 0.5, 24, 1, true).translate(0, -0.25, 0),
    new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  g.add(beam);
  const wisps = [];
  for (let i = 0; i < 6; i++) {
    const w = new THREE.Sprite(new THREE.SpriteMaterial({ color: i % 2 ? 0x9fffb0 : 0xb48cff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    w.scale.set(0.03, 0.03, 1);
    g.add(w);
    wisps.push(w);
  }
  return { group: g, beam, wisps, body };
}

function buildGargoyle() {
  const g = new THREE.Group();
  const rock = stone();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.06), rock);
  body.position.y = 0.08;
  const head = new THREE.Group();
  head.position.set(0, 0.2, -0.02);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.07), rock);
  head.add(skull);
  for (const x of [-0.03, 0.03]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.04, 6), rock);
    horn.position.set(x, 0.04, 0.005);
    head.add(horn);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.007, 10, 8), glowM(0x9fffb0, 1.6));
    eye.position.set(x * 0.6, 0.01, -0.036);
    head.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), glowM(0x66ffcc, 1.4));
  mouth.position.set(0, -0.012, -0.036);
  head.add(mouth);
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4), rock);
    wing.position.set(sx * 0.05, 0.14, 0.02);
    wing.rotation.z = sx * 0.9;
    g.add(wing);
  }
  g.add(body, head);
  return { group: g, head, mouth };
}

/** Claws: three fingers that rise out of the bed under one lane and lean in to close over it. */
function buildClaw() {
  const g = new THREE.Group();
  const bone = stone();
  const fingers = [];
  const tipMat = glowM(0xc8ffdd, 0.6);
  for (const x of [-0.035, 0, 0.035]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.03, 0);
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.009, 0.06, 6), bone);
    f.position.y = 0.03;
    pivot.add(f);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), tipMat);
    tip.position.y = 0.06;
    pivot.add(tip);
    g.add(pivot);
    fingers.push({ pivot, x });
  }
  return { group: g, fingers, glow: tipMat };
}

/**
 * Haunted grass: dark blue-green night turf with dried, dead patches. Thousands of short blades in several greens over a near-black
 * base, seeded so every screen draws the same carpet. Tiles seamlessly (blades wrap around the edges).
 */
function grassTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#0d151c';
  g.fillRect(0, 0, S, S);
  // Dead, dried patches and darker damp hollows, under the blades.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 30 + rnd() * 70;
    const dead = rnd() < 0.45;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grd.addColorStop(0, dead ? 'rgba(46,56,64,0.5)' : 'rgba(3,7,13,0.6)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  // Blades: short strokes leaning a little in every direction.
  const greens = ['#142629', '#182d33', '#1d353b', '#223d45', '#28454f', '#2f4b57', '#3a4b58']; // blue-green, as grass looks on a dark night
  for (let i = 0; i < 16000; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 3 + rnd() * 7;
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.1;
    g.strokeStyle = greens[Math.floor(rnd() * rnd() * greens.length * 1.6) % greens.length];
    g.globalAlpha = 0.55 + rnd() * 0.45;
    g.lineWidth = 0.8 + rnd() * 0.9;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const GRASS_TILE = 0.45; // m per texture repeat
const GRASS_MARGIN = 0.62; // m of carpet around the track: room for the forest band and the graveyards
const GRASS_CORNER = 0.22; // m corner radius: a rug with clean rounded corners
const FOREST_BAND = 0.3; // m: the forest grows in this band along the carpet's edge
const TREE_SPACING = 0.085; // m between forest lattice points
const TRACK_CLEAR = 0.2; // m from the centreline that no tree may cross
const GRAVE_CLEAR = 0.14; // m from the centreline that no grave or fence may cross

/** Small seeded generator (mulberry32): the same circuit always grows the same forest and graveyards, on every player. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paint one flat colour into a geometry's vertex colours (so merged parts keep their own colour). */
function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** A dark fir: a short trunk under four stacked cones (~0.23 m before instance scaling). */
function pineGeometry() {
  const parts = [tint(new THREE.CylinderGeometry(0.004, 0.006, 0.05, 6).translate(0, 0.025, 0), 0x2b2118)];
  for (const [r, h, y] of [[0.06, 0.11, 0.035], [0.048, 0.09, 0.085], [0.034, 0.075, 0.13], [0.02, 0.06, 0.17]]) {
    parts.push(tint(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2, 0), 0x15323a));
  }
  return mergeGeometries(parts);
}

/** A bare, crooked dead tree: a bent trunk with reaching branches and twigs (~0.24 m before instance scaling). */
function deadTreeGeometry() {
  const parts = [];
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const limb = (from, len, r0, r1, rz, ry) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, 5).translate(0, len / 2, 0).rotateZ(rz).rotateY(ry);
    g.translate(from.x, from.y, from.z);
    parts.push(tint(g, 0x4a433a));
    return new THREE.Vector3(0, len, 0).applyAxisAngle(Z, rz).applyAxisAngle(Y, ry).add(from);
  };
  const base = new THREE.Vector3();
  const mid = limb(base, 0.12, 0.009, 0.006, 0.08, 0);
  const top = limb(mid, 0.09, 0.006, 0.003, -0.22, 0.4);
  limb(top, 0.04, 0.003, 0.0012, 0.5, 2.0);
  for (const [k, len, rz, ry] of [[0.55, 0.07, 0.9, 0.3], [0.8, 0.06, 1.0, 2.4], [0.95, 0.05, 0.8, 4.2]]) {
    const from = base.clone().lerp(mid, k);
    const tip = limb(from, len, 0.004, 0.0018, rz, ry);
    limb(tip, 0.03, 0.0018, 0.0008, rz - 0.6, ry + 0.5);
  }
  for (const [len, rz, ry] of [[0.06, 0.8, 1.2], [0.05, 1.0, 3.6]]) {
    const tip = limb(top, len, 0.003, 0.0012, rz, ry);
    limb(tip, 0.025, 0.0012, 0.0006, rz + 0.4, ry - 0.6);
  }
  return mergeGeometries(parts);
}

/** A round-topped headstone, 2.4 cm wide and 3.4 cm tall, its face towards +z. */
function headstoneGeometry() {
  const w = 0.012;
  const h = 0.022;
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, h);
  s.absarc(0, h, w, 0, Math.PI, false);
  s.lineTo(-w, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: 8 });
  return g.translate(0, 0, -0.0025);
}

/**
 * A very low-poly gothic church (~0.3 m long, spire ~0.33 m), door towards +z: a stone nave under a steep roof, a
 * square bell tower with a four-sided spire and a cross, and pointed windows lit by candlelight.
 * Returns { body, windows } geometries: the body has vertex colours, the windows glow.
 */
function churchGeometry() {
  const wall = 0x5c5e66;
  const dark = 0x25272e;
  const body = [];
  const box = (w, h, d, x, y, z, hex) => body.push(tint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex));
  box(0.1, 0.08, 0.2, 0, 0, -0.02, wall); // nave
  const r = 0.064;
  body.push(tint(new THREE.CylinderGeometry(r, r, 0.21, 3).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, 0.08 + r / 2, -0.02), dark)); // roof
  box(0.07, 0.07, 0.07, 0, 0, -0.155, wall); // apse
  box(0.06, 0.17, 0.06, 0, 0, 0.1, wall); // bell tower
  box(0.066, 0.008, 0.066, 0, 0.17, 0.1, dark); // tower cornice
  body.push(tint(new THREE.ConeGeometry(0.046, 0.13, 4).rotateY(Math.PI / 4).translate(0, 0.178 + 0.065, 0.1), dark)); // spire
  box(0.003, 0.03, 0.003, 0, 0.306, 0.1, dark); // cross
  box(0.016, 0.003, 0.003, 0, 0.322, 0.1, dark);
  box(0.024, 0.04, 0.004, 0, 0, 0.131, 0x120d0a); // door
  for (const sx of [-1, 1]) box(0.012, 0.1, 0.012, sx * 0.056, 0, 0.045, wall); // buttresses by the tower
  const win = [];
  const pane = (w, h, x, y, z, ry) => {
    win.push(new THREE.BoxGeometry(w, h, 0.002).translate(0, h / 2, 0).rotateY(ry).translate(x, y, z));
    win.push(new THREE.ConeGeometry(w * 0.72, w * 1.1, 4).rotateY(Math.PI / 4).scale(1, 1, 0.12).rotateY(ry).translate(x, y + h + w * 0.5, z)); // pointed arch
  };
  for (const sx of [-1, 1]) for (const z of [-0.09, -0.03, 0.03]) pane(0.012, 0.028, sx * 0.051, 0.025, z, Math.PI / 2);
  pane(0.014, 0.03, 0, 0.1, 0.131, 0); // rose window over the door
  return { body: mergeGeometries(body), windows: mergeGeometries(win) };
}

/** A stone cross, 4.2 cm tall. */
function crossGeometry() {
  return mergeGeometries([
    new THREE.BoxGeometry(0.005, 0.042, 0.005).translate(0, 0.021, 0),
    new THREE.BoxGeometry(0.024, 0.005, 0.005).translate(0, 0.03, 0),
  ]);
}

/** Portal: an arch of light over the track with a shimmering veil inside. */
/**
 * A lane crossover on the deck, starting at `u0`: two diagonal slots in an X (lane 0 to lane 1 and back), each a black
 * groove between two rails, laid just over the straight slots. Same S-curve as a car's lane change (smoothstep).
 * Returns { groove, rails } geometries in world space.
 */
function crossoverGeometry(track, u0) {
  const N = 28;
  const P = new THREE.Vector3();
  const Q = new THREE.Quaternion();
  const S = new THREE.Vector3();
  const strip = (from, to, w0, w1, lift) => {
    const pos = [];
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      const off = from + (to - from) * k * k * (3 - 2 * k);
      track.frameAt(u0 + (XOVER_LEN * k) / track.length, 0, P, Q);
      S.set(1, 0, 0).applyQuaternion(Q);
      for (const w of [w0, w1]) pos.push(P.x + S.x * (off + w), P.y + lift, P.z + S.z * (off + w));
    }
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const [a, b] = LANE_OFFSETS;
  const grooves = [];
  const rails = [];
  for (const [from, to] of [[a, b], [b, a]]) {
    grooves.push(strip(from, to, -SLOT_HALF, SLOT_HALF, 0.0006));
    rails.push(strip(from, to, -SLOT_HALF - RAIL_W, -SLOT_HALF, 0.0008));
    rails.push(strip(from, to, SLOT_HALF, SLOT_HALF + RAIL_W, 0.0008));
  }
  return { groove: mergeGeometries(grooves), rails: mergeGeometries(rails) };
}

function buildPortal() {
  const g = new THREE.Group();
  const ringMat = glowM(0xb46bff, 0.6);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_R, 0.007, 10, 40, Math.PI), ringMat);
  g.add(arch);
  for (const x of [-PORTAL_R, PORTAL_R]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.012, 12), stone());
    foot.position.set(x, 0.006, 0);
    g.add(foot);
  }
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x2 = c.getContext('2d');
  const grd = x2.createRadialGradient(64, 128, 4, 64, 128, 128);
  grd.addColorStop(0, 'rgba(210,255,240,0.95)');
  grd.addColorStop(0.35, 'rgba(140,90,255,0.75)');
  grd.addColorStop(1, 'rgba(60,20,120,0)');
  x2.fillStyle = grd;
  x2.fillRect(0, 0, 128, 128);
  const veilTex = new THREE.CanvasTexture(c);
  veilTex.colorSpace = THREE.SRGBColorSpace;
  const veil = new THREE.Mesh(
    new THREE.CircleGeometry(PORTAL_R - 0.004, 32, 0, Math.PI),
    new THREE.MeshBasicMaterial({ map: veilTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  g.add(veil);
  return { group: g, ringMat, veil };
}

/** Bat roost: a dead tree. The swarm is one instanced mesh of small bat shapes (one draw call). */
function buildBats() {
  const tree = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x1b1620, roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.016, 0.26, 7), bark);
  trunk.position.y = 0.13;
  tree.add(trunk);
  for (const [y, a, l] of [[0.18, 0.9, 0.1], [0.22, -1.0, 0.09], [0.25, 0.5, 0.07], [0.15, -0.6, 0.08]]) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.005, l, 5), bark);
    br.position.set(Math.sin(a) * l * 0.45, y, Math.cos(a) * 0.01);
    br.rotation.z = -a;
    tree.add(br);
  }
  const eyes = glowM(0xffb347, 1.6);
  for (let i = 0; i < 4; i++) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 6, 5), eyes);
    e.position.set(-0.03 + i * 0.02, 0.2 + (i % 2) * 0.03, 0.008);
    tree.add(e);
  }
  // Bat silhouette: a body and two scalloped wings, in the XZ plane, nose along -Z.
  const v = [
    0, 0, -0.006, -0.004, 0, 0.004, 0.004, 0, 0.004, // body
    -0.003, 0, -0.003, -0.016, 0, -0.004, -0.011, 0, 0.003, // left wing
    -0.003, 0, -0.003, -0.011, 0, 0.003, -0.004, 0, 0.004,
    0.003, 0, -0.003, 0.016, 0, -0.004, 0.011, 0, 0.003, // right wing
    0.003, 0, -0.003, 0.011, 0, 0.003, 0.004, 0, 0.004,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x07060a, side: THREE.DoubleSide });
  const swarm = new THREE.InstancedMesh(geo, mat, BAT_COUNT);
  swarm.frustumCulled = false;
  // Fixed per-bat offsets (from the index, so every screen draws the same swarm).
  const seeds = [];
  for (let i = 0; i < BAT_COUNT; i++) {
    const h = (k) => {
      const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    seeds.push({ a: h(1) * Math.PI * 2, r: 0.025 + h(2) * 0.05, y: h(3) * 0.05, w: 2.5 + h(4) * 3, f: 18 + h(5) * 10 });
  }
  return { tree, swarm, seeds };
}

export class Monsters {
  /**
   * @param {THREE.Scene} scene
   * @param {object} audio SlotAudio
   * @param {object} sparks Sparks
   * @param {number} tableY
   */
  constructor(scene, audio, sparks, tableY) {
    this.audio = audio;
    this.sparks = sparks;
    this.tableY = tableY;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    // The dark scenery (grass, forest, graveyards, church, wisps) is set dressing: it shows in every mode. Only the
    // monsters, portals and crossovers under this.root are haunted-only.
    this.decor = new THREE.Group();
    this.decor.name = 'dark-scenery';
    scene.add(this.decor);
    this.shake = new THREE.Vector3();

    this.kaiju = buildKaiju();
    this.foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.12), stone());
    this.epiRing = ringMesh(EPI, 0xff2a1a);
    this.outRing = ringMesh(RING, 0xff7a4a);
    this.shock = ringMesh(0.12, 0xff8a5a);

    this.spider = buildSpider();
    this.spiderArch = this._arch();
    this.threads = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 1, 4), new THREE.MeshBasicMaterial({ color: 0xdfe8e0 }));
    this.webTex = webTexture();
    this.webs = [];

    this.phantom = buildPhantom();

    this.gargoyle = buildGargoyle();
    this.orb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), glowM(0x66ffcc, 2));
    this.orb.visible = false;
    this.landRing = ringMesh(0.09, 0x66ffcc);

    this.claws = [buildClaw(), buildClaw()];
    this.bats = buildBats();
    // Haunted ground: a grass carpet under the whole track (rebuilt to fit each circuit).
    this.grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, metalness: 0, color: 0xc4d0e6, side: THREE.DoubleSide });
    this.grassMat.map.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
    this.grass = new THREE.Mesh(new THREE.BufferGeometry(), this.grassMat);
    this.grass.receiveShadow = true;
    this.grass.name = 'haunted-grass';
    // Haunted scenery, rebuilt for each circuit: a forest along the carpet's edge and graveyards in the open grass.
    // Every kind is one InstancedMesh, so the whole lot costs six draw calls whatever the count.
    this.scenery = new THREE.Group();
    this.scenery.name = 'haunted-scenery';
    this.sceneryGeo = {
      pine: pineGeometry(),
      dead: deadTreeGeometry(),
      stone: headstoneGeometry(),
      cross: crossGeometry(),
      mound: new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2),
      bar: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      church: churchGeometry(),
    };
    this.sceneryMat = {
      tree: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x8a918d, roughness: 0.9, metalness: 0 }),
      mound: new THREE.MeshStandardMaterial({ color: 0x2a2619, roughness: 1, metalness: 0 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.5, metalness: 0.6 }),
      candle: new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffb347, emissiveIntensity: 1.4, roughness: 0.6 }),
    };
    this.church = new THREE.Group();
    this.church.name = 'haunted-church';
    const cb = new THREE.Mesh(this.sceneryGeo.church.body, this.sceneryMat.tree);
    cb.receiveShadow = true;
    this.church.add(cb, new THREE.Mesh(this.sceneryGeo.church.windows, this.sceneryMat.candle));
    this.church.visible = false;
    // Wisps: a swarm of small cold lights drifting over the grass around the church. Visual only: they touch no car
    // and are not synced, so they cannot change a race. Haunted only, because they live under this.root.
    const WISPS = 24;
    this.wisps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.0065, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x9ff7e0, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      WISPS,
    );
    this.wisps.name = 'haunted-wisps';
    this.wisps.frustumCulled = false;
    this.wispSeed = Array.from({ length: WISPS }, (_, i) => ({
      a: (i / WISPS) * Math.PI * 2,
      r: 0.1 + ((i * 37) % 17) / 17 * 0.2,
      w: 0.5 + ((i * 53) % 11) / 11 * 0.7,
      h: 0.02 + ((i * 29) % 7) / 7 * 0.05,
      ph: i * 1.7,
    }));
    this.wispT = 0;
    this.decor.add(this.wisps);
    // Three violet ghosts that drift over the grass around the church (haunted only: they live under this.root).
    this.ghosts = [0, 1, 2].map((i) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: ghostTexture(), transparent: true, depthWrite: false, fog: false }));
      m.scale.set(0.04, 0.05, 1);
      m.name = 'kiro-ghost';
      this.root.add(m);
      return { m, ph: i * 2.1, r: 0.22 + i * 0.08, w: 0.3 + i * 0.09, dash: null, cool: 2 + i * 1.5, u: 0 };
    });
    this.ghostT = 0;
    this.graveyards = []; // [{ x, z, hx, hz, graves }] for tests and tuning
    this.treeCount = 0;
    this.portals = Array.from({ length: MAX_PORTALS }, () => ({ ...buildPortal(), u: 0, used: false }));
    // Each portal's lane crossover: an X of slots on the deck, so the lane change is visible before the arch opens.
    this.xGroove = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, side: THREE.DoubleSide });
    for (const p of this.portals) {
      p.xRailMat = new THREE.MeshStandardMaterial({ color: 0xd7dade, emissive: 0xd7dade, emissiveIntensity: 0.22, roughness: 0.42, metalness: 0.15, side: THREE.DoubleSide });
      p.xover = new THREE.Group();
      p.xover.name = 'lane-crossover';
      p.xGrooveMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.xGroove);
      p.xRailMesh = new THREE.Mesh(new THREE.BufferGeometry(), p.xRailMat);
      p.xGrooveMesh.receiveShadow = p.xRailMesh.receiveShadow = true;
      p.xover.add(p.xGrooveMesh, p.xRailMesh);
      p.xover.visible = false;
    }

    this.puppet = false; // online guest: replay the host's events, decide nothing, hurt nobody
    this.events = []; // host: recent decisions [{ id, k, a, b, t }]
    this.evId = 0;
    this.lastEv = 0; // guest: newest event id applied
    this.inbox = []; // guest: events waiting for the next update (they need the cars)

    this.decor.add(this.grass, this.scenery, this.church);
    for (const o of [...this.portals.map((p) => p.group), ...this.portals.map((p) => p.xover), this.bats.tree, this.bats.swarm, this.kaiju.group, this.foot, this.epiRing, this.outRing, this.shock, this.spider.group, this.spiderArch, this.threads,
      this.phantom.group, this.gargoyle.group, this.orb, this.landRing, this.claws[0].group, this.claws[1].group]) {
      this.root.add(o);
    }
    this.reset();
  }

  _arch() {
    const g = new THREE.Group();
    const iron = stone();
    for (const x of [-0.12, 0.12]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.012), iron);
      post.position.set(x, 0.1, 0);
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.014), iron);
    beam.position.set(0, 0.2, 0);
    g.add(beam);
    return g;
  }

  setVisible(on) {
    this.root.visible = on;
    if (!on) this.reset();
  }

  /** Place every monster on the track in play. Places are picked from curvature and kept apart. */
  setTrack(track) {
    this.track = track;
    const N = 240;
    const curv = [];
    for (let i = 0; i < N; i++) curv.push(track.curvatureAt(i / N));
    const pick = (score, excl) => {
      let best = -1;
      let bv = -Infinity;
      for (let i = 0; i < N; i++) {
        const u = i / N;
        if (excl.some((e) => circ(u, e) < 0.15)) continue;
        const v = score(i);
        if (v > bv) {
          bv = v;
          best = i;
        }
      }
      return best < 0 ? 0 : best / N;
    };
    const winding = (i) => {
      let s = 0;
      for (let k = -10; k <= 10; k++) s += curv[(i + k + N) % N];
      return s;
    };
    // Godzilla stands only where no other part of the track comes near its body (the figure-8 crosses itself, and a body
    // beside the crossing sat on the wrong lane). Among those spots, the straightest one.
    const ptsK = Array.from({ length: N }, (_, j) => track.curve.getPointAt(j / N));
    const kaijuFits = (u) => {
      const P = track.curve.getPointAt(u);
      const T = track.tangentAt(u, _t.clone());
      const S = new THREE.Vector3().crossVectors(T, UP).normalize();
      const bx = P.x + S.x * KAIJU_SIDE;
      const bz = P.z + S.z * KAIJU_SIDE;
      for (let j = 0; j < N; j++) {
        if (circ(j / N, u) < 0.08) continue;
        if (Math.hypot(ptsK[j].x - bx, ptsK[j].z - bz) < 0.13) return false;
      }
      return true;
    };
    this.kaijuU = pick((i) => (kaijuFits(i / N) ? -curv[i] : -1e6), []); // the straightest clear point
    this.gargoyleU = pick((i) => curv[i], [this.kaijuU]); // the hairpin apex
    this.spiderU = (this.gargoyleU + 0.06) % 1; // the corner exit under the arch
    this.clawU = pick((i) => -curv[i], [this.kaijuU, this.gargoyleU, this.spiderU]); // another straight
    this.beamU = pick(winding, [this.kaijuU, this.gargoyleU, this.spiderU, this.clawU]);
    this.batU = (this.beamU + 0.5) % 1; // across the circuit from the phantom
    this._placeSkeletons(track);
    // Portals: up to three on straights, never next to an over-the-track structure (start gantry, banners), a bridge,
    // another monster's spot or another portal, so no two things above the track ever overlap.
    const over = [0, ...(track.overheads || [])];
    const busy = [this.kaijuU, this.gargoyleU, this.spiderU, this.clawU, this.beamU, this.batU];
    const chosen = [];
    const want = Math.min(MAX_PORTALS, Math.max(1, Math.round(track.length / 4)));
    const cand = [];
    for (let i = 0; i < N; i++) cand.push(i);
    cand.sort((a, b) => curv[a] - curv[b]); // straightest first
    // Ask for a wide gap first, then step it down: crowded circuits (many arches) still get portals, and even the
    // smallest gap keeps a clear stretch of track (about 30 cm at 150 %) between two things over the track.
    for (const [keep, kmax] of [[PORTAL_KEEP, 1.2], [0.04, 1.6], [0.025, 2.2]]) {
      for (const i of cand) {
        if (chosen.length >= want) break;
        const u = i / N;
        if (curv[i] > kmax) break;
        if (track.curve.getPointAt(u).y - this.tableY > 0.03) continue; // not on a bridge
        if (over.some((o) => circ(u, o) < keep)) continue;
        if (busy.some((b) => circ(u, b) < 0.06)) continue;
        if (chosen.some((c) => circ(u, c) < 0.12)) continue;
        chosen.push(u);
      }
      if (chosen.length >= Math.min(2, want)) break;
    }
    this.portals.forEach((p, k) => {
      p.used = k < chosen.length;
      p.u = chosen[k] ?? 0;
      p.group.visible = p.used;
    });

    const frame = (u) => {
      const P = track.curve.getPointAt(u);
      const T = track.tangentAt(u, _t.clone());
      const S = new THREE.Vector3().crossVectors(T, UP).normalize();
      return { P, T, S, yaw: Math.atan2(-T.x, -T.z) };
    };

    // Kaiju beside the straight, facing the track.
    const k = frame(this.kaijuU);
    this.kaijuHit = k.P.clone().addScaledVector(k.T, 0.02);
    this.kaiju.group.position.copy(k.P).addScaledVector(k.S, KAIJU_SIDE).setY(this.tableY);
    this.kaiju.group.rotation.y = Math.atan2(k.S.x, k.S.z);
    this.kaijuBase = this.kaiju.group.position.clone();
    this.kaijuAlong = k.T.clone().setY(0).normalize();
    this.epiRing.position.copy(this.kaijuHit).setY(this.tableY + 0.004);
    this.outRing.position.copy(this.kaijuHit).setY(this.tableY + 0.004);
    this.shock.position.copy(this.kaijuHit).setY(this.tableY + 0.005);

    // Spider arch over the corner exit.
    const sp = frame(this.spiderU);
    this.spiderFrame = sp;
    this.spiderArch.position.copy(sp.P).setY(this.tableY);
    this.spiderArch.rotation.y = sp.yaw;
    this.spider.group.position.copy(sp.P).setY(this.tableY + 0.2);
    this.spider.group.rotation.y = sp.yaw;

    // Gargoyle beside the apex; the orb is launched from its mouth.
    const g = frame(this.gargoyleU);
    this.gargoyle.group.position.copy(g.P).addScaledVector(g.S, -0.2).setY(this.tableY);
    this.gargoyle.group.rotation.y = Math.atan2(g.S.x, g.S.z);

    // Claws under each lane, on the straight.
    const c = frame(this.clawU);
    this.clawFrame = c;
    for (let i = 0; i < 2; i++) {
      const cg = this.claws[i].group;
      cg.position.copy(c.P).addScaledVector(c.S, LANE_OFFSETS[i]).setY(this.tableY - 0.04);
      cg.rotation.y = c.yaw;
    }

    // Bat roost beside the track, on the outside.
    const b = frame(this.batU);
    this.roost = b.P.clone().addScaledVector(b.S, 0.2).setY(this.tableY);
    this.bats.tree.position.copy(this.roost);
    this.bats.tree.rotation.y = Math.atan2(b.S.x, b.S.z);

    // Portal arch across the track, standing upright across it.
    for (const p of this.portals) {
      if (!p.used) continue;
      const pf = frame(p.u);
      p.group.position.copy(pf.P).setY(Math.max(pf.P.y, this.tableY) + 0.008);
      p.group.rotation.set(0, pf.yaw, 0);
    }
    for (const p of this.portals) {
      p.xover.visible = p.used;
      if (!p.used) continue;
      const x = crossoverGeometry(track, p.u);
      p.xGrooveMesh.geometry.dispose();
      p.xRailMesh.geometry.dispose();
      p.xGrooveMesh.geometry = x.groove;
      p.xRailMesh.geometry = x.rails;
    }

    // Grass carpet: the track's footprint plus a margin, with rounded corners, just under the deck.
    const box = new THREE.Box3();
    for (let i = 0; i < 240; i++) box.expandByPoint(track.curve.getPointAt(i / 240));
    const x0 = box.min.x - GRASS_MARGIN;
    const x1 = box.max.x + GRASS_MARGIN;
    const z0 = box.min.z - GRASS_MARGIN;
    const z1 = box.max.z + GRASS_MARGIN;
    const r = Math.min(GRASS_CORNER, (x1 - x0) / 4, (z1 - z0) / 4);
    const shape = new THREE.Shape();
    shape.moveTo(x0 + r, z0);
    shape.lineTo(x1 - r, z0);
    shape.quadraticCurveTo(x1, z0, x1, z0 + r);
    shape.lineTo(x1, z1 - r);
    shape.quadraticCurveTo(x1, z1, x1 - r, z1);
    shape.lineTo(x0 + r, z1);
    shape.quadraticCurveTo(x0, z1, x0, z1 - r);
    shape.lineTo(x0, z0 + r);
    shape.quadraticCurveTo(x0, z0, x0 + r, z0);
    const geo = new THREE.ShapeGeometry(shape, 12);
    // The shape is drawn in x/z: lay it flat (its UVs are metres, so the texture repeat sets the blade size).
    geo.rotateX(Math.PI / 2);
    this.grass.geometry.dispose();
    this.grass.geometry = geo;
    this.grass.position.y = this.tableY - 0.0015;
    this._buildScenery(track, { x0, x1, z0, z1, r });

    // Phantom over the winding section.
    this.beamCentre = track.curve.getPointAt(this.beamU);
    this.phantom.group.position.copy(this.beamCentre).setY(this.tableY + 0.5);

    this.reset();
  }

  /**
   * Keep the TV cameras' view open: hide every tree near a camera or standing between it and the stretch of track it
   * films (its zone). Called whenever the cameras are placed; hidden trees stay hidden for this circuit.
   */
  clearSightlines(track, cams) {
    if (!this.trees?.length || !cams.length) return 0;
    const segs = [];
    const q = new THREE.Vector3();
    for (const c of cams) {
      const span = (((c.zone1 - c.zone0) % 1) + 1) % 1 || 1;
      for (let k = 0; k <= 8; k++) {
        track.curve.getPointAt((((c.zone0 + (span * k) / 8) % 1) + 1) % 1, q);
        segs.push([c.pos.x, c.pos.z, q.x, q.z]);
      }
    }
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let hidden = 0;
    for (const m of this.trees) {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, m4);
        pos.setFromMatrixPosition(m4);
        if (m4.elements[0] === 0 && m4.elements[5] === 0) continue; // already hidden
        let block = false;
        for (const [ax, az, bx, bz] of segs) {
          const dx = bx - ax;
          const dz = bz - az;
          const t = Math.max(0, Math.min(1, ((pos.x - ax) * dx + (pos.z - az) * dz) / (dx * dx + dz * dz || 1)));
          const d = Math.hypot(ax + dx * t - pos.x, az + dz * t - pos.z);
          if (d < 0.09 || Math.hypot(pos.x - ax, pos.z - az) < 0.3) {
            block = true;
            break;
          }
        }
        if (block) {
          m.setMatrixAt(i, zero);
          hidden++;
        }
      }
      m.instanceMatrix.needsUpdate = true;
    }
    this.treesHidden = (this.treesHidden || 0) + hidden;
    return hidden;
  }

  /** True when the point (x, z) is over the green grass carpet (its rounded rectangle). */
  onGrass(x, z) {
    const g = this.rug;
    if (!g || x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1) return false;
    const qx = Math.max(g.x0 + g.r - x, x - (g.x1 - g.r), 0);
    const qz = Math.max(g.z0 + g.r - z, z - (g.z1 - g.r), 0);
    return Math.hypot(qx, qz) <= g.r;
  }

  /** Earthquake: the forest and the graveyards tremble on the carpet (`q` 0..1, cosmetic). */
  tremor(q) {
    if (q > 0 && this.root.visible) this.scenery.position.set((Math.random() - 0.5) * 0.004 * q, Math.random() * 0.0015 * q, (Math.random() - 0.5) * 0.004 * q);
    else if (this.scenery.position.lengthSq()) this.scenery.position.set(0, 0, 0);
  }

  /**
   * Haunted scenery for this circuit: graveyards in the largest open stretches of grass (each fenced, with rows of
   * headstones, crosses and grave mounds), then a forest of firs and dead trees in a band along the carpet's edge,
   * denser and taller towards the edge. Nothing comes near the track, the boards, the billboards or the monsters.
   * Seeded from the circuit, so both online players see the same layout.
   */
  _buildScenery(track, rug) {
    this.rug = { x0: rug.x0, x1: rug.x1, z0: rug.z0, z1: rug.z1, r: rug.r }; // the green grass, for cars that fall onto it
    for (const m of [...this.scenery.children]) {
      this.scenery.remove(m);
      m.dispose(); // instance buffers only: the geometries and materials are shared
    }
    this.graveyards = [];
    this.treeCount = 0;
    this.treesHidden = 0;
    const floorY = this.tableY - 0.0015;
    // Distance to the centreline as a 2 cm field over the carpet, stamped once from the curve: every placement test
    // below is then a lookup instead of a scan of the whole lap.
    const line = [];
    for (let i = 0; i < 600; i++) {
      const p = track.curve.getPointAt(i / 600);
      line.push(p.x, p.z);
    }
    const C = 0.02;
    const RMAX = 0.7;
    const fnx = Math.ceil((rug.x1 - rug.x0) / C) + 1;
    const fnz = Math.ceil((rug.z1 - rug.z0) / C) + 1;
    const field = new Float32Array(fnx * fnz).fill(RMAX);
    const W = Math.ceil(RMAX / C);
    for (let k = 0; k < line.length; k += 2) {
      const px = line[k];
      const pz = line[k + 1];
      const ci = Math.round((px - rug.x0) / C);
      const cj = Math.round((pz - rug.z0) / C);
      for (let i = Math.max(0, ci - W); i <= Math.min(fnx - 1, ci + W); i++) {
        for (let j = Math.max(0, cj - W); j <= Math.min(fnz - 1, cj + W); j++) {
          const d = Math.hypot(rug.x0 + i * C - px, rug.z0 + j * C - pz);
          if (d < field[i * fnz + j]) field[i * fnz + j] = d;
        }
      }
    }
    const distTrack = (x, z) => {
      const i = Math.round((x - rug.x0) / C);
      const j = Math.round((z - rug.z0) / C);
      if (i < 0 || j < 0 || i >= fnx || j >= fnz) return RMAX;
      return field[i * fnz + j] - C * 0.71; // a cell's half-diagonal: never closer than it looks
    };
    const boxes = [];
    track.group.updateMatrixWorld(true);
    track.group.traverse((o) => {
      if (o.name === 'sponsor' || o.name === 'billboard') boxes.push(new THREE.Box3().setFromObject(o));
    });
    for (const o of [this.kaiju.group, this.gargoyle.group, this.bats.tree]) boxes.push(new THREE.Box3().setFromObject(o).expandByScalar(0.05));
    const distBox = (x, z, list = boxes) => {
      let m = Infinity;
      for (const b of list) m = Math.min(m, Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z)));
      return m;
    };
    const cx = (rug.x0 + rug.x1) / 2;
    const cz = (rug.z0 + rug.z1) / 2;
    const ex = (rug.x1 - rug.x0) / 2 - rug.r;
    const ez = (rug.z1 - rug.z0) / 2 - rug.r;
    const inset = (x, z) => {
      // Depth inside the rounded carpet (negative outside it).
      const qx = Math.abs(x - cx) - ex;
      const qz = Math.abs(z - cz) - ez;
      return rug.r - Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) - Math.min(Math.max(qx, qz), 0);
    };
    const rnd = seeded(Math.round(line[0] * 7919 + line[1] * 104729 + track.length * 1000) * 2654435761);

    // ---- graveyards: up to three, largest first
    const yards = [];
    const blocked = []; // the church's footprint
    const clear = (x, z) => Math.min(distTrack(x, z) - GRAVE_CLEAR, distBox(x, z) - 0.05, inset(x, z) - FOREST_BAND * 0.6, distBox(x, z, yards) - 0.1, distBox(x, z, blocked) - 0.06);
    const fits = (x, z, hx, hz) => {
      const nx = Math.ceil((2 * hx) / 0.03);
      const nz = Math.ceil((2 * hz) / 0.03);
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) if (clear(x - hx + (2 * hx * i) / nx, z - hz + (2 * hz * j) / nz) < 0) return false;
      return true;
    };
    // ---- the church: on the most open patch of grass, its door towards the camera side (+z)
    {
      let best = null;
      let bc = 0.17; // needs about 17 cm all round
      for (let x = rug.x0; x <= rug.x1; x += 0.05) {
        for (let z = rug.z0; z <= rug.z1; z += 0.05) {
          const c = clear(x, z);
          if (c > bc) {
            bc = c;
            best = [x, z];
          }
        }
      }
      this.church.visible = !!best;
      this.churchAt = best;
      if (best) {
        this.church.position.set(best[0], floorY, best[1]);
        this.church.rotation.y = (rnd() - 0.5) * 0.5;
        blocked.push(new THREE.Box3(new THREE.Vector3(best[0] - 0.09, 0, best[1] - 0.2), new THREE.Vector3(best[0] + 0.09, 0, best[1] + 0.16)));
      }
    }

    for (let n = 0; n < 3; n++) {
      let best = null;
      let bc = 0.06;
      for (let x = rug.x0; x <= rug.x1; x += 0.05) {
        for (let z = rug.z0; z <= rug.z1; z += 0.05) {
          const c = clear(x, z);
          if (c > bc) {
            bc = c;
            best = [x, z];
          }
        }
      }
      if (!best) break;
      let hx = 0.05;
      let hz = 0.05;
      let gx = true;
      let gz = true;
      while (gx || gz) {
        if (gx) {
          if (hx < 0.3 && fits(best[0], best[1], hx + 0.015, hz)) hx += 0.015;
          else gx = false;
        }
        if (gz) {
          if (hz < 0.22 && fits(best[0], best[1], hx, hz + 0.015)) hz += 0.015;
          else gz = false;
        }
      }
      if (hx < 0.08 || hz < 0.065) break;
      const yard = new THREE.Box3(new THREE.Vector3(best[0] - hx, 0, best[1] - hz), new THREE.Vector3(best[0] + hx, 0, best[1] + hz));
      yard.userData = { x: best[0], z: best[1], hx, hz };
      yards.push(yard);
    }

    const stones = [];
    const crosses = [];
    const mounds = [];
    const bars = [];
    const dead = [];
    const pines = [];
    const GATE = 0.035;
    for (const yard of yards) {
      const { x: gx, z: gz, hx, hz } = yard.userData;
      let graves = 0;
      // Rows across x, every grave facing +z with its mound in front.
      for (let z = gz - hz + 0.022; z <= gz + hz - 0.05; z += 0.075) {
        const shift = rnd() * 0.02;
        for (let x = gx - hx + 0.02 + shift; x <= gx + hx - 0.02; x += 0.05) {
          if (rnd() > 0.55) continue; // gaps: an old cemetery, not a full grid
          const px = x + (rnd() - 0.5) * 0.008;
          const pz = z + (rnd() - 0.5) * 0.008;
          const lean = rnd() < 0.3 ? [(rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.4] : [0, 0];
          const kind = rnd();
          const g = { x: px, z: pz, yaw: (rnd() - 0.5) * 0.3, rx: lean[0], rz: lean[1], tall: kind > 0.9 ? 1.5 : 0.9 + rnd() * 0.25, shade: 0.55 + rnd() * 0.4, moss: rnd() * 0.08 };
          (kind < 0.25 ? crosses : stones).push(g);
          if (rnd() < 0.75) mounds.push({ x: px, z: pz + 0.026, l: 0.018 + rnd() * 0.006 });
          graves++;
        }
      }
      // Iron fence: posts every 3 cm and two rails, with a gate gap in the front.
      const post = (x, z, h = 0.034) => bars.push({ x, z, y: 0, sx: 0.0025, sy: h, sz: 0.0025, yaw: 0 });
      const rail = (x0, z0, x1, z1) => {
        for (const y of [0.008, 0.026]) bars.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y, sx: Math.hypot(x1 - x0, z1 - z0), sy: 0.0018, sz: 0.0015, yaw: Math.atan2(-(z1 - z0), x1 - x0) });
      };
      const x0 = gx - hx;
      const x1 = gx + hx;
      const z0 = gz - hz;
      const z1 = gz + hz;
      for (let i = 0, n = Math.ceil((x1 - x0) / 0.03); i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        post(x, z0);
        if (Math.abs(x - gx) > GATE) post(x, z1);
      }
      for (let i = 1, n = Math.ceil((z1 - z0) / 0.03); i < n; i++) {
        const z = z0 + ((z1 - z0) * i) / n;
        post(x0, z);
        post(x1, z);
      }
      post(gx - GATE, z1, 0.046);
      post(gx + GATE, z1, 0.046);
      rail(x0, z0, x1, z0);
      rail(x0, z0, x0, z1);
      rail(x1, z0, x1, z1);
      rail(x0, z1, gx - GATE, z1);
      rail(gx + GATE, z1, x1, z1);
      // A dead tree in each back corner, leaning over the graves.
      for (const sx of [-1, 1]) dead.push({ x: gx + sx * (hx - 0.03), z: z0 + 0.03, s: 0.85 + rnd() * 0.25, yaw: rnd() * Math.PI * 2, edge: 0.4 });
      this.graveyards.push({ x: +gx.toFixed(3), z: +gz.toFixed(3), hx: +hx.toFixed(3), hz: +hz.toFixed(3), graves });
    }

    // ---- small groups of lonely graves, scattered over the open grass wherever there is no track
    const groups = [];
    for (let tries = 0; tries < 160 && groups.length < 12; tries++) {
      const x = rug.x0 + rnd() * (rug.x1 - rug.x0);
      const z = rug.z0 + rnd() * (rug.z1 - rug.z0);
      if (clear(x, z) < 0.03 || distBox(x, z, yards) < 0.12 || groups.some((g) => Math.hypot(g[0] - x, g[1] - z) < 0.3)) continue;
      groups.push([x, z]);
      const n = 2 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const r = 0.015 + rnd() * 0.05;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const kind = rnd();
        const g = { x: px, z: pz, yaw: (rnd() - 0.5) * 0.9, rx: (rnd() - 0.5) * 0.5, rz: (rnd() - 0.5) * 0.4, tall: 0.85 + rnd() * 0.3, shade: 0.5 + rnd() * 0.4, moss: rnd() * 0.1 };
        if (clear(px, pz) < 0) continue;
        (kind < 0.35 ? crosses : stones).push(g);
        if (rnd() < 0.5) mounds.push({ x: px, z: pz + 0.026, l: 0.016 + rnd() * 0.006 });
      }
      if (rnd() < 0.4) dead.push({ x: x + 0.04, z: z - 0.03, s: 0.7 + rnd() * 0.3, yaw: rnd() * Math.PI * 2, edge: 0.3 });
    }
    this.graveGroups = groups.length;

    // ---- forest along the carpet's edge
    for (let x = rug.x0; x <= rug.x1; x += TREE_SPACING) {
      for (let z = rug.z0; z <= rug.z1; z += TREE_SPACING) {
        const px = x + (rnd() - 0.5) * TREE_SPACING * 0.9;
        const pz = z + (rnd() - 0.5) * TREE_SPACING * 0.9;
        const pick = rnd();
        const kind = rnd();
        const scale = rnd();
        const yaw = rnd() * Math.PI * 2;
        const d = inset(px, pz);
        if (d < 0.012 || d > FOREST_BAND) continue;
        const edge = 1 - d / FOREST_BAND; // 1 at the carpet's edge
        if (pick > 0.3 + 0.7 * edge) continue; // thinner towards the track
        if (distTrack(px, pz) < TRACK_CLEAR || distBox(px, pz) < 0.06 || distBox(px, pz, yards) < 0.04 || distBox(px, pz, blocked) < 0.05) continue;
        (kind < 0.68 ? pines : dead).push({ x: px, z: pz, s: 0.7 + 0.75 * edge + scale * 0.35, yaw, edge });
      }
    }
    this.treeCount = pines.length + dead.length;

    // ---- one InstancedMesh per kind
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const inst = (name, geo, mat, list, place, shadow) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      m.name = name;
      list.forEach((it, i) => {
        const c = place(it);
        m.setMatrixAt(i, m4.compose(p, q.setFromEuler(e), s));
        if (c) m.setColorAt(i, c);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = shadow; // nothing in the scenery casts shadows: it would redraw every instance in the shadow pass
      m.receiveShadow = true;
      m.computeBoundingSphere();
      this.scenery.add(m);
    };
    const tree = (t, stretch) => {
      p.set(t.x, floorY, t.z);
      e.set((rnd() - 0.5) * 0.12, t.yaw, (rnd() - 0.5) * 0.12);
      s.set(t.s, t.s * stretch, t.s);
      const v = 1 - 0.45 * t.edge; // the deep forest fades into the night
      return col.setRGB(v, v, v * 1.04);
    };
    inst('forest-pines', this.sceneryGeo.pine, this.sceneryMat.tree, pines, (t) => tree(t, 0.9 + rnd() * 0.35), false);
    inst('forest-dead', this.sceneryGeo.dead, this.sceneryMat.tree, dead, (t) => tree(t, 1), false);
    this.trees = this.scenery.children.filter((m) => m.name.startsWith('forest'));
    const grave = (g) => {
      p.set(g.x, floorY - 0.001, g.z);
      e.set(g.rx, g.yaw, g.rz);
      s.set(1, g.tall, 1);
      return col.setRGB(g.shade, g.shade + g.moss, g.shade * 0.97);
    };
    inst('graves-stones', this.sceneryGeo.stone, this.sceneryMat.stone, stones, grave, false);
    inst('graves-crosses', this.sceneryGeo.cross, this.sceneryMat.stone, crosses, grave, false);
    inst('graves-mounds', this.sceneryGeo.mound, this.sceneryMat.mound, mounds, (g) => {
      p.set(g.x, floorY, g.z);
      e.set(0, 0, 0);
      s.set(0.011, 0.004, g.l);
      return null;
    }, false);
    inst('graves-fence', this.sceneryGeo.bar, this.sceneryMat.iron, bars, (b) => {
      p.set(b.x, floorY + b.y, b.z);
      e.set(0, b.yaw, 0);
      s.set(b.sx, b.sy, b.sz);
      return null;
    }, false);
  }

  reset() {
    this.t = 0;
    this.phaseT = 0;
    this.phase = 'idle';
    this.timer = 4;
    this.swipeT = null; // the head swipe (null when none is running)
    this.swipeTimer = 8;
    this.shockT = 0;
    this.shakeT = 0;
    this.ringT = 0;
    this.webs.forEach((w) => this.root.remove(w.mesh));
    this.webs = [];
    for (const p of this.pumpkins || []) this.root.remove(p.mesh);
    this.pumpkins = [];
    this.webTimer = 3;
    this.pumpkins = [];
    this.pumpkinTimer = 4;
    for (const k of this.skeletons || []) {
      k.state = 'idle';
      k.t = 0;
      k.cool = 3 + Math.random() * 3;
      k.arm.rotation.x = -Math.PI / 2;
    }
    this.pounceTimer = 19;
    this.pounce = null;
    this.orbTimer = 3;
    this.orbFlight = null;
    this.landing = null;
    this.clawT = [0, 0];
    this.clawLane = 0;
    this.clawState = 'idle';
    this.clawNext = 3;
    this.traction = new Map();
    this.phantomT = 0;
    this.beamOn = false;
    this.landingU = -1;
    for (const p of this.portals) {
      p.state = 'closed';
      p.t = 0;
      p.next = 3;
      p.prevU = new Map();
      p.veil.material.opacity = 0;
      p.ringMat.emissiveIntensity = 0.5;
    }
    this.portalSwaps = 0;
    this.batState = 'rest';
    this.batT = 0;
    this.batNext = 6;
    this.batTarget = null;
    this.batLevel = 0;
    this.batPos = new THREE.Vector3();
    this.events = [];
    this.inbox = [];
    this.kaiju.plateMat.emissiveIntensity = 0.4;
    this.kaiju.eyeMat.emissiveIntensity = 0.8;
    this.kaiju.jaw.rotation.x = 0;
    this.foot.position.y = this.tableY + 0.1;
    this.epiRing.material.opacity = 0;
    this.outRing.material.opacity = 0;
    this.shock.material.opacity = 0;
    this.landRing.material.opacity = 0;
    this.orb.visible = false;
    this.spider.group.position.y = this.tableY + 0.2;
    this.threads.visible = false;
    this.audio.kaijuCharge(false);
    this.audio.warble(0);
    this.audio.clawRumble(false);
    this.audio.batSwarm(0);
  }

  // ------------------------------------------------------------ online: host events, guest puppet

  /** Guest side on or off. Turning it on forgets old event ids (a new host numbers from its own count). */
  setPuppet(on) {
    this.puppet = on;
    this.lastEv = 0;
    this.inbox = [];
  }

  _emit(k, a = 0, b = 0) {
    if (this.puppet) return;
    this.events.push({ id: ++this.evId, k, a, b, t: this.t });
    const cut = this.t - EVENT_KEEP;
    while (this.events.length && this.events[0].t < cut) this.events.shift();
  }

  /** Host: compact state for a snapshot. */
  exportState() {
    const r = (n) => Math.round(n * 1000) / 1000;
    return { t: r(this.t), ph: r(this.phantomT), ev: this.events.map((e) => [e.id, e.k, r(e.a), r(e.b), r(e.t)]) };
  }

  /** Guest: queue the host's new events. `age` is how old the snapshot is (s). Network data: validated here. */
  importState(st, age) {
    if (!st || typeof st.t !== 'number' || !Array.isArray(st.ev)) return;
    if (typeof st.ph === 'number' && Number.isFinite(st.ph)) {
      const want = st.ph + age;
      // Follow the host closely: a slow frame rate on either side must not let the beam drift apart.
      this.phantomT = Math.abs(want - this.phantomT) > 0.15 ? want : this.phantomT + (want - this.phantomT) * 0.6;
    }
    for (const e of st.ev) {
      if (!Array.isArray(e) || e.length < 5 || !e.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
      const [id, k, a, b, t] = e;
      if (id <= this.lastEv) continue;
      this.lastEv = id;
      this.inbox.push({ k, a, b, ff: Math.min(1, Math.max(0, st.t - t + age)) });
    }
  }

  _applyInbox(cars) {
    for (const e of this.inbox) {
      if (e.k === EV.kaiju) this._startCharge(e.ff);
      else if (e.k === EV.web) this._dropWeb(((e.a % 1) + 1) % 1, e.b === 0 || e.b === 1 ? e.b : -1, e.ff);
      else if (e.k === EV.pumpkin) this._hopPumpkin(((e.a % 1) + 1) % 1, e.b === 1 ? 1 : 0, e.ff);
      else if (e.k === EV.swipe) this.swipeT = 0;
      else if (e.k === EV.skel && this.skeletons?.[e.a | 0]) this._startSkel(e.a | 0, e.ff);
      else if (e.k === EV.ghost) this._startGhost(e.a | 0, e.b | 0, e.ff);
      else if (e.k === EV.pounce && cars[e.a | 0]) this.pounce = { car: cars[e.a | 0], t: e.ff };
      else if (e.k === EV.orb) this._launchOrb(((e.a % 1) + 1) % 1, e.ff);
      else if (e.k === EV.claw) this._startClaw(e.a === 1 ? 1 : 0, e.ff);
      else if (e.k === EV.bats && cars[e.a | 0]) this._startBats(cars[e.a | 0], e.ff);
      else if (e.k === EV.portal && this.portals[e.a | 0]) this._openPortal(e.a | 0, e.ff);
    }
    this.inbox.length = 0;
  }

  /** Speed cap (m/s) the AI should respect at track fraction `u` in `lane`. caution 0 = Maniac ignores the zones. */
  capAt(u, caution, lane = 0) {
    if (!caution || !this.root.visible || !this.track) return Infinity;
    let cap = Infinity;
    if (this.phase === 'charge' || this.phase === 'slam') {
      if (circ(u, this.kaijuU) < 0.04) cap = Math.min(cap, 0.3);
    }
    for (const w of this.webs) if (circ(u, w.u) < 0.02 && (w.lane < 0 || w.lane === lane)) cap = Math.min(cap, 0.5);
    if (this.beamOn && circ(u, this.beamU) < 0.07) cap = Math.min(cap, 0.9);
    if (this.landingU >= 0 && circ(u, this.landingU) < 0.03) cap = Math.min(cap, 0.6);
    if (this.clawState !== 'idle' && this.clawLane === lane && circ(u, this.clawU) < 0.04) {
      cap = Math.min(cap, this.clawState === 'telegraph' ? 0.5 : 0.2);
    }
    return cap;
  }

  /**
   * Advance every monster. `active` is true during a Haunted race.
   * @returns {THREE.Vector3} camera shake offset for this frame
   */
  /** A Shift immunity is running on this car: hazard hits do nothing to it. */
  _shielded(c) {
    return c.shield > 0;
  }

  /** Move the wisps: each one circles its own path over the grass near the church, bobbing up and down. */
  /** The ghosts float in slow circles over the grass, bobbing as they go. */
  _ghosts(dt, cars = []) {
    if (!this.ghosts) return;
    this.ghostT += dt;
    const cx = this.church.visible ? this.church.position.x : 0;
    const cz = this.church.visible ? this.church.position.z : 0;
    const L = this.track?.length || 1;
    // Each car's speed in lap fractions per second (measured from its position), for the ghosts to match.
    for (const c of cars) {
      let d = c.u - (c._gU ?? c.u);
      if (d > 0.5) d -= 1;
      if (d < -0.5) d += 1;
      c._gRate = dt > 0 ? d / dt : 0;
      c._gU = c.u;
    }
    this.ghosts.forEach((g, gi) => {
      if (g.dash) {
        this._ghostDash(g, dt, cars, L);
        return;
      }
      g.cool -= dt;
      if (!this.puppet && g.cool <= 0) {
        const target = cars.filter((c) => c.state === 'running' && c.mesh.visible && c.blinkT <= 0);
        if (target.length) {
          const car = target[Math.floor(Math.random() * target.length)];
          this._startGhost(gi, cars.indexOf(car), 0);
          this._emit(EV.ghost, gi, cars.indexOf(car));
        } else g.cool = 1;
      }
      const a = g.ph + this.ghostT * g.w;
      g.m.position.set(cx + Math.cos(a) * g.r, this.tableY + 0.11 + Math.sin(this.ghostT * 1.3 + g.ph) * 0.02, cz + Math.sin(a) * g.r);
    });
  }

  /** A ghost starts its swoop on car `ci` (the host picks it; guests replay it). */
  _startGhost(gi, ci, ff = 0) {
    const g = this.ghosts?.[gi];
    if (!g || g.dash) return;
    const car = this._cars?.[ci];
    if (!car) return;
    g.dash = { car, t: ff, rate: car._gRate ?? 0, hit: false };
    g.u = car.u - GHOST_GAP / (this.track?.length || 1);
  }

  /** One second of the swoop: the ghost keeps pace behind the car; a car that brakes lets it catch up and be hit. */
  _ghostDash(g, dt, cars, L) {
    const d = g.dash;
    const car = d.car;
    d.t += dt;
    if (car.state !== 'running' || !car.mesh.visible) {
      g.dash = null;
      g.cool = GHOST_COOL[0];
      return;
    }
    g.u += d.rate * dt; // the ghost keeps the speed the car had when the swoop began, so a braking car lets it catch up
    this.track.frameAt(g.u, car.offset, g.m.position, _spinQ);
    g.m.position.y += 0.07;
    let gap = car.u - g.u;
    if (gap > 0.5) gap -= 1;
    if (gap < -0.5) gap += 1;
    if (!this.puppet && !d.hit && gap * L <= 0.01 && gap >= -0.01) {
      d.hit = true;
      car.batT = Math.max(car.batT, GHOST_SLOW); // the ghost catches it and drags it: it crawls for a while, it does not come off the slot
      this.sparks.emit(car.position, 16, 1.2);
    }
    if (d.hit || d.t >= GHOST_DASH) {
      g.dash = null;
      g.cool = GHOST_COOL[0] + Math.random() * (GHOST_COOL[1] - GHOST_COOL[0]);
    }
  }

  _wisps(dt) {
    if (!this.wisps) return;
    this.wispT += dt;
    const cx = this.church.visible ? this.church.position.x : 0;
    const cz = this.church.visible ? this.church.position.z : 0;
    const y0 = this.tableY + 0.03;
    this.wispSeed.forEach((w, i) => {
      const a = w.a + this.wispT * w.w;
      const x = cx + Math.cos(a) * w.r;
      const z = cz + Math.sin(a) * w.r;
      const y = y0 + Math.sin(this.wispT * 2 + w.ph) * w.h;
      _m4.makeTranslation(x, y, z);
      this.wisps.setMatrixAt(i, _m4);
    });
    this.wisps.instanceMatrix.needsUpdate = true;
  }

  update(dt, active, cars) {
    this._cars = cars; // the ghosts swoop onto these cars (guests read them when replaying a swoop)
    this._wisps(dt); // the dark scenery moves in every mode
    this._ghosts(dt, cars);
    const shake = this.shake.set(0, 0, 0);
    for (const c of cars) {
      c.hazardGrip = 1;
      c.lift = 0;
    }
    this.beamOn = false;
    if (!this.track || !this.root.visible) return shake;
    if (!active) {
      if (this.phase !== 'idle' || this.clawState !== 'idle' || this.webs.length || this.batState !== 'rest' || this.portals.some((p) => p.state !== 'closed')) this.reset();
      this._restBats(dt);
      this._kaijuIdle(dt);
      return shake;
    }
    this.t += dt;
    if (this.puppet) this._applyInbox(cars);
    if (!this.puppet) this._sameLane(cars); // the host decides: a faster car behind that runs into one in its lane

    // Traction loss from the outer shockwave.
    for (const [car, until] of this.traction) {
      if (this.t > until) this.traction.delete(car);
      else car.hazardGrip = Math.min(car.hazardGrip, 0.5);
    }

    this._kaiju(dt, cars, shake);
    this._spider(dt, cars);
    this._pumpkins(dt, cars);
    this._skeletons(dt, cars);
    this._phantom(dt, cars);
    this._gargoyle(dt, cars);
    this._claws(dt, cars);
    this._bats(dt, cars);
    this._portal(dt, cars);
    return shake;
  }

  // ---- 1. Kaiju
  /** The kaiju is never quite still: it paces a little beside the track, rocks, breathes and swishes its tail. */
  _kaijuIdle(dt) {
    if (!this.kaijuBase) return;
    this.idleT = (this.idleT || 0) + dt;
    const t = this.idleT;
    const K = this.kaiju;
    const calm = this.phase === 'charge' || this.phase === 'slam' ? 0.3 : 1;
    const pace = 0.035 * Math.sin(t * 0.45) * calm;
    K.group.position.x = this.kaijuBase.x + this.kaijuAlong.x * pace;
    K.group.position.z = this.kaijuBase.z + this.kaijuAlong.z * pace;
    K.group.rotation.z = 0.06 * Math.sin(t * 1.3) * calm;
    K.torso.scale.set(1.9, 1 + 0.05 * Math.sin(t * 2.2), 1.1);
    K.tail.rotation.y = 0.45 * Math.sin(t * 1.7);
    K.plates.forEach((p, i) => (p.position.y = 0.24 + 0.008 * Math.sin(t * 3 - i * 0.6)));
    if (this.phase === 'idle') K.head.rotation.x = 0.12 * Math.sin(t * 0.9);
  }

  _kaiju(dt, cars, shake) {
    const K = this.kaiju;
    this._kaijuIdle(dt);
    this.phaseT = this.phaseT || 0;
    let near = null;
    let nd = Infinity;
    for (const c of cars) {
      if (!c.mesh.visible || c.state !== 'running') continue;
      const d = Math.hypot(c.position.x - this.kaiju.group.position.x, c.position.z - this.kaiju.group.position.z);
      if (d < nd) {
        nd = d;
        near = c;
      }
    }
    if (near) {
      const yaw = Math.atan2(near.position.x - this.kaiju.group.position.x, near.position.z - this.kaiju.group.position.z) - this.kaiju.group.rotation.y;
      const want = Math.max(-1.1, Math.min(1.1, Math.atan2(Math.sin(yaw), Math.cos(yaw))));
      K.head.rotation.y += (want - K.head.rotation.y) * Math.min(1, dt * 4);
    }
    // Head swipe: the head sweeps across the lanes and drops low over the track; a car under it is knocked off.
    if (!this.puppet && this.swipeT === null) {
      this.swipeTimer -= dt;
      if (this.swipeTimer <= 0) {
        this.swipeT = 0;
        this.swipeTimer = 9 + Math.random() * 5;
        this._emit(EV.swipe);
      }
    }
    if (this.swipeT !== null) {
      this.swipeT += dt;
      const k = Math.min(1, this.swipeT / SWIPE_TIME);
      const e = k * k * (3 - 2 * k);
      K.head.rotation.y = -1.0 + 2.0 * e;
      K.head.position.y = 0.23 - 0.18 * Math.sin(Math.PI * k); // down to track height at the middle of the sweep
      const tip = new THREE.Vector3();
      K.head.getWorldPosition(tip);
      if (!this.puppet && tip.y - this.tableY < 0.09) {
        for (const c of cars) {
          if (c.state !== 'running' || !c.mesh.visible || c.blinkT > 0) continue;
          if (Math.hypot(c.position.x - tip.x, c.position.z - tip.z) < 0.03) {
            c._derail(true); // swept off the slot
            this.sparks.emit(c.position, 16, 1.2);
          }
        }
      }
      if (k >= 1) {
        this.swipeT = null;
        K.head.position.y = 0.23;
      }
    }
    const rise = this.phase === 'charge' ? Math.min(1, this.phaseT / KAIJU_CHARGE) : this.phase === 'slam' ? 1 : 0;
    K.jaw.rotation.x = -0.55 * rise;
    for (const a of K.arms) a.rotation.z = a.userData.side * (0.3 + 0.9 * rise);
    K.eyeMat.emissiveIntensity = 0.8 + 2.2 * rise;
    K.mouthMat.emissiveIntensity = 0.4 + 2.6 * rise;

    this.phaseT += dt;
    if (this.phase === 'idle') {
      this.timer -= dt;
      K.plateMat.emissiveIntensity = 0.4;
      if (this.timer <= 0 && !this.puppet) {
        this._startCharge(0);
        this._emit(EV.kaiju);
      }
    } else if (this.phase === 'charge') {
      const k = Math.min(1, this.phaseT / KAIJU_CHARGE);
      K.plateMat.emissiveIntensity = 0.4 + 2.6 * k;
      this.epiRing.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(this.phaseT * 9));
      this.outRing.material.opacity = 0.12 + 0.2 * Math.abs(Math.sin(this.phaseT * 9));
      this.kaiju.group.position.y = this.tableY + 0.004 * Math.sin(this.phaseT * 40);
      if (this.phaseT >= KAIJU_CHARGE) {
        this.phase = 'slam';
        this.phaseT = 0;
        this.audio.kaijuCharge(false);
      }
    } else if (this.phase === 'slam') {
      const k = Math.min(1, this.phaseT / SLAM_TIME);
      this.foot.position.y = this.tableY + 0.1 - 0.09 * k * k;
      if (this.phaseT >= SLAM_TIME) {
        this.foot.position.y = this.tableY + 0.01;
        this.audio.stomp();
        this.sparks.emit(this.kaijuHit, 30, 1.6);
        this.shockT = 0.7;
        this.shakeT = 0.6;
        this.ringT = 0.7;
        for (const c of this.puppet ? [] : cars) {
          if (c.state !== 'running' || !c.mesh.visible || c.blinkT > 0) continue;
          const d = Math.hypot(c.position.x - this.kaijuHit.x, c.position.z - this.kaijuHit.z);
          if (d < EPI) c._derail(true); // epicentre: de-slotted
          else if (d < RING && !this._shielded(c)) {
            c.jolt(0.35); // outer ring: thrown off its line, traction lost for a moment
            this.traction.set(c, this.t + 0.8);
            this.sparks.emit(c.position, 12, 1);
          }
        }
        this.phase = 'recover';
        this.phaseT = 0;
      }
    } else if (this.phase === 'recover') {
      const k = Math.min(1, this.phaseT / RECOVER_TIME);
      this.foot.position.y = this.tableY + 0.01 + 0.09 * k;
      this.epiRing.material.opacity = 0;
      this.outRing.material.opacity = 0;
      K.plateMat.emissiveIntensity = 0.4 + 1.2 * (1 - k);
      if (this.phaseT >= RECOVER_TIME) {
        this.phase = 'idle';
        this.timer = 8 + Math.random() * 4;
        this.phaseT = 0;
        this.kaiju.group.position.y = this.tableY;
      }
    }
    if (this.shockT > 0) {
      this.shockT -= dt;
      const k = 1 - Math.max(0, this.shockT) / 0.7;
      this.shock.scale.setScalar(0.5 + 3.5 * k);
      this.shock.material.opacity = 0.7 * (1 - k);
    } else {
      this.shock.material.opacity = 0;
    }
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const amp = 0.025 * Math.max(0, this.shakeT / 0.6);
      shake.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }
  }

  /**
   * Two cars in the same lane: when the faster one catches up with the car ahead, it hits it from behind and the car
   * ahead is derailed. Only the car that is hit comes off; the one behind keeps running. Host-decided, so a guest sees
   * it in the snapshots.
   */
  _sameLane(cars) {
    const L = this.track?.length;
    if (!L) return;
    const live = cars.filter((c) => c.state === 'running' && c.mesh.visible && !c.swap && !c.kinematic);
    for (let i = 0; i < live.length; i++) {
      for (let j = 0; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (i === j || a.lane !== b.lane) continue;
        // How far a is ahead of b, in metres (the lap wraps).
        let d = a.u - b.u;
        if (d > 0.5) d -= 1;
        if (d < -0.5) d += 1;
        const gap = d * L;
        // a is ahead by a little and b is running into it faster: b hits a.
        if (gap > 0 && gap < SAME_LANE_CONTACT && b.speed > a.speed + 0.02) {
          a._derail(true);
          this.sparks.emit(a.position, 16, 1);
          this.audio.impact(0.5);
          this.shakeT = Math.max(this.shakeT, 0.3);
        }
      }
    }
  }

  // ---- 2. Spider: webs across the lanes, and the occasional pounce
  _spider(dt, cars) {
    this.webTimer -= dt;
    if (this.webTimer <= 0 && !this.puppet) {
      this.webTimer = 7;
      const lane = Math.random() < 0.5 ? -1 : (Math.random() < 0.5 ? 0 : 1); // both lanes, or one
      const u = (this.spiderU + 0.03 + Math.random() * 0.01) % 1;
      this._dropWeb(u, lane, 0);
      this._emit(EV.web, u, lane);
    }
    for (const w of this.webs) {
      w.life -= dt;
      w.mesh.material.opacity = Math.min(0.85, w.life / 1.5) * 0.85;
      for (const c of this.puppet ? [] : cars) {
        if (!c.mesh.visible || c.state !== 'running' || c.webbed) continue;
        if (circ(c.u, w.u) < 0.02 && (w.lane < 0 || c.lane === w.lane)) {
          c.webbed = true;
          c.webBreak = 0;
          this.sparks.emit(c.position, 4, 0.3);
          this.audio.webSnare();
        }
      }
    }
    this.webs = this.webs.filter((w) => {
      if (w.life > 0) return true;
      this.root.remove(w.mesh);
      return false;
    });

    this.pounceTimer -= dt;
    if (this.pounceTimer <= 0 && !this.pounce && !this.puppet) {
      const target = cars.filter((c) => c.mesh.visible && c.state === 'running' && c.blinkT <= 0);
      if (target.length) {
        const car = target[Math.floor(Math.random() * target.length)];
        this.pounce = { car, t: 0 };
        this._emit(EV.pounce, cars.indexOf(car));
        this.pounceTimer = 19;
      } else this.pounceTimer = 2;
    }
    if (this.pounce) {
      const P = this.pounce;
      P.t += dt;
      const k = Math.min(1, P.t / 0.5);
      const land = P.car.position;
      this.spider.group.position.set(land.x, this.tableY + 0.2 - 0.18 * k, land.z);
      this.threads.visible = true;
      this._stretch(this.threads, this.spider.group.position, land);
      if (P.t >= 0.5) {
        if (!this.puppet && P.car.state === 'running' && P.car.blinkT <= 0 && P.car.position.distanceTo(land) < 0.04) P.car._derail(true); // knocked off the slot
        this.sparks.emit(land, 18, 1.2);
        this.pounce = null;
        this.threads.visible = false;
        this.spider.group.position.y = this.tableY + 0.2;
      }
    }
  }

  /** A skeleton built from primitives: a skull with glowing eyes, ribs, pelvis, legs, and an arm on a shoulder pivot. */
  _buildSkeleton(i) {
    const g = new THREE.Group();
    g.scale.setScalar(2.2); // big enough to see from the cameras
    const bone = new THREE.MeshStandardMaterial({ color: 0xd9d3bd, roughness: 0.7, metalness: 0 });
    const add = (geo, x, y, z, m = bone) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    add(new THREE.SphereGeometry(0.0075, 12, 10), 0, 0.0585, 0); // skull
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 2 });
    add(new THREE.SphereGeometry(0.0016, 6, 5), -0.0028, 0.0595, -0.0068, eyeMat);
    add(new THREE.SphereGeometry(0.0016, 6, 5), 0.0028, 0.0595, -0.0068, eyeMat);
    add(new THREE.BoxGeometry(0.004, 0.0018, 0.002), 0, 0.0535, -0.0064); // jaw
    add(new THREE.BoxGeometry(0.0022, 0.0105, 0.0022), 0, 0.0455, 0); // neck
    for (const y of [0.0405, 0.0355, 0.0305]) add(new THREE.BoxGeometry(0.0125, 0.0012, 0.0055), 0, y, 0); // ribs
    add(new THREE.BoxGeometry(0.0022, 0.0205, 0.0022), 0, 0.0355, 0); // spine
    add(new THREE.BoxGeometry(0.0115, 0.0048, 0.0055), 0, 0.0225, 0); // pelvis
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.0024, 0.0205, 0.0024), sx * 0.0037, 0.0095, 0); // legs
    // The arm: its pivot is the shoulder. Hanging down at rest, it swings forward (toward -Z, the track) to reach.
    const pivot = new THREE.Group();
    pivot.position.set(-0.0062, 0.0445, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.0021, 0.0021, 0.08).translate(0, 0, -0.04), bone);
    pivot.add(arm);
    pivot.rotation.x = -Math.PI / 2;
    g.add(pivot);
    const side = i % 2 === 0 ? 1 : -1; // two on each verge
    return { group: g, arm: pivot, side, state: 'idle', t: 0, cool: 3, u: 0, lane: side > 0 ? 1 : 0, done: false };
  }

  /** The two skeletons, placed on the verge beside the straight. */
  _placeSkeletons(track) {
    if (!this.skeletons) {
      this.skeletons = [0, 1, 2, 3].map((i) => this._buildSkeleton(i));
      for (const k of this.skeletons) this.root.add(k.group);
    }
    this.skeletons.forEach((k, i) => {
      let u = (this.kaijuU + 0.25 + i * 0.25) % 1;
      for (let tries = 0; tries < 12 && (circ(u, this.gargoyleU) < 0.08 || circ(u, this.spiderU) < 0.08 || circ(u, this.clawU) < 0.08 || circ(u, this.beamU) < 0.08); tries++) u = (u + 0.04) % 1;
      k.u = u;
      track.frameAt(u, k.side * SKEL_LATERAL, k.group.position, k.group.quaternion);
      // Turn the skeleton so its arm points at the track (local -Z becomes the direction toward the lanes).
      k.group.quaternion.multiply(_spinQ.setFromAxisAngle(UP, k.side > 0 ? Math.PI / 2 : -Math.PI / 2));
    });
  }

  _startSkel(i, ff = 0) {
    const k = this.skeletons[i];
    if (!k || k.state === 'reach') return;
    k.state = 'reach';
    k.t = ff;
    k.done = false;
    this.audio.stomp();
  }

  /** The skeletons shake all the time; one reaches out for a car on its lane (host decides the knock-off). */
  _skeletons(dt, cars) {
    if (!this.skeletons) return;
    this.skelClock = (this.skelClock || 0) + dt;
    this.skeletons.forEach((k, i) => {
      const shake = Math.sin(this.skelClock * 31 + i * 2.1);
      k.group.children[0].rotation.z = shake * 0.06; // the skull trembles (the body stays on its verge)
      if (k.state === 'idle') {
        k.arm.rotation.x = -Math.PI / 2 + 0.12 * Math.sin(this.skelClock * 9 + i);
        k.cool -= dt;
        if (!this.puppet && k.cool <= 0) {
          const car = cars.find((c) => c.state === 'running' && c.mesh.visible && c.blinkT <= 0 && c.lane === k.lane && circ(c.u, k.u) < 0.07);
          if (car) {
            this._startSkel(i, 0);
            this._emit(EV.skel, i, k.lane);
          }
        }
        return;
      }
      // Reaching: the arm swings out across the lane, holds, and draws back.
      k.t += dt;
      const ext = Math.min(1, k.t / 0.4);
      const back = Math.min(1, Math.max(0, (k.t - 0.9) / 0.4));
      const reach = ext * (1 - back);
      k.arm.rotation.x = -Math.PI / 2 + (Math.PI / 2) * reach + 0.06 * Math.sin(this.skelClock * 40) * reach;
      if (!this.puppet && !k.done && k.t > 0.3 && k.t < 1.0) {
        for (const c of cars) {
          if (c.state !== 'running' || !c.mesh.visible || c.blinkT > 0 || c.lane !== k.lane) continue;
          if (circ(c.u, k.u) < 0.012) {
            k.done = true;
            c._derail(true); // yanked off the slot
            this.sparks.emit(c.position, 14, 1.1);
            break;
          }
        }
      }
      if (k.t >= SKEL_REACH) {
        k.state = 'idle';
        k.cool = SKEL_COOLDOWN[0] + Math.random() * (SKEL_COOLDOWN[1] - SKEL_COOLDOWN[0]);
        k.arm.rotation.x = -Math.PI / 2;
      }
    });
  }

  /** The pumpkin model, built once (a ball with a stalk) and shared by every pumpkin. */
  _pumpkinAssets() {
    if (this.pumpkinGeo) return;
    // Bigger than the first version (about a third of a car's length across) and lit from within, so it reads as orange.
    const body = new THREE.SphereGeometry(0.016, 14, 10).scale(1, 0.85, 1).translate(0, 0.0136, 0);
    const stem = new THREE.CylinderGeometry(0.0025, 0.003, 0.0065, 6).translate(0, 0.031, 0);
    this.pumpkinGeo = mergeGeometries([body, stem]);
    this.pumpkinMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff5a00, emissiveIntensity: 0.55, roughness: 0.55 });
    // The carved face: two eyes and a jagged mouth, on the side that faces the traffic coming from behind (local -Z,
    // the way the cars come from). It glows like a candle inside.
    const eye = (x) => new THREE.BoxGeometry(0.0034, 0.0042, 0.0012).rotateZ(Math.PI / 4).translate(x, 0.0158, -0.0149);
    const tooth = (x, y, r) => new THREE.BoxGeometry(0.0024, 0.0024, 0.0012).rotateZ(r).translate(x, y, -0.0149);
    const teeth = [tooth(-0.0055, 0.0088, 0.4), tooth(-0.0022, 0.0075, -0.3), tooth(0.0011, 0.0088, 0.4), tooth(0.0044, 0.0075, -0.3)];
    this.pumpkinFaceGeo = mergeGeometries([eye(-0.0056), eye(0.0056), ...teeth]);
    this.pumpkinFaceMat = new THREE.MeshStandardMaterial({ color: 0x1a0800, emissive: 0xffb020, emissiveIntensity: 1.6, roughness: 0.4 });
    // A soft orange halo, so a pumpkin shows from any camera.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,140,40,1)');
    grd.addColorStop(0.4, 'rgba(255,110,20,0.5)');
    grd.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    this.pumpkinHalo = new THREE.CanvasTexture(c);
    this.pumpkinHalo.colorSpace = THREE.SRGBColorSpace;
  }

  /** Pumpkins: spawn, hop, sit and hop away. Host-only decisions (the spawn and the knock-offs). */
  _pumpkins(dt, cars) {
    this._pumpkinAssets();
    if (!this.puppet) {
      this.pumpkinTimer -= dt;
      if (this.pumpkinTimer <= 0) {
        this.pumpkinTimer = PUMPKIN_EVERY[0] + Math.random() * (PUMPKIN_EVERY[1] - PUMPKIN_EVERY[0]);
        const u = Math.random();
        const lane = Math.random() < 0.5 ? 0 : 1;
        if (circ(u, this.kaijuU) > 0.05 && circ(u, this.spiderU) > 0.05 && circ(u, this.gargoyleU) > 0.05) {
          this._hopPumpkin(u, lane, 0);
          this._emit(EV.pumpkin, u, lane);
        }
      }
    }
    const total = PUMPKIN_HOP * 2 + PUMPKIN_REST;
    this.pumpkins = this.pumpkins.filter((p) => {
      p.t += dt;
      if (p.t >= total) {
        this.root.remove(p.mesh);
        return false;
      }
      const inHop = p.t < PUMPKIN_HOP;
      const outHop = p.t >= PUMPKIN_HOP + PUMPKIN_REST;
      const onLane = !inHop && !outHop;
      const kIn = Math.min(1, p.t / PUMPKIN_HOP);
      const kOut = Math.min(1, Math.max(0, (p.t - PUMPKIN_HOP - PUMPKIN_REST) / PUMPKIN_HOP));
      const smooth = (x) => x * x * (3 - 2 * x);
      const along = inHop ? smooth(kIn) : outHop ? 1 - smooth(kOut) : 1; // 0 at the verge, 1 on the lane
      const lateral = p.from + (LANE_OFFSETS[p.lane] - p.from) * along;
      this.track.frameAt(p.u, lateral, p.mesh.position, p.mesh.quaternion);
      const arc = inHop ? Math.sin(Math.PI * kIn) : outHop ? Math.sin(Math.PI * kOut) : 0;
      p.mesh.position.y += 0.045 * arc;
      if (onLane && !p.hit && !this.puppet) {
        for (const c of cars) {
          if (c.state !== 'running' || !c.mesh.visible || c.blinkT > 0 || c.lane !== p.lane) continue;
          if (circ(c.u, p.u) < 0.012) {
            p.hit = true;
            c._derail(true); // knocked off the slot
            this.sparks.emit(c.position, 14, 1.1);
            break;
          }
        }
      }
      return true;
    });
  }

  /** A pumpkin hops in from the verge onto a lane at `u`. `ff`: seconds already elapsed (guests catch up). */
  _hopPumpkin(u, lane, ff = 0) {
    this._pumpkinAssets();
    const mesh = new THREE.Mesh(this.pumpkinGeo, this.pumpkinMat);
    mesh.name = 'pumpkin';
    mesh.add(new THREE.Mesh(this.pumpkinFaceGeo, this.pumpkinFaceMat));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.pumpkinHalo, color: 0xff7a1a, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.scale.set(0.07, 0.07, 1);
    halo.position.y = 0.02;
    mesh.add(halo);
    this.root.add(mesh);
    const from = (LANE_OFFSETS[lane] < 0 ? -1 : 1) * 0.085; // from beyond the track edge
    this.pumpkins.push({ u, lane, from, mesh, t: ff, hit: false });
    this.audio.whoosh();
  }

  _dropWeb(u, lane, ff = 0) {
    const P = this.track.curve.getPointAt(u);
    const T = this.track.tangentAt(u, _t.clone());
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 0.05).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.webTex, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    mesh.position.copy(P).setY(this.tableY + 0.006);
    mesh.rotation.y = Math.atan2(-T.x, -T.z);
    this.root.add(mesh);
    this.webs.push({ u, lane, mesh, life: WEB_LIFE - ff });
    this.audio.webSnare();
  }

  _stretch(mesh, a, b) {
    _s.subVectors(b, a);
    const len = _s.length();
    mesh.scale.set(1, len, 1);
    mesh.position.copy(a).addScaledVector(_s, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, _s.normalize());
  }

  // ---- 3. Phantom: lifts the car off the slot inside its beam and cuts its grip
  _phantom(dt, cars) {
    this.phantomT += dt;
    const P = this.phantom.group;
    const th = (this.phantomT * 2 * Math.PI) / 4.5;
    P.position.x = this.beamCentre.x + 0.2 * Math.sin(th);
    P.position.z = this.beamCentre.z + 0.14 * Math.sin(th) * Math.cos(th);
    P.position.y = this.tableY + 0.5;
    this.beamOn = true;
    let warble = 0;
    for (const c of cars) {
      if (!c.mesh.visible || c.state !== 'running') continue;
      const dy = P.position.y - c.position.y;
      const r = 0.02 + (0.12 - 0.02) * Math.max(0, Math.min(1, dy / 0.5));
      const dist = Math.hypot(c.position.x - P.position.x, c.position.z - P.position.z);
      if (dy > 0 && dist < r) {
        const strength = 1 - dist / r;
        if (!this._shielded(c)) {
          c.lift = Math.max(c.lift, 0.014 * strength);
          c.hazardGrip = Math.min(c.hazardGrip, 0.5);
        }
        if (c.isPlayerCar) warble = 1;
      }
    }
    this.phantom.beam.material.opacity = 0.16 + 0.08 * Math.sin(this.phantomT * 7);
    this.phantom.wisps.forEach((w, i) => {
      const a = this.phantomT * 2.2 + (i * Math.PI * 2) / 6;
      w.position.set(Math.cos(a) * 0.075, 0.03 + 0.03 * Math.sin(a * 2), Math.sin(a) * 0.075);
      w.material.opacity = 0.5 + 0.4 * Math.sin(this.phantomT * 9 + i);
    });
    this.phantom.body.rotation.z = 0.08 * Math.sin(this.phantomT * 3);
    this.warbleLevel = (this.warbleLevel || 0) + (warble - (this.warbleLevel || 0)) * Math.min(1, dt * 6);
    this.audio.warble(this.warbleLevel);
  }

  // ---- 4. Gargoyle: turns to the nearest car and hurls orbs at a landing spot
  _gargoyle(dt, cars) {
    const G = this.gargoyle;
    let near = null;
    let nd = Infinity;
    for (const c of cars) {
      if (!c.mesh.visible || c.state !== 'running') continue;
      const d = c.position.distanceTo(G.group.position);
      if (d < nd) {
        nd = d;
        near = c;
      }
    }
    if (near) {
      const yaw = Math.atan2(near.position.x - G.group.position.x, near.position.z - G.group.position.z) - G.group.rotation.y;
      G.head.rotation.y += (Math.max(-1.2, Math.min(1.2, Math.atan2(Math.sin(yaw), Math.cos(yaw)))) - G.head.rotation.y) * Math.min(1, dt * 5);
    }
    this.orbTimer -= dt;
    if (this.orbTimer <= 0 && !this.orbFlight && near && !this.puppet) {
      // Land the orb 6 cm ahead of the nearest car, on its own lane line.
      const u = (near.u + 0.05) % 1;
      this._launchOrb(u, 0);
      this._emit(EV.orb, u);
      this.orbTimer = 5.5;
    }
    if (this.orbFlight) {
      const F = this.orbFlight;
      F.t += dt;
      const k = Math.min(1, F.t / 0.9);
      this.orb.position.lerpVectors(F.from, F.to, k).setY(this.tableY + 0.2 * (1 - k) + 0.12 * Math.sin(Math.PI * k) + 0.01);
      this.landRing.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(F.t * 10));
      if (F.t >= 0.9) {
        this.orb.visible = false;
        this.audio.orbBoom();
        this.sparks.emit(F.to, 24, 1.1);
        for (const c of this.puppet ? [] : cars) {
          if (!c.mesh.visible || c.state !== 'running' || c.blinkT > 0) continue;
          const d = c.position.distanceTo(F.to);
          if (d < 0.035) {
            c.angVel.set(18, 6, 14); // a direct hit spins the car
            c._derail(true);
          } else if (d < 0.09) {
            c.boost(1.5); // a near miss: spectral boost
            this.sparks.emit(c.position, 16, 0.8);
          }
        }
        this.orbFlight = null;
        this.landingU = -1;
        this.landRing.material.opacity = 0;
      }
    }
  }

  // ---- 5. Claws: alternate lanes; rumble, then close over the lane
  _claws(dt, cars) {
    if (this.clawState === 'idle') {
      this.clawNext -= dt;
      if (this.clawNext <= 0 && !this.puppet) {
        this._startClaw(this.clawLane, 0);
        this._emit(EV.claw, this.clawLane);
      }
    } else {
      this.clawT[0] += dt;
    }
    const lane = this.clawLane;
    const claw = this.claws[lane];
    const T = this.clawT[0];
    let lean = 0;
    let rise = 0;
    switch (this.clawState) {
      case 'telegraph':
        rise = Math.min(1, T / CLAW_CYCLE.telegraph);
        claw.glow.emissiveIntensity = 0.2 + 2 * rise;
        claw.group.position.y = this.tableY - 0.04 + 0.04 * rise + 0.002 * Math.sin(T * 50);
        if (T >= CLAW_CYCLE.telegraph) {
          this.clawState = 'closing';
          this.clawT[0] = 0;
          this.audio.clawRumble(false);
          this.audio.clawSnap();
        }
        break;
      case 'closing':
        lean = Math.min(1, T / CLAW_CYCLE.closing);
        if (T >= CLAW_CYCLE.closing) {
          this.clawState = 'closed';
          this.clawT[0] = 0;
          // The claw has closed over the lane: whatever is inside it is de-slotted.
          for (const c of this.puppet ? [] : cars) {
            if (c.lane !== lane || c.state !== 'running' || !c.mesh.visible || c.blinkT > 0) continue;
            if (circ(c.u, this.clawU) < 0.02) c._derail(true);
          }
        }
        break;
      case 'closed':
        lean = 1;
        if (T >= CLAW_CYCLE.closed) {
          this.clawState = 'release';
          this.clawT[0] = 0;
        }
        break;
      case 'release':
        lean = Math.max(0, 1 - T / CLAW_CYCLE.release);
        if (T >= CLAW_CYCLE.release) {
          this.clawState = 'idle';
          this.clawLane = 1 - lane; // the other lane next time
          this.clawNext = CLAW_CYCLE.idle;
          claw.group.position.y = this.tableY - 0.04;
        }
        break;
      default:
        break;
    }
    if (this.clawState !== 'telegraph' && this.clawState !== 'idle') claw.group.position.y = this.tableY - 0.04 + 0.04;
    for (const f of claw.fingers) {
      f.pivot.rotation.z = (f.x < 0 ? 1 : -1) * 0.9 * lean;
    }
    claw.glow.emissiveIntensity = lean > 0 ? 1.4 : claw.glow.emissiveIntensity;
  }

  _openPortal(i, ff) {
    const p = this.portals[i];
    p.state = 'opening';
    p.t = ff;
    this.audio.whoosh();
  }

  /** The first portal, for tests and tools. */
  get portalU() {
    return this.portals[0].u;
  }

  get portalState() {
    return this.portals[0].state;
  }

  // ---- 7. Portals: each opens as a car comes up to it; a car that drives through an open one changes lane
  _portal(dt, cars) {
    const L = this.track.length;
    this.portals.forEach((p, idx) => {
      if (!p.used) return;
      if (p.state === 'closed') {
        p.next -= dt;
        if (p.next <= 0 && !this.puppet) {
          // Open as a car comes up to the arch (about a second away), seven times out of ten: a car usually meets it.
          const coming = cars.some((c) => {
            if (c.state !== 'running' || c.speed < 0.05) return false;
            let d = p.u - c.u;
            if (d < 0) d += 1;
            const tt = (d * L) / c.speed;
            return tt > 0.45 && tt < 1.1;
          });
          if (coming) {
            if (Math.random() < 0.7) {
              this._openPortal(idx, 0);
              this._emit(EV.portal, idx);
              p.next = 3 + Math.random() * 3; // then rest a while
            } else p.next = 2; // this car got lucky
          }
        }
      } else {
        p.t += dt;
        if (p.state === 'opening' && p.t >= PORTAL_CYCLE.opening) {
          p.state = 'open';
          p.t = 0;
        } else if (p.state === 'open' && p.t >= PORTAL_CYCLE.open) {
          p.state = 'closing';
          p.t = 0;
        } else if (p.state === 'closing' && p.t >= PORTAL_CYCLE.closing) {
          p.state = 'closed';
          p.t = 0;
          if (this.puppet) p.next = Infinity;
        }
      }
      // How open it looks (0..1).
      const S = p.state;
      const k = S === 'open' ? 1 : S === 'opening' ? Math.min(1, p.t / PORTAL_CYCLE.opening) : S === 'closing' ? 1 - Math.min(1, p.t / PORTAL_CYCLE.closing) : 0;
      const flick = 0.85 + 0.15 * Math.sin(this.t * 23 + idx);
      p.veil.material.opacity = 0.75 * k * flick;
      p.ringMat.emissiveIntensity = 0.5 + 2.5 * k;
      // The crossover's rails turn electric violet while the portal is open: this is where the car will be thrown across.
      p.xRailMat.emissive.setRGB(0.84 + (0.71 - 0.84) * k, 0.85 + (0.42 - 0.85) * k, 0.87 + (1 - 0.87) * k);
      p.xRailMat.emissiveIntensity = 0.22 + 1.6 * k * flick;
      p.veil.scale.set(1, 0.92 + 0.08 * Math.sin(this.t * 7 + idx), 1);
      // Cars that pass the arch while it is open slide to the other lane (the host decides; a guest sees it in the snapshots).
      for (const c of cars) {
        const prev = p.prevU.get(c);
        p.prevU.set(c, c.u);
        if (this.puppet || prev === undefined || S !== 'open' || c.state !== 'running' || !c.mesh.visible) continue;
        let before = p.u - prev;
        if (before > 0.5) before -= 1;
        if (before < -0.5) before += 1;
        let after = p.u - c.u;
        if (after > 0.5) after -= 1;
        if (after < -0.5) after += 1;
        if (before > 0 && after <= 0 && before < 0.05 && c.startSwap(0.45, XOVER_LEN)) {
          this.portalSwaps++;
          this.sparks.emit(c.position, 14, 0.9);
          this.audio.whoosh();
        }
      }
    });
  }

  // ------------------------------------------------------------ starters (host decision or guest replay)

  _startCharge(ff) {
    this.phase = 'charge';
    this.phaseT = ff;
    this.audio.kaijuCharge(true);
  }

  _launchOrb(u, ff) {
    const P = this.track.curve.getPointAt(u);
    this.landingU = u;
    this.landingPos = P.clone().setY(this.tableY + 0.01);
    this.landRing.position.copy(this.landingPos).setY(this.tableY + 0.005);
    this.landRing.material.opacity = 0.7;
    this.orbFlight = { t: ff, from: this.gargoyle.group.position.clone().setY(this.tableY + 0.2), to: this.landingPos.clone() };
    this.orb.visible = true;
    this.audio.orbLaunch();
  }

  _startClaw(lane, ff) {
    this.clawLane = lane;
    this.clawState = 'telegraph';
    this.clawT[0] = ff;
    this.audio.clawRumble(true);
  }

  _startBats(car, ff) {
    this.batTarget = car;
    this.batState = 'hunt';
    this.batT = ff;
  }

  // ---- 6. Bats: rest on the roost, hunt a car, engulf it (it crawls), scatter back
  _bats(dt, cars) {
    if (this.batState === 'rest') {
      this.batNext -= dt;
      if (this.batNext <= 0 && !this.puppet) {
        // The leader is the favourite target, so the swarm also keeps a race close.
        const running = cars.filter((c) => c.mesh.visible && c.state === 'running' && c.blinkT <= 0 && !c.ghost);
        if (running.length) {
          running.sort((a, b) => b.speed - a.speed);
          const car = Math.random() < 0.7 ? running[0] : running[Math.floor(Math.random() * running.length)];
          this._startBats(car, 0);
          this._emit(EV.bats, cars.indexOf(car));
          this.batNext = BAT_CYCLE.rest + Math.random() * 4;
        } else this.batNext = 2;
      }
      this._restBats(dt);
      return;
    }
    this.batT += dt;
    const car = this.batTarget;
    const home = _p.copy(this.roost).setY(this.tableY + 0.22);
    let k = 0; // 0 = at the roost, 1 = on the car
    if (this.batState === 'hunt') {
      k = Math.min(1, this.batT / BAT_CYCLE.hunt);
      k = k * k * (3 - 2 * k);
      if (this.batT >= BAT_CYCLE.hunt) {
        this.batState = 'engulf';
        this.batT = 0;
        // The host slows the swarmed car. A guest slows only its own car (at once, it is the same event); the
        // host's car on the guest screen is drawn from the network.
        if (car && (!this.puppet || !car.kinematic) && !this._shielded(car)) car.batT = BAT_SLOW;
        if (car) this.sparks.emit(car.position, 6, 0.3);
      }
    } else if (this.batState === 'engulf') {
      k = 1;
      if (this.batT >= BAT_CYCLE.engulf) {
        this.batState = 'scatter';
        this.batT = 0;
      }
    } else if (this.batState === 'scatter') {
      k = 1 - Math.min(1, this.batT / BAT_CYCLE.scatter);
      if (this.batT >= BAT_CYCLE.scatter) {
        this.batState = 'rest';
        this.batT = 0;
        this.batTarget = null;
        if (this.puppet) this.batNext = Infinity;
      }
    }
    const target = car ? car.position : home;
    this.batPos.lerpVectors(home, target, k);
    const tight = this.batState === 'engulf' ? 0.55 : 1 + (1 - k) * 0.8;
    this._poseSwarm(this.batPos, tight, 0.02 * k, dt);
    const near = this.batState === 'engulf' ? 1 : k;
    const mine = car && car.isPlayerCar ? 1 : 0.5;
    this.batLevel += (near * mine - this.batLevel) * Math.min(1, dt * 5);
    this.audio.batSwarm(this.batLevel);
  }

  /** The swarm circling its roost between hunts (also used outside a race, so the tree is alive). */
  _restBats(dt) {
    if (!this.roost) return;
    this.batLevel += (0 - this.batLevel) * Math.min(1, dt * 5);
    this.audio.batSwarm(this.root.visible ? this.batLevel : 0);
    this._poseSwarm(_p.copy(this.roost).setY(this.tableY + 0.24), 1.3, 0, dt);
  }

  _poseSwarm(centre, spread, lift, dt) {
    this.batClock = (this.batClock || 0) + dt;
    const T = this.batClock;
    const m = _m4;
    const B = this.bats;
    for (let i = 0; i < BAT_COUNT; i++) {
      const s = B.seeds[i];
      const a = s.a + T * s.w;
      const r = s.r * spread;
      _bp.set(centre.x + Math.cos(a) * r, centre.y + lift + s.y * spread * 0.6 + 0.01 * Math.sin(T * 3 + i), centre.z + Math.sin(a) * r);
      _bq.setFromAxisAngle(UP, -a); // nose along the circling direction
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(T * s.f));
      _bs.set(flap, 1, 1);
      m.compose(_bp, _bq, _bs);
      B.swarm.setMatrixAt(i, m);
    }
    B.swarm.instanceMatrix.needsUpdate = true;
  }
}
