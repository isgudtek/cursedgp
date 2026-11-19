import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { CIRCUIT_LIST, FALLBACK } from './circuit-data.js';

/**
 * Closed slot-car circuit (default figure-8 with an overpass, or a real F1 layout) built on a
 * CatmullRomCurve3.
 *
 * All cars are constrained to the curve through a single scalar `u` (arc-length
 * parameterised, 0..1). A look-up table (LUT) of horizontal curvature is precomputed
 * so that the derailment check is O(1) per frame.
 */

export const LANE_OFFSETS = [-0.0285, 0.0285]; // metres from the track centre line (5 % in from 0.03: the cars race closer)
export const SURFACE = 0.008; // height of the plastic deck above the curve
export const SLOT_HALF = 0.0026; // half slot width (35 % thinner than the first 0.004)
export const RAIL_W = 0.0023; // rail strip width on each side of a slot (35 % thinner than the first 0.0035)
export const HALF_W = 0.072; // half the deck width (m): 20 % wider than the first 0.06, same length
const LUT = 1200;
const UP = new THREE.Vector3(0, 1, 0);

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

const wrap01 = (u) => ((u % 1) + 1) % 1;

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d');
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 4, y * 4, 4, 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/**
 * Asphalt for the deck top: neutral mid grey with fine grain and a slightly lighter band down the middle, like a
 * well-used racing line. Mapped across the deck width (u) and along the track (v, repeating).
 */
function asphaltTexture() {
  const W = 128;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const band = g.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, '#2f3134');
  band.addColorStop(0.5, '#45474b');
  band.addColorStop(1, '#2f3134');
  g.fillStyle = band;
  g.fillRect(0, 0, W, H);
  // Fine grain: small light and dark specks, seeded so every load draws the same surface.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.12 + rnd() * 0.12})` : `rgba(255,255,255,${0.04 + rnd() * 0.05})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Kerb stripes: one red and one white block per repeat, hard edges. */
function kerbTexture() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 2;
  const g = c.getContext('2d');
  g.fillStyle = '#c8261d';
  g.fillRect(0, 0, 2, 1);
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 1, 2, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/**
 * Sponsor boards: invented brands (no real trademarks), each a small canvas logo. Drawn once per track build.
 * [name, background, text colour, accent colour, tagline]
 */
const SPONSORS = [
  ['GHOUL OIL', '#141414', '#ffb000', '#ff5a00', 'MOTOR OIL'],
  ['CRYPT COLA', '#b3121b', '#ffffff', '#ffd6d9', 'ICE COLD'],
  ['HEX FUEL', '#0e3d2b', '#7dffb2', '#1fbf6b', 'RACING FUEL'],
  ['PHANTOM', '#f2f2f2', '#16161a', '#7c3aed', 'TYRES'],
  ['BANSHEE', '#1b1840', '#c4b5fd', '#8b5cf6', 'BRAKES'],
  ['MIDNIGHT', '#0b1830', '#e2ecff', '#3b82f6', 'MOTORS'],
  ['GRAVE', '#2b2b2b', '#f5f5f5', '#a3a3a3', 'SPARK PLUGS'],
  ['PUMPKIN', '#ff7a00', '#1a0f00', '#3a2100', 'ENERGY'],
];
function sponsorTexture([name, bg, fg, accent, tag]) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = accent;
  g.fillRect(0, 0, 256, 4);
  g.fillRect(0, 44, 256, 4);
  g.fillStyle = fg;
  g.textBaseline = 'middle';
  g.font = '900 26px "Arial Black", Impact, sans-serif';
  const w = g.measureText(name).width;
  g.font = '700 10px monospace';
  const tw = g.measureText(tag).width;
  const x0 = (256 - (w + 10 + tw)) / 2;
  g.font = '900 26px "Arial Black", Impact, sans-serif';
  g.fillText(name, x0, 25);
  g.fillStyle = accent;
  g.font = '700 10px monospace';
  g.fillText(tag, x0 + w + 10, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// Kiroween billboards (the hackathon's own artwork, in public/sponsors/). Loaded once, shared by every track.
const BILLBOARDS = {
  square: { file: 'sponsors/kiroween-square.png', w: 0.12, h: 0.12 },
  wide: { file: 'sponsors/kiroween-wide.png', w: 0.22, h: 0.11 },
};
const billboardTex = {};
function billboardTexture(kind) {
  if (!billboardTex[kind]) {
    const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}${BILLBOARDS[kind].file}`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.userData.shared = true; // never freed with a track
    billboardTex[kind] = t;
  }
  return billboardTex[kind];
}
const BILLBOARD_COUNT = 4; // square boards beside the track
const BILLBOARD_POST = 0.05; // m of post under the panel
const BILLBOARD_LEAN = 0.35; // rad the panel leans back, so it reads from above
const BANNER_COUNT = 6; // KIROWEEN arches across the track
const BANNER_GAP = 0.08; // share of a lap between two arches, at least
const BANNER_CLEAR = 0.05; // m from the deck to the banner's lower edge: the cars pass under
const BANNER_W = 2 * HALF_W + 0.03; // m: spans the deck
const BANNER_H = BANNER_W / 2; // m (the artwork is 2:1)

const BOARD_L = 0.2; // m long
const BOARD_H = 0.036; // m tall
const BOARD_GAP = 0.55; // m of track between boards, at least
const MAX_BOARDS = 26;

const ASPHALT_TILE = 0.5; // m of track per asphalt texture repeat
const KERB_BLOCK = 0.018; // m: length of one red or white kerb block
const KERB_W = 0.012; // m: kerb width on each deck edge
const KERB_K = 2.2; // 1/m: bends tighter than about a 45 cm radius can get kerbs...
const KERB_SHARE = 0.3; // ...but only the tightest 30 % of a lap at most: real circuits wiggle a lot at table scale
const KERB_PAD = 0.05; // m: kerbs start a little before a bend and run on a little after it

// ------------------------------------------------------------------ circuits
// Index 0 is the built-in figure-8. The rest come from circuit-data.js (40 real layouts).
export const CIRCUITS = [
  { key: 'figure8', label: 'FIG-8', name: 'Classic Figure-8', id: null },
  ...CIRCUIT_LIST.map((c) => ({ key: c.id, label: c.label, name: c.name, id: c.id })),
];

// Uniform scale: the longest side of every real circuit is FIT_LONG metres. One scale factor keeps
// the real width/depth ratio. (1.5x the 1.8 m in the original spec.)
const FIT_LONG = 3.375; // default size (100%) of the longest side, metres: 1.25x the previous 2.7
const KCAP = 24; // 1/m: bends tighter than ~6 cm radius (the deck half-width) are smoothed; looser bends keep the real shape
const SEP = 0.18; // minimum centre-line spacing between unrelated stretches of track (wider decks must not touch)
const CIRCUIT_N = 240;
const BRIDGE_H = 0.1;

/** Original Gerono-lemniscate figure-8 with a raised half (overpass at the crossing). */
export function figure8Points(tableY, scale = 1) {
  const a = 1.2375 * scale; // 100% = 1.25x the previous 0.99 (1.5x the original 0.66); car and slot width unchanged
  const b = 1.35 * scale; // 100% = 1.25x the previous 1.08 (1.5x the original 0.72)
  const K = 72;
  const pts = [];
  for (let i = 0; i < K; i++) {
    const t = (i / K) * Math.PI * 2;
    const w = (1 - Math.cos(t)) / 2; // 0 at t=0 (underpass), 1 at t=PI (overpass)
    pts.push(new THREE.Vector3(a * Math.sin(t), tableY + BRIDGE_H * w ** 4, b * Math.sin(t) * Math.cos(t)));
  }
  return pts;
}

function bounds(P) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of P) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function recenter(P) {
  const { cx, cy } = bounds(P);
  for (const p of P) p.set(p.x - cx, p.y - cy);
}

function resample(P, n) {
  const m = P.length;
  const cum = [0];
  for (let i = 1; i <= m; i++) cum.push(cum[i - 1] + P[i % m].distanceTo(P[i - 1]));
  const total = cum[m];
  const out = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const d = (total * i) / n;
    while (cum[j] < d) j++;
    const t = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    out.push(new THREE.Vector2().lerpVectors(P[j - 1], P[j % m], t));
  }
  return { pts: out, total };
}

function segCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Index pairs [i, j] (i < j) whose segments cross (the later one becomes the bridge). */
function findCrossings(P) {
  const n = P.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) out.push([i, j]);
    }
  }
  return out;
}

function mengerK(P, i) {
  const n = P.length;
  const a = P[(i - 1 + n) % n];
  const b = P[i];
  const c = P[(i + 1) % n];
  const ab = b.distanceTo(a);
  const bc = c.distanceTo(b);
  const ca = a.distanceTo(c);
  const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return (2 * cross) / Math.max(ab * bc * ca, 1e-9);
}

/**
 * Turn real [lon, lat] coordinates into a closed, table-sized, slot-car-drivable loop:
 * centre on (0,0), scale uniformly to the table, relax hairpins / near-parallel stretches
 * so the 12 cm wide deck never self-overlaps, add gentle sinusoidal relief and bridge crossings.
 */
export function circuitPoints(coords, tableY, scale = 1) {
  const c = coords.map((p) => [Number(p[0]), Number(p[1])]);
  const f = c[0];
  const l = c[c.length - 1];
  if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) c.pop();
  const lat0 = c.reduce((s, p) => s + p[1], 0) / c.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  // x = east, y(=table z) = south, so north points away from a user standing at +z.
  let P = c.map((p) => new THREE.Vector2(p[0] * kx, -p[1]));
  recenter(P);
  let bb = bounds(P);
  if (bb.h > bb.w) P = P.map((p) => new THREE.Vector2(p.y, -p.x)); // longest dimension along the table's x
  recenter(P);
  bb = bounds(P);
  const s0 = (FIT_LONG * scale) / Math.max(bb.w, bb.h);
  P = resample(P.map((p) => p.multiplyScalar(s0)), CIRCUIT_N).pts;

  // Relax: smooth tight bends, push apart stretches that run too close to each other.
  const n = CIRCUIT_N;
  const gap = Math.ceil(0.3 / (resample(P, n).total / n));
  const exempt = new Uint8Array(n);
  for (const [i, j] of findCrossings(P)) {
    for (let k = -8; k <= 8; k++) {
      exempt[(i + k + n) % n] = 1;
      exempt[(j + k + n) % n] = 1;
    }
  }
  for (let it = 0; it < 80; it++) {
    const push = P.map(() => new THREE.Vector2());
    for (let i = 0; i < n; i++) {
      if (exempt[i]) continue;
      for (let j = i + gap; j < n; j++) {
        if (exempt[j] || n - (j - i) < gap) continue;
        const d = P[i].distanceTo(P[j]);
        if (d < SEP && d > 1e-6) {
          const k = ((SEP - d) * 0.25) / d;
          push[i].addScaledVector(P[i].clone().sub(P[j]), k);
          push[j].addScaledVector(P[j].clone().sub(P[i]), k);
        }
      }
    }
    const kap = P.map((_, i) => mengerK(P, i));
    const next = P.map((p, i) => {
      let q = p.clone().add(push[i]);
      let worst = 0;
      for (let k = -2; k <= 2; k++) worst = Math.max(worst, kap[(i + k + n) % n]);
      if (worst > KCAP * 0.7) {
        const avg = P[(i - 1 + n) % n].clone().add(P[(i + 1) % n]).multiplyScalar(0.5);
        q = q.lerp(avg, 0.5);
      }
      return q;
    });
    P = next;
  }
  P = resample(P, n).pts;
  recenter(P);
  bb = bounds(P);
  const s1 = (FIT_LONG * scale) / Math.max(bb.w, bb.h);
  for (const p of P) p.multiplyScalar(s1);

  // Relief: sinusoidal waves (>= table height) + gaussian bridges where the track crosses itself.
  const spacing = resample(P, n).total / n;
  const sigma = 0.2 / spacing;
  const bridgeAt = findCrossings(P).map(([, j]) => j);
  return P.map((p, i) => {
    const s = i / n;
    let y = tableY + 0.012 * (1 + 0.6 * Math.sin(4 * Math.PI * s) + 0.4 * Math.sin(10 * Math.PI * s + 1));
    for (const j of bridgeAt) {
      const d = Math.min(Math.abs(i - j), n - Math.abs(i - j));
      y += BRIDGE_H * Math.exp(-((d / sigma) ** 2));
    }
    return new THREE.Vector3(p.x, y, p.y);
  });
}

/**
 * Spline control points for a circuit key, from the coordinates embedded in circuit-data.js. There is no
 * network fetch: both players of an online race must build exactly the same track, and offline play must work.
 * @returns {Promise<{ points: THREE.Vector3[], source: 'builtin' | 'embedded' }>}
 */
export async function loadCircuit(key, tableY, scale = 1) {
  const def = CIRCUITS.find((c) => c.key === key) || CIRCUITS[0];
  if (!def.id) return { points: figure8Points(tableY, scale), source: 'builtin' };
  return { points: circuitPoints(FALLBACK[def.id], tableY, scale), source: 'embedded' };
}

/**
 * @param {{ tableY: number, vmax: number, points?: THREE.Vector3[], quality?: 'low'|'medium'|'high' }} opts
 */
export function createTrack({ tableY, vmax, points, quality = 'medium' }) {
  const pts = points || figure8Points(tableY);
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  curve.arcLengthDivisions = 2400;
  const length = curve.getLength();

  // --- LUT: position, side vector, curvature, safe speed ---
  const lutPos = new Float32Array(LUT * 3);
  const lutSide = new Float32Array(LUT * 3);
  const heading = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const u = i / LUT;
    curve.getPointAt(u, _p);
    curve.getTangentAt(u, _t);
    _s.crossVectors(_t, UP).normalize();
    lutPos.set([_p.x, _p.y, _p.z], i * 3);
    lutSide.set([_s.x, _s.y, _s.z], i * 3);
    heading[i] = Math.atan2(_t.z, _t.x);
  }
  // --- Drawing samples (visual only; the physics above keeps the LUT). Low and Medium draw from the LUT; High draws
  // from a denser curve, so the bends are finer. Low keeps the earlier look: every second sample, flat facets.
  const HIGH_N = 2400;
  const sampleCurve = (n) => {
    const pos = new Float32Array(n * 3);
    const side = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      curve.getPointAt(i / n, _p);
      curve.getTangentAt(i / n, _t);
      _s.crossVectors(_t, UP).normalize();
      pos.set([_p.x, _p.y, _p.z], i * 3);
      side.set([_s.x, _s.y, _s.z], i * 3);
    }
    return { pos, side, n };
  };
  const drawSrc = quality === 'high' ? sampleCurve(HIGH_N) : { pos: lutPos, side: lutSide, n: LUT };
  const FINE = quality === 'low' ? 2 : 1; // deck, slots and rails: every drawn sample (Low: every second one)
  const ds = length / LUT;
  const rawK = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    let d = heading[(i + 1) % LUT] - heading[(i - 1 + LUT) % LUT];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    rawK[i] = Math.abs(d) / (2 * ds);
  }
  const kappa = new Float32Array(LUT);
  const W = 6;
  let kmax = 0;
  for (let i = 0; i < LUT; i++) {
    let sum = 0;
    for (let j = -W; j <= W; j++) sum += rawK[(i + j + LUT) % LUT];
    kappa[i] = sum / (2 * W + 1);
    kmax = Math.max(kmax, kappa[i]);
  }
  // Maximum lateral acceleration is tuned so the sharpest bend is safe at ~67% of top speed
  // (kmax is capped so a single noisy spike on a real circuit cannot make every other bend trivial).
  const aMax = 0.45 * vmax * vmax * Math.min(kmax, 12);
  const safe = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) safe[i] = Math.min(vmax * 4, Math.sqrt(aMax / Math.max(kappa[i], 1e-4)));

  const lerpLut = (arr, u) => {
    const f = wrap01(u) * LUT;
    const i = Math.floor(f) % LUT;
    const k = f - Math.floor(f);
    return arr[i] * (1 - k) + arr[(i + 1) % LUT] * k;
  };

  // --- Mesh ---
  const group = new THREE.Group();
  group.name = 'track';

  /**
   * Extrude a cross-section `profile` ([lateral, vertical] pairs) along the track.
   * `uv`: { u0, u1, vTile } maps lateral u0..u1 to texture 0..1 and v to metres / vTile along the track.
   * `mask`: per-sample booleans; only samples where it is true are built (kerbs on bends).
   */
  function sweep(profile, material, step = 2, uv = null, mask = null) {
    const { pos, side, n } = drawSrc;
    const S = n / step;
    const dsDraw = length / n;
    const P = profile.length;
    const arr = [];
    const uvs = [];
    const put = (s, j) => {
      const k = ((s % S) * step) * 3;
      const [lat, vert] = profile[j];
      arr.push(pos[k] + side[k] * lat, pos[k + 1] + vert, pos[k + 2] + side[k + 2] * lat);
      if (uv) uvs.push((lat - uv.u0) / (uv.u1 - uv.u0), (s * step * dsDraw) / uv.vTile);
    };
    // The kerb mask is per LUT sample; a finer drawing reads the nearest LUT sample.
    const on = (s) => !mask || mask[mask.length === S ? s % S : Math.floor(((s % S) * mask.length) / S)];
    for (let s = 0; s < S; s++) {
      if (!on(s)) continue;
      for (let j = 0; j < P - 1; j++) {
        put(s, j); put(s + 1, j); put(s, j + 1);
        put(s, j + 1); put(s + 1, j); put(s + 1, j + 1);
      }
    }
    if (!arr.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    // Shading follows the curve: normals are averaged along the track, but edges that meet at a sharp angle (slot walls,
    // rail and kerb edges, the deck's sides) stay crisp. Low keeps the flat facets it had before.
    let shaded = geo;
    if (quality === 'low') geo.computeVertexNormals();
    else {
      shaded = toCreasedNormals(geo, Math.PI / 3); // 60 deg: bends blend softly, 90 deg edges stay sharp
      geo.dispose();
    }
    const mesh = new THREE.Mesh(shaded, material);
    group.add(mesh);
    return mesh;
  }

  // Deck: asphalt on top, dark plastic on the sides, black slot grooves edged by bright rails (white-black-white,
  // readable from far away), and red-white kerbs on the bends only.
  const [c1, c2] = LANE_OFFSETS;
  const sw = SLOT_HALF;
  const RAIL = RAIL_W;
  // A faint glow of their own keeps the colours true under the blue night light (grey stays grey, white stays white).
  const asphaltTex = asphaltTexture();
  // Dark concrete: a neutral grey-black, so the haunted teal light does not turn the road green.
const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x3a3a3e, emissiveMap: asphaltTex, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7, side: THREE.DoubleSide });
  const groove = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, side: THREE.DoubleSide });
  // Matte light grey, not mirror metal: with nothing around to reflect, a metallic rail renders almost black.
  const rail = new THREE.MeshStandardMaterial({ color: 0xd7dade, emissive: 0xd7dade, emissiveIntensity: 0.22, roughness: 0.42, metalness: 0.15, side: THREE.DoubleSide });
  const deckUv = { u0: -HALF_W, u1: HALF_W, vTile: ASPHALT_TILE };
  // Deck and slot strips use every curve sample (step 1), so the bends are drawn as finely as the physics curve.
  for (const [a, b] of [[-HALF_W, c1 - sw], [c1 + sw, c2 - sw], [c2 + sw, HALF_W]]) sweep([[a, SURFACE], [b, SURFACE]], asphalt, FINE, deckUv);
  sweep([[-HALF_W, 0], [-HALF_W, SURFACE]], sideMat);
  sweep([[HALF_W, SURFACE], [HALF_W, 0]], sideMat);
  for (const c of LANE_OFFSETS) {
    sweep([[c - sw, SURFACE], [c - sw, 0.003], [c + sw, 0.003], [c + sw, SURFACE]], groove, FINE);
    sweep([[c - sw - RAIL, SURFACE + 0.0005], [c - sw, SURFACE + 0.0005]], rail, FINE);
    sweep([[c + sw, SURFACE + 0.0005], [c + sw + RAIL, SURFACE + 0.0005]], rail, FINE);
  }
  // Kerbs: where the bend is tight enough, padded a little before and after, on both edges.
  const KS = LUT / 2;
  const bend = new Array(KS).fill(false);
  const sortedK = Array.from({ length: KS }, (_, i) => kappa[i * 2]).sort((a, b) => a - b);
  const kerbK = Math.max(KERB_K, sortedK[Math.floor(KS * (1 - KERB_SHARE * 0.7))]); // 0.7: the padding adds the rest
  for (let i = 0; i < KS; i++) bend[i] = kappa[i * 2] > kerbK;
  const pad = Math.max(1, Math.round(KERB_PAD / (ds * 2)));
  const kerbMask = new Array(KS).fill(false);
  for (let i = 0; i < KS; i++) {
    if (!bend[i]) continue;
    for (let j = -pad; j <= pad; j++) kerbMask[(i + j + KS) % KS] = true;
  }
  // Drop kerb runs too short to read as a kerb (a few blocks), so straights stay plain.
  const minRun = Math.round((KERB_BLOCK * 8) / (ds * 2));
  for (let i = 0; i < KS; i++) {
    if (!kerbMask[i] || kerbMask[(i - 1 + KS) % KS]) continue;
    let n = 0;
    while (n < KS && kerbMask[(i + n) % KS]) n++;
    if (n < minRun && n < KS) for (let j = 0; j < n; j++) kerbMask[(i + j) % KS] = false;
  }
  const kerbTex = kerbTexture();
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, emissiveMap: kerbTex, emissive: 0xffffff, emissiveIntensity: 0.28, roughness: 0.6, side: THREE.DoubleSide });
  const kerbUv = { u0: 0, u1: 1, vTile: KERB_BLOCK * 2 };
  const kerbsLeft = sweep([[-HALF_W, SURFACE + 0.0006], [-HALF_W + KERB_W, SURFACE + 0.0006]], kerbMat, 2, kerbUv, kerbMask);
  const kerbsRight = sweep([[HALF_W - KERB_W, SURFACE + 0.0006], [HALF_W, SURFACE + 0.0006]], kerbMat, 2, kerbUv, kerbMask);
  const kerbShare = kerbMask.filter(Boolean).length / KS;

  // Sponsor boards along the outside of the straights: on the table, clear of kerbs, bridges and other stretches.
  const boardMats = SPONSORS.map((sp) => {
    const tex = sponsorTexture(sp);
    return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 });
  });
  const boardBack = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.8 });
  const boardGeo = new THREE.BoxGeometry(BOARD_L, BOARD_H, 0.004);
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < LUT; i++) {
    cx += lutPos[i * 3];
    cz += lutPos[i * 3 + 2];
  }
  cx /= LUT;
  cz /= LUT;
  const gapSamples = Math.round(BOARD_GAP / ds);
  const halfSpan = Math.ceil(BOARD_L / 2 / ds) + 2;
  const OFF = HALF_W + 0.014; // board centre from the track centre line
  let boards = 0;
  let last = -Infinity;
  for (let i = 0; i < LUT && boards < MAX_BOARDS; i += 4) {
    if (i - last < gapSamples) continue;
    // The board needs a straight stretch under its whole length, without kerbs, on the table (no bridges).
    let ok = true;
    for (let j = -halfSpan; j <= halfSpan && ok; j++) {
      const k = (i + j + LUT) % LUT;
      if (kappa[k] > 1.2 || kerbMask[Math.floor(k / 2) % KS] || lutPos[k * 3 + 1] - tableY > 0.03) ok = false;
    }
    if (!ok) continue;
    const k = i * 3;
    const sx = lutSide[k];
    const sz = lutSide[k + 2];
    // Outside of the circuit first; the other side if that one is too close to another stretch.
    const outward = (lutPos[k] - cx) * sx + (lutPos[k + 2] - cz) * sz >= 0 ? 1 : -1;
    let placed = false;
    for (const side of [outward, -outward]) {
      const px = lutPos[k] + sx * OFF * side;
      const pz = lutPos[k + 2] + sz * OFF * side;
      let clear = true;
      for (let m = 0; m < LUT && clear; m += 2) {
        const du = Math.min(Math.abs(m - i), LUT - Math.abs(m - i));
        if (du < halfSpan + 6) continue; // its own stretch
        if (Math.hypot(lutPos[m * 3] - px, lutPos[m * 3 + 2] - pz) < HALF_W + 0.06) clear = false;
      }
      if (!clear) continue;
      const logo = boardMats[boards % boardMats.length];
      const board = new THREE.Mesh(boardGeo, [boardBack, boardBack, boardBack, boardBack, logo, logo]); // the logo on both faces
      // Standing at the deck's base height (the deck rises and falls a little), along the track, logo facing it.
      const by = lutPos[k + 1] + BOARD_H / 2;
      board.position.set(px, by, pz);
      board.lookAt(px - sx * side, by, pz - sz * side);
      board.castShadow = true;
      board.name = 'sponsor';
      group.add(board);
      boards++;
      last = i;
      placed = true;
      break;
    }
    if (!placed) continue;
  }
  const sponsorCount = boards;

  // Kiroween billboards on posts beside the track, spread around the lap, square and wide in turn.
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.5, metalness: 0.3 });
  const postGeo = new THREE.CylinderGeometry(0.0025, 0.0025, 1, 6);
  const faceMats = {};
  for (const kind of Object.keys(BILLBOARDS)) {
    const tex = billboardTexture(kind);
    faceMats[kind] = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.55 });
  }
  let billboards = 0;
  for (let n = 0; n < BILLBOARD_COUNT; n++) {
    const kind = 'square';
    const B = BILLBOARDS[kind];
    const off = HALF_W + 0.05 + B.h * 0.3; // stand back from the edge (the panel leans back over its posts)
    const span = Math.ceil(B.w / 2 / ds) + 2;
    // Search around an evenly spread spot for a free place.
    const base = Math.round(((n + 0.35) / BILLBOARD_COUNT) * LUT);
    let done = false;
    for (let t = 0; t < 80 && !done; t++) {
      const i = (base + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 3 + LUT * 4) % LUT;
      if (lutPos[i * 3 + 1] - tableY > 0.03) continue; // not on a bridge
      if (kerbMask[Math.floor(i / 2) % KS]) continue; // not over a kerb (they sit at bends: keep the bend readable)
      const k = i * 3;
      const sx = lutSide[k];
      const sz = lutSide[k + 2];
      const outward = (lutPos[k] - cx) * sx + (lutPos[k + 2] - cz) * sz >= 0 ? 1 : -1;
      for (const side of [outward, -outward]) {
        const px = lutPos[k] + sx * off * side;
        const pz = lutPos[k + 2] + sz * off * side;
        let clear = true;
        for (let m = 0; m < LUT && clear; m += 2) {
          const du = Math.min(Math.abs(m - i), LUT - Math.abs(m - i));
          if (du < span + 8) continue;
          if (Math.hypot(lutPos[m * 3] - px, lutPos[m * 3 + 2] - pz) < HALF_W + B.w / 2 + 0.02) clear = false;
        }
        if (!clear) continue;
        const bb = new THREE.Group();
        bb.name = 'billboard';
        const y0 = lutPos[k + 1];
        bb.position.set(px, y0, pz);
        bb.lookAt(px - sx * side, y0, pz - sz * side); // face the track
        for (const x of [-B.w * 0.38, B.w * 0.38]) {
          const post = new THREE.Mesh(postGeo, postMat);
          post.scale.y = BILLBOARD_POST + B.h * 0.5;
          post.position.set(x, post.scale.y / 2, -0.004);
          bb.add(post);
        }
        const panel = new THREE.Group();
        panel.position.y = BILLBOARD_POST + B.h / 2;
        panel.rotation.x = -BILLBOARD_LEAN;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(B.w + 0.008, B.h + 0.008, 0.004), frameMat);
        frame.castShadow = true;
        panel.add(frame);
        // Artwork on both sides: the TV cameras often see a board from behind.
        for (const back of [0, Math.PI]) {
          const face = new THREE.Mesh(new THREE.PlaneGeometry(B.w, B.h), faceMats[kind]);
          face.position.z = back ? -0.0021 : 0.0021;
          face.rotation.y = back;
          panel.add(face);
        }
        bb.add(panel);
        group.add(bb);
        billboards++;
        done = true;
        break;
      }
    }
  }
  const billboardCount = billboards;

  // Wide Kiroween banners across the track, on two posts like the start gantry but lower. Straight stretches only,
  // away from the start line and bridges, and where nothing else runs close enough to hit a post.
  const bannerMat = new THREE.MeshStandardMaterial({ map: billboardTexture('wide'), emissiveMap: billboardTexture('wide'), emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.55 });
  const bannerGeo = new THREE.PlaneGeometry(BANNER_W, BANNER_H);
  const POST_OFF = BANNER_W / 2 + 0.008; // the arch's legs stand just outside the banner (and the deck)
  // The arch: up one leg, a rounded corner, across the top, a rounded corner, down the other leg.
  const ARCH_TOP = SURFACE + BANNER_CLEAR + BANNER_H + 0.006;
  const ARCH_R = 0.03;
  const archPath = new THREE.CurvePath();
  const V = (x, y) => new THREE.Vector3(x, y, 0);
  archPath.add(new THREE.LineCurve3(V(-POST_OFF, 0), V(-POST_OFF, ARCH_TOP - ARCH_R)));
  archPath.add(new THREE.QuadraticBezierCurve3(V(-POST_OFF, ARCH_TOP - ARCH_R), V(-POST_OFF, ARCH_TOP), V(-POST_OFF + ARCH_R, ARCH_TOP)));
  archPath.add(new THREE.LineCurve3(V(-POST_OFF + ARCH_R, ARCH_TOP), V(POST_OFF - ARCH_R, ARCH_TOP)));
  archPath.add(new THREE.QuadraticBezierCurve3(V(POST_OFF - ARCH_R, ARCH_TOP), V(POST_OFF, ARCH_TOP), V(POST_OFF, ARCH_TOP - ARCH_R)));
  archPath.add(new THREE.LineCurve3(V(POST_OFF, ARCH_TOP - ARCH_R), V(POST_OFF, 0)));
  const archGeo = new THREE.TubeGeometry(archPath, 64, 0.0055, 10, false);
  const archMat = new THREE.MeshStandardMaterial({ color: 0xb46bff, emissive: 0xb46bff, emissiveIntensity: 1.1, roughness: 0.35 });
  const bannerSpan = Math.ceil(0.06 / ds);
  let banners = 0;
  const overheads = []; // track positions (0..1) of structures over the track, so monsters keep clear of them
  for (let n = 0; n < BANNER_COUNT; n++) {
    const base = Math.round(((n + 0.62) / BANNER_COUNT) * LUT);
    let done = false;
    for (let t = 0; t < 120 && !done; t++) {
      const i = (base + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 3 + LUT * 4) % LUT;
      const fromStart = Math.min(i, LUT - i) / LUT;
      if (fromStart < 0.06) continue; // the start gantry is there
      const ui = i / LUT;
      if (overheads.some((o) => Math.min(Math.abs(o - ui), 1 - Math.abs(o - ui)) < BANNER_GAP)) continue; // keep arches apart
      let ok = true;
      for (let j = -bannerSpan; j <= bannerSpan && ok; j++) {
        const k = (i + j + LUT) % LUT;
        if (kappa[k] > 1.2 || lutPos[k * 3 + 1] - tableY > 0.03) ok = false;
      }
      if (!ok) continue;
      const k = i * 3;
      const sx = lutSide[k];
      const sz = lutSide[k + 2];
      // Both posts must stand clear of every other stretch of track.
      for (const side of [-1, 1]) {
        const px = lutPos[k] + sx * POST_OFF * side;
        const pz = lutPos[k + 2] + sz * POST_OFF * side;
        for (let m = 0; m < LUT && ok; m += 2) {
          const du = Math.min(Math.abs(m - i), LUT - Math.abs(m - i));
          if (du < bannerSpan + 10) continue;
          if (Math.hypot(lutPos[m * 3] - px, lutPos[m * 3 + 2] - pz) < HALF_W + 0.03) ok = false;
        }
      }
      if (!ok) continue;
      const y0 = lutPos[k + 1];
      const g = new THREE.Group();
      g.name = 'banner';
      g.position.set(lutPos[k], y0, lutPos[k + 2]);
      // Local x across the track, the banner faces along it (towards the oncoming cars).
      g.lookAt(lutPos[k] + Math.cos(heading[i]), y0, lutPos[k + 2] + Math.sin(heading[i]));
      // Violet arch, like the portals: a glowing gate over the track with the banner hung inside it.
      const arch = new THREE.Mesh(archGeo, archMat);
      arch.castShadow = true;
      g.add(arch);
      // Two panels back to back, so the artwork reads the right way round from both directions.
      for (const face of [0, Math.PI]) {
        const cloth = new THREE.Mesh(bannerGeo, bannerMat);
        cloth.position.set(0, SURFACE + BANNER_CLEAR + BANNER_H / 2, face ? -0.0008 : 0.0008);
        cloth.rotation.y = face;
        cloth.castShadow = !face;
        g.add(cloth);
      }
      group.add(g);
      overheads.push(i / LUT);
      banners++;
      done = true;
    }
  }
  const bannerCount = banners;

  // Pillars under raised stretches (skipped where another road runs underneath).
  const pillarGeo = new THREE.CylinderGeometry(0.009, 0.011, 1, 10);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.7 });
  for (let i = 0; i < LUT; i += 36) {
    const x = lutPos[i * 3];
    const y = lutPos[i * 3 + 1];
    const z = lutPos[i * 3 + 2];
    const hgt = y - tableY;
    if (hgt <= 0.03) continue;
    let blocked = false;
    for (let k = 0; k < LUT && !blocked; k++) {
      const du = Math.min(Math.abs(k - i), LUT - Math.abs(k - i));
      if (du > 60 && lutPos[k * 3 + 1] < y - 0.04 && Math.hypot(lutPos[k * 3] - x, lutPos[k * 3 + 2] - z) < 0.1) {
        blocked = true;
      }
    }
    if (blocked) continue;
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.scale.y = hgt;
    pillar.position.set(x, tableY + hgt / 2, z);
    group.add(pillar);
  }

  // --- Query API ---
  /** Snap `outPos`/`outQuat` to the slot of `lane` at `u` (uses getPointAt/getTangentAt). */
  function frame(u, lane, outPos, outQuat, outTan) {
    frameAt(u, LANE_OFFSETS[lane], outPos, outQuat, outTan);
  }

  /** Like frame(), at any sideways offset from the centre line (m): a car changing lanes passes between them. */
  function frameAt(u, offset, outPos, outQuat, outTan) {
    const uu = wrap01(u);
    curve.getPointAt(uu, _p);
    curve.getTangentAt(uu, _t);
    _s.crossVectors(_t, UP).normalize();
    _n.crossVectors(_s, _t); // car up
    _z.copy(_t).negate(); // car forward is -Z
    _m.makeBasis(_s, _n, _z);
    outQuat.setFromRotationMatrix(_m);
    outPos.copy(_p).addScaledVector(_s, offset).addScaledVector(UP, SURFACE);
    if (outTan) outTan.copy(_t);
  }

  function tangentAt(u, out) {
    return curve.getTangentAt(wrap01(u), out);
  }

  function nearestU(pos, lane) {
    const c = LANE_OFFSETS[lane];
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < LUT; i++) {
      const k = i * 3;
      const dx = lutPos[k] + lutSide[k] * c - pos.x;
      const dy = lutPos[k + 1] + SURFACE - pos.y;
      const dz = lutPos[k + 2] + lutSide[k + 2] * c - pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { u: best / LUT, dist: Math.sqrt(bestD) };
  }

  // Start / finish line.
  const startMesh = new THREE.Mesh(
    new THREE.BoxGeometry(HALF_W * 2 - 0.012, 0.0012, 0.03),
    new THREE.MeshBasicMaterial({ map: checkerTexture() }),
  );
  {
    const q = new THREE.Quaternion();
    frame(0, 0, _p, q); // orientation only
    curve.getPointAt(0, _p); // centred on the track axis
    startMesh.position.set(_p.x, _p.y + SURFACE + 0.0012, _p.z);
    startMesh.quaternion.copy(q);
    group.add(startMesh);
  }

  /** Free GPU resources and detach from the scene. */
  function dispose() {
    const geos = new Set();
    const mats = new Set();
    group.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
    });
    for (const g of geos) g.dispose();
    for (const m of mats) {
      // Images shared by every track (the billboards) stay loaded for the next track.
      for (const t of [m.map, m.emissiveMap]) if (t && !t.userData.shared) t.dispose();
      m.dispose();
    }
    group.removeFromParent();
  }

  return {
    group,
    dispose,
    kerbShare, // share of the lap with kerbs (bends)
    sponsorCount,
    billboardCount,
    bannerCount,
    overheads,
    kerbMeshes: [kerbsLeft, kerbsRight].filter(Boolean),
    curve,
    length,
    kmax,
    aMax,
    frame,
    frameAt,
    tangentAt,
    nearestU,
    curvatureAt: (u) => lerpLut(kappa, u),
    safeSpeedAt: (u) => lerpLut(safe, u),
  };
}
