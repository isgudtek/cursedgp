import * as THREE from 'three';

/**
 * Camera framing: fit the whole track into the free part of the screen (the "safe area") as tightly as the
 * screen shape allows. Pure functions on THREE math only, so they run under Node tests too.
 *
 * Camera convention (same as the free orbit in main.js): the camera sits at
 *   target + dist * (sin(yaw) cos(pitch), sin(pitch), cos(yaw) cos(pitch))
 * and looks at `target`. `pitch` is the angle above the horizon (pi/2 = straight down).
 */

export const FIT_PITCH = 1.05; // about 60 degrees down: a steep 3/4 view
export const FIT_FILL = 0.94; // the track's limiting side uses this share of the safe area

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cam = new THREE.PerspectiveCamera(60, 1, 0.03, 200);

/** Points along both deck edges, so the fit includes the full width of the track. */
export function sampleTrack(curve, halfWidth, n = 96) {
  const pts = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const u = i / n;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    s.set(-t.z, 0, t.x);
    if (s.lengthSq() < 1e-12) s.set(1, 0, 0);
    s.normalize();
    pts.push(p.clone().addScaledVector(s, halfWidth), p.clone().addScaledVector(s, -halfWidth));
  }
  return pts;
}

/** Centre of the points' bounding box. */
export function boxCentre(pts) {
  const b = new THREE.Box3().setFromPoints(pts);
  return b.getCenter(new THREE.Vector3());
}

/** Angle t of the long axis on the ground: the track is longest along (cos t, sin t) in (x, z). 2D PCA. */
export function principalAngle(pts) {
  let mx = 0;
  let mz = 0;
  for (const p of pts) {
    mx += p.x;
    mz += p.z;
  }
  mx /= pts.length;
  mz /= pts.length;
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dz = p.z - mz;
    xx += dx * dx;
    zz += dz * dz;
    xz += dx * dz;
  }
  return 0.5 * Math.atan2(2 * xz, xx - zz);
}

/** Yaws that lay the long axis across the screen (landscape) or into the screen (portrait), both ways round. */
export function axisYaws(angle) {
  const across = -angle; // long axis along the screen's horizontal
  const into = Math.atan2(Math.cos(angle), Math.sin(angle)); // long axis along the view direction
  return [across, across + Math.PI, into, into + Math.PI];
}

export function orbitDir(yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
}

function placeCam(target, yaw, pitch, dist, fov, aspect) {
  _cam.fov = fov;
  _cam.aspect = aspect;
  _cam.updateProjectionMatrix();
  _cam.position.copy(target).addScaledVector(orbitDir(yaw, pitch, _dir), dist);
  _cam.lookAt(target);
  _cam.updateMatrixWorld(true);
  return _cam;
}

/** NDC bounding box of the points, or null if any point is behind the camera. */
function projectBox(pts, cam) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    _v.copy(p).project(cam);
    if (_v.z > 1 || _v.z < -1) return null;
    if (_v.x < x0) x0 = _v.x;
    if (_v.x > x1) x1 = _v.x;
    if (_v.y < y0) y0 = _v.y;
    if (_v.y > y1) y1 = _v.y;
  }
  return { x0, x1, y0, y1 };
}

/**
 * Closest camera distance at which the points fit `safe` (screen px, inside a viewW x viewH view), and the view
 * offset that centres the track's screen box on the safe area.
 * @param {{ pts: THREE.Vector3[], target: THREE.Vector3, yaw: number, pitch?: number, fov: number,
 *           viewW: number, viewH: number, safe: { x: number, y: number, w: number, h: number }, fill?: number }} o
 * @returns {{ dist: number, pos: THREE.Vector3, offX: number, offY: number, fill: number, startNdcY: number|null }}
 */
export function fitView(o, start = null) {
  const pitch = o.pitch ?? FIT_PITCH;
  const fill = o.fill ?? FIT_FILL;
  const aspect = o.viewW / o.viewH;
  const halfW = o.viewW / 2;
  const halfH = o.viewH / 2;
  const fits = (box) => box && (box.x1 - box.x0) * halfW <= fill * o.safe.w && (box.y1 - box.y0) * halfH <= fill * o.safe.h;
  let lo = 0.05;
  let hi = 4;
  while (!fits(projectBox(o.pts, placeCam(o.target, o.yaw, pitch, hi, o.fov, aspect))) && hi < 400) hi *= 2;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (fits(projectBox(o.pts, placeCam(o.target, o.yaw, pitch, mid, o.fov, aspect)))) hi = mid;
    else lo = mid;
  }
  const cam = placeCam(o.target, o.yaw, pitch, hi, o.fov, aspect);
  const box = projectBox(o.pts, cam);
  // Screen px of an NDC point in the un-offset view: (halfW + x*halfW, halfH - y*halfH). The view offset shifts the
  // whole picture so that the box centre lands on the safe area's centre.
  const cx = ((box.x0 + box.x1) / 2) * halfW;
  const cy = ((box.y0 + box.y1) / 2) * halfH;
  const sx = o.safe.x + o.safe.w / 2;
  const sy = o.safe.y + o.safe.h / 2;
  let startNdcY = null;
  if (start) startNdcY = _v.copy(start).project(cam).y;
  return {
    dist: hi,
    pos: cam.position.clone(),
    offX: halfW + cx - sx,
    offY: halfH - cy - sy,
    fill: Math.max(((box.x1 - box.x0) * halfW) / o.safe.w, ((box.y1 - box.y0) * halfH) / o.safe.h),
    startNdcY,
  };
}

/**
 * The yaw that shows the track biggest in this safe area: the PCA axis yaws plus a sweep. Among yaws within 3% of
 * the closest fit, the one with the start line lowest on screen wins, so the grid sits near the player.
 */
export function bestYaw(o, start) {
  const cands = axisYaws(principalAngle(o.pts));
  for (let i = 0; i < 24; i++) cands.push((i / 24) * Math.PI * 2);
  const fits = cands.map((yaw) => ({ yaw, f: fitView({ ...o, yaw }, start) }));
  const best = Math.min(...fits.map((c) => c.f.dist));
  const close = fits.filter((c) => c.f.dist <= best * 1.03);
  close.sort((a, b) => (a.f.startNdcY ?? 0) - (b.f.startNdcY ?? 0));
  return close[0];
}

/**
 * Largest free rectangle after cutting away each obstacle (largest first): for every obstacle the cut that keeps the
 * most area (left of it, right of it, above or below) is taken. Rects are screen px { x, y, w, h }.
 */
export function safeRect(viewW, viewH, obstacles, margin = 10, inset = 6) {
  let R = { x0: inset, y0: inset, x1: viewW - inset, y1: viewH - inset };
  const obs = obstacles.filter((o) => o && o.w > 0 && o.h > 0).sort((a, b) => b.w * b.h - a.w * a.h);
  const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  for (const o of obs) {
    const ox0 = o.x - margin;
    const oy0 = o.y - margin;
    const ox1 = o.x + o.w + margin;
    const oy1 = o.y + o.h + margin;
    if (ox1 <= R.x0 || ox0 >= R.x1 || oy1 <= R.y0 || oy0 >= R.y1) continue;
    const cands = [
      { ...R, x1: Math.min(R.x1, ox0) },
      { ...R, x0: Math.max(R.x0, ox1) },
      { ...R, y1: Math.min(R.y1, oy0) },
      { ...R, y0: Math.max(R.y0, oy1) },
    ];
    let best = cands[0];
    for (const c of cands) if (area(c) > area(best)) best = c;
    R = best;
  }
  return { x: R.x0, y: R.y0, w: Math.max(1, R.x1 - R.x0), h: Math.max(1, R.y1 - R.y0) };
}
