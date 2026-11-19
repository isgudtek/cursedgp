import * as THREE from 'three';

/**
 * Spectator viewpoints: preset camera poses computed from the track in play, plus a 1 s
 * eased transition between them.
 *
 * The transition moves the camera rig, never the XR camera. In a headset the rig moves the
 * user's floor reference and the head pose keeps coming from WebXR tracking. In desktop mode the
 * camera itself also looks at the target each frame.
 */

const UP = new THREE.Vector3(0, 1, 0);
const DURATION = 1.0; // seconds per transition
const SAMPLES = 400; // track samples used to find the bounds, tightest bend and highest point
const ZOOM_BUTTON_STEP = 0.3; // metres per zoom button press
const ZOOM_WHEEL_STEP = 0.2; // metres per wheel notch
const ZOOM_RATE = 6; // 1/s: how quickly a zoom request is applied
const ZOOM_MIN_Y = 0.3; // camera may not drop below this height (m)
const ZOOM_MAX_R = 4; // camera may not move this far from the table centre (m)
const TABLE_CENTRE = new THREE.Vector3(0, 0.75, 0);

export const VIEW_NAMES = ["BIRD'S-EYE", 'FINISH LINE', 'HAIRPIN', 'BRIDGE'];

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _f = new THREE.Vector3();
const _z = new THREE.Vector3();

/** Position `back` metres behind and `up` metres above the track at `u`, looking `ahead` metres ahead. */
function poseAt(track, u, back, up, ahead) {
  const P = track.curve.getPointAt(u);
  const T = track.tangentAt(u, _t);
  return {
    pos: P.clone().addScaledVector(T, -back).addScaledVector(UP, up),
    target: P.clone().addScaledVector(T, ahead),
  };
}

/**
 * Preset camera poses for a track. Each entry: { name, pos, target } in world space.
 * @param {ReturnType<import('./track.js').createTrack>} track
 * @param {number} tableY
 */
export function buildViewpoints(track, tableY) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let uTight = 0, kMax = -Infinity, uHigh = 0, yMax = -Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / SAMPLES;
    track.curve.getPointAt(u, _p);
    minX = Math.min(minX, _p.x); maxX = Math.max(maxX, _p.x);
    minZ = Math.min(minZ, _p.z); maxZ = Math.max(maxZ, _p.z);
    const k = track.curvatureAt(u);
    if (k > kMax) { kMax = k; uTight = u; }
    if (_p.y > yMax) { yMax = _p.y; uHigh = u; }
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxZ - minZ);

  const bird = {
    pos: new THREE.Vector3(cx, tableY + 0.6 + size * 0.7, cz + size * 0.2),
    target: new THREE.Vector3(cx, tableY, cz),
  };
  return [
    { name: VIEW_NAMES[0], ...bird },
    { name: VIEW_NAMES[1], ...poseAt(track, 0, 0.45, 0.28, 0.2) },
    { name: VIEW_NAMES[2], ...poseAt(track, uTight, 0.3, 0.2, 0) },
    { name: VIEW_NAMES[3], ...poseAt(track, uHigh, 0.6, 0.3, 0) },
  ];
}

const smooth = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Spectator {
  /**
   * @param {THREE.Group} rig camera rig (the user's floor reference)
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(rig, camera, renderer) {
    this.rig = rig;
    this.camera = camera;
    this.renderer = renderer;
    this.views = [];
    this.current = -1; // index of the last viewpoint requested
    this.from = null; // transition state, null when idle
    this.zoomPending = 0; // metres of dolly still to apply (desktop only)
    this.zoomed = false; // true after a manual zoom, until the next viewpoint or cancel
    this.locked = false; // true while the free-orbit view owns the camera
  }

  setLocked(on) {
    this.locked = on;
    if (on) this.cancel();
  }

  /** Recompute viewpoints for a new track. Any running transition is dropped. */
  setTrack(track, tableY) {
    this.views = buildViewpoints(track, tableY);
    this.cancel();
  }

  /** Stop any transition and leave the rig where it is. */
  cancel() {
    this.from = null;
    this.zoomPending = 0;
    this.zoomed = false;
  }

  /**
   * Dolly the camera toward (+) or away from (-) what it is looking at, in metres.
   * Desktop only. A zoom ends any viewpoint transition in progress.
   */
  zoomBy(metres) {
    if (this.renderer.xr.isPresenting || this.locked) return;
    this.from = null;
    this.zoomed = true;
    this.zoomPending += metres;
  }

  get moving() {
    return this.from !== null;
  }

  /** Start a 1 s eased transition to viewpoint `i`. */
  flyTo(i) {
    const v = this.views[i];
    if (!v || this.locked) return;
    this.current = i;
    this.zoomed = false;
    const xr = this.renderer.xr.isPresenting;

    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const look = head.clone().addScaledVector(this.camera.getWorldDirection(_f), 1);

    // In a headset the camera orientation comes from the device, so the rig is turned to face the target.
    // The head's own yaw at the start is subtracted so the user ends up looking at the target.
    const rigYawFrom = this.rig.rotation.y;
    let rigYawTo = rigYawFrom;
    if (xr) {
      const fwd = _f.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const headYaw = Math.atan2(-fwd.x, -fwd.z);
      const d = _t.copy(v.target).sub(v.pos);
      const desired = Math.atan2(-d.x, -d.z);
      rigYawTo = rigYawFrom + wrapAngle(desired - headYaw - rigYawFrom);
    }

    this.from = {
      head,
      look,
      rigYawFrom,
      rigYawTo,
      t: 0,
      view: v,
    };
  }

  /** Apply part of a pending zoom so the dolly eases instead of jumping. Desktop only. */
  _zoomStep(dt) {
    const step = this.zoomPending * (1 - Math.exp(-ZOOM_RATE * dt));
    const dir = this.camera.getWorldDirection(_f);
    const next = _p.copy(this.rig.position).addScaledVector(dir, step);
    const cam = _z.copy(next).add(this.camera.position);
    if (cam.y < ZOOM_MIN_Y || cam.distanceTo(TABLE_CENTRE) > ZOOM_MAX_R) {
      this.zoomPending = 0; // out of bounds: drop the rest of this zoom
      return;
    }
    this.rig.position.copy(next);
    this.rig.updateMatrixWorld(true);
    this.zoomPending -= step;
    if (Math.abs(this.zoomPending) < 0.005) this.zoomPending = 0;
  }

  /** Advance zoom and transition. Call once per frame, before rendering. */
  update(dt) {
    if (this.zoomPending !== 0 && !this.from) this._zoomStep(dt);

    const s = this.from;
    if (!s) return;
    const xr = this.renderer.xr.isPresenting;
    s.t = Math.min(1, s.t + dt / DURATION);
    const e = smooth(s.t);

    const head = _p.copy(s.head).lerp(s.view.pos, e);
    const look = _t.copy(s.look).lerp(s.view.target, e);
    if (xr) this.rig.rotation.y = s.rigYawFrom + (s.rigYawTo - s.rigYawFrom) * e;

    // Keep the head's world position: rig = head - (camera local offset, rotated by the rig yaw).
    const local = _f.copy(this.camera.position).applyAxisAngle(UP, this.rig.rotation.y);
    this.rig.position.copy(head).sub(local);
    this.rig.updateMatrixWorld(true);

    // Desktop only: the camera looks at the moving target. In XR the device sets the view.
    if (!xr) this.camera.lookAt(look);

    if (s.t >= 1) this.from = null;
  }
}

/**
 * DOM panel at top-right, under the telemetry box: one button per viewpoint, then zoom in and out.
 * The mouse wheel over the canvas zooms too. The panel is hidden during XR sessions, when DOM
 * overlays are not visible.
 */
export function mountSpectatorUi(spectator, canvas) {
  // The camera panel folds into one CAMERA header. It starts folded on phones and small screens.
  const wrap = document.createElement('div');
  wrap.id = 'spectator';
  Object.assign(wrap.style, {
    position: 'fixed',
    top: '224px', // below the telemetry box (200 px tall)
    right: '12px',
    width: 'min(260px, 42vw)',
    zIndex: '5',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  });
  const header = document.createElement('button');
  header.tabIndex = -1;
  Object.assign(header.style, {
    font: '700 12px monospace',
    padding: '7px 10px',
    borderRadius: '6px',
    border: '1px solid #2a3344',
    background: '#10151d',
    color: '#e8edf3',
    cursor: 'pointer',
    textAlign: 'right',
  });
  const box = document.createElement('div');
  box.className = 'cam-body';
  Object.assign(box.style, { display: 'flex', flexDirection: 'column', gap: '5px' });
  const folded = window.innerWidth < 760 || window.innerHeight < 500; // folded on phones
  box.style.display = folded ? 'none' : 'flex';
  header.textContent = folded ? 'CAMERA \u25BE' : 'CAMERA \u25B4';
  header.addEventListener('click', () => {
    const open = box.style.display === 'none';
    box.style.display = open ? 'flex' : 'none';
    header.textContent = open ? 'CAMERA \u25B4' : 'CAMERA \u25BE';
    header.blur();
  });
  wrap.append(header, box);
  document.body.appendChild(wrap);

  const styleButton = (b) => {
    Object.assign(b.style, {
      font: '700 13px monospace',
      textAlign: 'left',
      padding: '8px 12px',
      borderRadius: '6px',
      border: '1px solid #2a3344',
      background: '#10151d',
      color: '#e8edf3',
      cursor: 'pointer',
    });
    b.tabIndex = -1; // keeps Space (throttle) from activating a focused button
    return b;
  };

  const viewButtons = VIEW_NAMES.map((name, i) => {
    const b = styleButton(document.createElement('button'));
    b.textContent = name;
    b.addEventListener('click', () => {
      spectator.flyTo(i);
      b.blur();
      viewButtons.forEach((o, j) => {
        o.style.borderColor = j === i ? '#58d68d' : '#2a3344';
        o.style.background = j === i ? '#16351f' : '#10151d';
      });
    });
    box.appendChild(b);
    return b;
  });

  const zoomRow = document.createElement('div');
  Object.assign(zoomRow.style, { display: 'flex', gap: '6px' });
  for (const [label, delta] of [['ZOOM -', -ZOOM_BUTTON_STEP], ['ZOOM +', ZOOM_BUTTON_STEP]]) {
    const b = styleButton(document.createElement('button'));
    b.textContent = label;
    b.style.flex = '1';
    b.style.textAlign = 'center';
    b.addEventListener('click', () => {
      spectator.zoomBy(delta);
      b.blur();
    });
    zoomRow.appendChild(b);
  }
  box.appendChild(zoomRow);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      spectator.zoomBy(-Math.sign(e.deltaY) * ZOOM_WHEEL_STEP);
    },
    { passive: false },
  );

  return {
    box,
    show(on) {
      wrap.style.display = on ? 'flex' : 'none';
    },
  };
}
