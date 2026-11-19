import * as THREE from 'three';

/**
 * TV coverage: a set of fixed trackside cameras, like a race broadcast. The track is split into zones; each zone has
 * one camera standing beside the track a little ahead of the zone's middle, so a car drives towards it, past it and
 * then cuts to the next. The camera position stays put; only where it looks and how far it zooms follow the car.
 * Pure THREE maths, no scene objects.
 */

const CAM_SPACING = 0.95; // m of track per camera (before track scaling)
const MIN_CAMS = 6;
const MAX_CAMS = 16;
const MIN_CLEAR = 0.2; // m: a camera never stands closer than this to any stretch of track
export const TV_HOLD = 1.1; // s: shortest time on one camera (no flicker on short zones)

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _side = new THREE.Vector3();

/**
 * @param {{ curve: THREE.Curve, length: number, tangentAt: Function }} track
 * @param {number} tableY
 * @param {number} scale track size factor (1 = 100 %)
 * @param {THREE.Vector3} centre middle of the track
 * @returns {{ u: number, zone0: number, zone1: number, pos: THREE.Vector3 }[]}
 */
export function buildTvCameras(track, tableY, scale, centre) {
  const n = Math.max(MIN_CAMS, Math.min(MAX_CAMS, Math.round(track.length / (CAM_SPACING * scale))));
  // Centre-line samples for the clearance test.
  const line = [];
  for (let i = 0; i < 240; i++) line.push(track.curve.getPointAt(i / 240).clone());
  const clearance = (pos) => {
    let m = Infinity;
    for (const q of line) m = Math.min(m, Math.hypot(q.x - pos.x, q.z - pos.z));
    return m;
  };
  const cams = [];
  for (let i = 0; i < n; i++) {
    const zone0 = i / n;
    const zone1 = (i + 1) / n;
    const u = (i + 0.78) / n; // ahead of the zone middle: the car comes towards the camera
    track.curve.getPointAt(u, _p);
    track.tangentAt(u, _t);
    track.tangentAt((u + 0.004) % 1, _t2);
    // Candidate sides: outside of the bend, away from the circuit's middle, then the other side.
    _t2.sub(_t).setY(0);
    const outBend = _t2.lengthSq() > 1e-10 ? _t2.clone().normalize().negate() : null;
    _side.set(-_t.z, 0, _t.x).normalize();
    const away = _side.clone();
    if (away.dot(_p.clone().sub(centre).setY(0)) < 0) away.negate();
    const sides = [outBend, away, away.clone().negate()].filter(Boolean);
    let best = null;
    for (const s of sides) {
      for (const d of [0.78, 0.98, 1.2, 0.55]) { // broadcast cameras stand back and zoom in
        const pos = _p.clone().addScaledVector(s, d * scale);
        const c = clearance(pos);
        if (!best || c > best.c) best = { pos, c };
        if (c >= MIN_CLEAR * scale) {
          best = { pos, c, ok: true };
          break;
        }
      }
      if (best && best.ok) break;
    }
    // Height: above the local deck (bridges included) and never below a low tripod over the table.
    best.pos.y = Math.max(_p.y, tableY) + 0.34 * scale;
    cams.push({ u, zone0, zone1, pos: best.pos });
  }
  return cams;
}

/** Index of the camera whose zone contains track position u. */
export function zoneOf(cams, u) {
  const w = ((u % 1) + 1) % 1;
  for (let i = 0; i < cams.length; i++) if (w >= cams[i].zone0 && w < cams[i].zone1) return i;
  return cams.length - 1;
}

/**
 * Field of view (degrees) that frames about `frameW` metres around a car `dist` metres away.
 */
export function tvFov(dist, frameW, min = 12, max = 46) {
  const f = THREE.MathUtils.radToDeg(2 * Math.atan(frameW / 2 / Math.max(0.05, dist)));
  return Math.min(max, Math.max(min, f));
}
