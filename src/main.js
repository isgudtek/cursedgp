import * as THREE from 'three';
import { createTrack, loadCircuit, CIRCUITS, figure8Points, HALF_W } from './track.js';
import { FALLBACK } from './circuit-data.js';
import { Car, CAR } from './car.js';
import { Input } from './input.js';
import { SlotAudio } from './audio.js';
import { Hud } from './hud.js';
import { Spectator, VIEW_NAMES } from './spectator.js';
import { mountDock } from './dock.js';
import { mountSignals } from './signals.js';
import { RaceController, MODE } from './race.js';
import { Sparks } from './effects.js';
import { mountResults, mountTitle, mountSetupBar, mountLobby } from './menu.js';
import { createLobby } from './lobby.js';
import { createOnline } from './online.js';
import { Recorder, ReplayPlayer, mountReplayUi } from './replay.js';
import { AI_PROFILES, AiDriver } from './ai.js';
import { CarLocator } from './locator.js';
import { Atmosphere, decorateCar } from './atmosphere.js';
import { CockpitTV } from './cockpit.js';
import { CAR_MODELS, CAR_KEYS, GaragePreview, loadKenneyModels } from './cars.js';
import { Monsters } from './monsters.js';
import { sampleTrack, safeRect, boxCentre, bestYaw, fitView } from './framing.js';
import { buildTvCameras, zoneOf, tvFov, TV_HOLD } from './tvcams.js';
import { installPixelHeadings } from './pixel.js';
import { createTips } from './tips.js';

installPixelHeadings(); // pixel headings, like the replay's R

// ---------------------------------------------------------------- world constants
const TABLE_Y = 0.75; // table-top height above the floor (m); the track sits here
const HX = 1.35; // play area half extents (x)
const HZ = 0.825; // play area half extents (z)
const world = { tableY: TABLE_Y, hx: HX, hz: HZ };
const _orbitPos = new THREE.Vector3();

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
// Render resolution by graphics level: Low 50 %, Medium 75 %, High 100 % of the screen (for debugging the quality).
const RESOLUTION = { low: 0.5, medium: 0.75, high: 1 };
const applyResolution = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * RESOLUTION[trackQuality]);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BASE_FOV = 70; // every view but TV uses this; TV zooms by changing the fov
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.03, 40);
const rig = new THREE.Group(); // camera rig: the free orbit and the spectator views move it
rig.add(camera);
scene.add(rig);
const atmos = new Atmosphere(scene);

function resetRig() {
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0);
}
resetRig();

// ---------------------------------------------------------------- game objects
// Track detail: low (the earlier look, phones by default), medium (the current look) or high (finer bends).
const QUALITY_ORDER = ['low', 'medium', 'high'];
let trackQuality = window.matchMedia('(max-width: 760px), (max-height: 500px)').matches ? 'low' : 'medium';
applyResolution(); // after the quality is known
let track = createTrack({ tableY: TABLE_Y, vmax: CAR.vmax, quality: trackQuality }); // default: Classic Figure-8

function prepareTrack(t) {
  t.group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}
prepareTrack(track);
scene.add(track.group);
atmos.setTrack(track, TABLE_Y);

const spectator = new Spectator(rig, camera, renderer);
spectator.setTrack(track, TABLE_Y);
// A preset viewpoint takes over the camera: leave TV, CHASE or FREE first (the spectator is locked in those).
const flyToView = spectator.flyTo.bind(spectator);
let presetView = -1; // preset viewpoint shown now, or -1
spectator.flyTo = (i) => {
  if (camMode !== DEFAULT_CAM) setCamMode(DEFAULT_CAM, false);
  flyToView(i);
  presetView = i;
};

// Cockpit TVs: two small screens from inside the cars, switched on from the camera menu.
let cockpitOn = false;
const tvRow = document.createElement('div');
tvRow.id = 'cockpit-tvs';
Object.assign(tvRow.style, { position: 'fixed', left: '12px', bottom: '12px', zIndex: '7', display: 'none', gap: '8px', pointerEvents: 'none' });
document.body.appendChild(tvRow);
const tvPlayer = new CockpitTV('YOU', '#ff8b82', tvRow);
const tvRival = new CockpitTV('RIVAL', '#9b5cff', tvRow);
let tvAcc = 0;

const CAR_SCALE = 0.77; // cars at 77% of their model size (10 % bigger than 70 %); the physics still runs on the track
// Garage: the player picks a car; the AI rival takes a different one at the start of each race.
let playerModel = 'formula';
let rivalModel = 'coupe';
const player = new Car(track, { lane: 0, world, model: playerModel });
player.isPlayerCar = true;
const rival = new Car(track, { lane: 1, world, model: rivalModel });
const ghost = new Car(track, { lane: 0, color: 0x9fd8ff, world, model: 'coupe' });
decorateCar(player, CAR_MODELS[playerModel].under);
decorateCar(rival, CAR_MODELS[rivalModel].under);
const garagePreview = new GaragePreview(renderer);
garagePreview.setModel(playerModel);
ghost.makeGhost();
for (const c of [player, rival, ghost]) c.mesh.scale.setScalar(CAR_SCALE);
atmos.registerCar(player);
atmos.registerCar(rival);

/** Give a car another model: keeps its place on the slot, re-decorates it and re-registers its lights. */
function swapCarModel(car, key) {
  if (car.model === key) return;
  const old = car.setModel(key);
  scene.remove(old);
  scene.add(car.mesh);
  car.mesh.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  decorateCar(car, CAR_MODELS[key].under);
  atmos.registerCar(car);
}

/** Random rival car, never the same model as the player's. */
function pickRivalModel() {
  const others = CAR_KEYS.filter((k) => k !== playerModel);
  return others[Math.floor(Math.random() * others.length)];
}
atmos.decorateGhost(ghost);
const cars = [player, rival];
for (const c of cars) c.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
scene.add(player.mesh, rival.mesh, ghost.mesh);
ghost.mesh.visible = false;

const hud = new Hud();
hud.showOverlay();
hud.canvas.style.display = 'none'; // the title screen comes first

const audio = new SlotAudio();
const locator = new CarLocator(scene); // the yellow "this is your car" arrow
let locateManual = false; // asked for with I or the locate button: shown even in the chase view
let lastRaceState = '';
// Shift immunity (haunted): a 2 s shield against the hazards, 3 per lap, reset on each new race.
const SHIELD_TIME = 1.3; // s of immunity, shown as the car blinking, like after a reset
const SHIELD_CHARGES = 3;
const shieldRing = new THREE.Mesh(new THREE.RingGeometry(0.024, 0.03, 36).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false }));
shieldRing.renderOrder = 996;
shieldRing.visible = false;
scene.add(shieldRing);
const shieldHud = document.createElement('div');
shieldHud.id = 'shield-hud';
Object.assign(shieldHud.style, { position: 'fixed', left: '12px', bottom: '58px', zIndex: '8', display: 'none', font: '700 11px monospace',
  color: '#e8e2f5', background: 'rgba(5,6,10,0.6)', padding: '4px 8px', borderRadius: '6px', pointerEvents: 'none', letterSpacing: '.08em' });
shieldHud.innerHTML = 'SHIFT <span class="num" style="font:700 24px monospace;color:#f4f6ff;margin:0 8px;vertical-align:middle"></span><span class="pips" style="color:#b48cff"></span>';
document.body.appendChild(shieldHud);
// On a phone the SHIFT counter is a button: a tap uses a shield (the other thumb keeps the throttle).
shieldHud.style.pointerEvents = 'auto';
shieldHud.style.cursor = 'pointer';
shieldHud.style.touchAction = 'manipulation';
shieldHud.addEventListener('click', () => {
  if (phase === 'race') useShield();
});
shieldHud.addEventListener('pointerup', (e) => e.stopPropagation()); // a tap here must not release the throttle
atmos.audio = audio; // the haunted storm rolls thunder after each lightning bolt
// Earthquake shake strength: much gentler for players who ask the system for reduced motion.
const QUAKE_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0.25 : 1;
const input = new Input();
const sparks = new Sparks(scene);
const hazards = new Monsters(scene, audio, sparks, TABLE_Y); // Haunted Mode monsters
world.onGrass = (x, z) => hazards.onGrass(x, z); // a derailed car lands on the green grass
hazards.setVisible(true); // haunted is the default: the monsters are on from the start

// ---------------------------------------------------------------- circuit tiles (drawn for the title screen)
const TILE_PX = 128;
let activeIndex = 0; // circuit currently on the table
let pendingIndex = -1; // circuit being fetched/built
let loadToken = 0;
const trackScale = 1.5; // every circuit at 150 % of its base size (the old SIZE control was for debugging); cars are never scaled

/** Draw one tile at `size` px with its top-left corner at (ox, oy): the circuit outline plus its label. */
function drawTile(g, def, state, size = TILE_PX, ox = 0, oy = 0) {
  const pad = Math.round(size * 0.22);
  const area = size - pad;
  g.save();
  g.translate(ox, oy);
  g.fillStyle = state === 'active' ? '#16351f' : state === 'pending' ? '#4a3408' : '#0a0d12';
  g.fillRect(0, 0, size, size);
  let pts;
  if (!def.id) {
    pts = figure8Points(TABLE_Y).map((p) => [p.x, p.z]);
  } else {
    const c = FALLBACK[def.id];
    const k = Math.cos((c.reduce((sum, p) => sum + p[1], 0) / c.length) * (Math.PI / 180));
    pts = c.map((p) => [p[0] * k, -p[1]]);
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const sc = area / Math.max(x1 - x0, y1 - y0);
  const ox2 = (size - (x1 - x0) * sc) / 2;
  const oy2 = size * 0.03 + (area - (y1 - y0) * sc) / 2;
  g.beginPath();
  pts.forEach(([x, y], i) => {
    const px = ox2 + (x - x0) * sc;
    const py = oy2 + (y - y0) * sc;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  });
  g.closePath();
  g.strokeStyle = state === 'active' ? '#58d68d' : '#d7dee8';
  g.lineWidth = Math.max(1.5, size * 0.023);
  g.lineJoin = 'round';
  g.stroke();
  g.fillStyle = '#e8edf3';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let fontPx = Math.max(9, Math.round(size * 0.11));
  g.font = `700 ${fontPx}px monospace`;
  while (fontPx > 7 && g.measureText(def.label).width > size - 2) {
    fontPx -= 1;
    g.font = `700 ${fontPx}px monospace`;
  }
  g.fillText(def.label, size / 2, size - pad * 0.43);
  g.restore();
}


// ---------------------------------------------------------------- camera framing
// The track is fitted into the part of the screen the UI leaves free (the safe area): turned so it is as big as
// the screen shape allows, seen from a steep 3/4 view, and centred with a view offset. See framing.js.
const home = {
  center: new THREE.Vector3(0, TABLE_Y, 0), // look target: the middle of the track
  pos: new THREE.Vector3(), // fitted camera position
  dist: 3,
  yaw: 0,
  offX: 0,
  offY: 0,
  safe: null,
  fitBase: null, // inputs of the last fit, reused by the title sway
};
const look = new THREE.Vector3(0, TABLE_Y, 0); // current look target
let tween = null; // { from, fromLook, to, toLook, t, dur } camera move
// Camera order: 1 TV (trackside cameras, the default), 2 CHASE (behind your car), 3 OVERVIEW (the whole track), 4 FREE (orbit by hand).
const DEFAULT_CAM = 'tv';
let camMode = DEFAULT_CAM;
// TV: fixed cameras along the track; the one covering your car pans and zooms to it, then cuts to the next.
const tv = { cams: [], cur: -1, held: 0, look: new THREE.Vector3(), fov: BASE_FOV };
// Compact race chrome (top HUD band, bottom buttons, thumb gauge) on phones in either orientation.
const compactQ = window.matchMedia('(max-width: 760px), (max-height: 500px)');
const SWAY = 0.21; // rad (12 degrees): the title screen sways gently around the fitted view
let swayT = 0;
const off = { x: 0, y: 0, tx: 0, ty: 0 }; // view offset now and its target (px)

const DECK_HALF = HALF_W + 0.01; // half the deck width plus a little, so the fit includes the whole track surface
/** Screen rects of the UI that must not cover the track in the current phase. */
function obstacleRects() {
  const els = [hud.canvas, document.getElementById('trigger'), document.getElementById('camflip'), document.getElementById('locate'), document.getElementById('dock'), document.getElementById('cockpit-tvs'),
    document.getElementById('setup-bar'),
    title.el.querySelector('.card'), document.getElementById('lobby')];
  const out = [];
  for (const el of els) {
    if (!el || !el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let hidden = false;
    for (let e = el; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).display === 'none') hidden = true;
    if (!hidden) out.push({ x: r.left, y: r.top, w: r.width, h: r.height, id: el.id || el.className });
  }
  return out;
}
function safeArea() {
  return safeRect(window.innerWidth, window.innerHeight, obstacleRects());
}

/** Fit the current track into the current safe area: picks the yaw, distance and view offset. */
function fitFrame() {
  const pts = sampleTrack(track.curve, DECK_HALF, 96);
  const safe = safeArea();
  const base = { pts, target: boxCentre(pts), fov: BASE_FOV, viewW: window.innerWidth, viewH: window.innerHeight, safe };
  const best = bestYaw(base, track.curve.getPointAt(0));
  home.center.copy(base.target);
  home.yaw = best.yaw;
  home.pos.copy(best.f.pos);
  home.dist = best.f.dist;
  home.offX = best.f.offX;
  home.offY = best.f.offY;
  home.safe = safe;
  home.fitBase = base;
  tv.cams = buildTvCameras(track, TABLE_Y, trackScale, home.center); // the broadcast cameras follow the track
  hazards.clearSightlines(track, tv.cams); // no haunted tree stands in front of a TV camera
  tv.cur = -1;
}

/** Fitted pose at a yaw away from the fitted one (the title sway). */
function swayFit(dYaw) {
  return fitView({ ...home.fitBase, yaw: home.yaw + dYaw });
}

/** Refit, and move the overview camera to the new fit (gliding unless `snap`). */
let refitCount = 0;
function refit(snap = false) {
  refitCount++;
  fitFrame();
  layoutSig = layoutSignature();
  if ((phase === 'race' || phase === 'setup') && camMode === 'overview' && !replay.active && !spectator.moving && !spectator.zoomed) {
    tweenTo(home.pos, home.center, snap ? 0 : 0.5);
  } else if (phase === 'menu' && tween) {
    // A glide to the title view is under way (e.g. after ESC) and the track changed: aim it at the new fit.
    tween.to.copy(swayFit(SWAY * Math.sin(swayT)).pos);
    tween.toLook.copy(home.center);
  }
}

/** Changes in screen size, phase, circuit or visible UI change the safe area: they trigger a refit. */
let layoutSig = '';
let sigAcc = 0;
function layoutSignature() {
  const r = obstacleRects().map((o) => `${o.id}:${Math.round(o.x / 4)},${Math.round(o.y / 4)},${Math.round(o.w / 4)},${Math.round(o.h / 4)}`);
  return [window.innerWidth, window.innerHeight, phase, activeIndex, trackScale, r.join('|')].join(';');
}

/** View offset target for the current camera mode. The replay is full screen with no offset. */
function offsetTarget(swayOff) {
  if (replay.active) return [0, 0];
  if (swayOff) return swayOff;
  if ((camMode === 'chase' || camMode === 'tv') && home.safe) {
    // Chase: centre the picture on the safe area so the car is never under the HUD.
    return [window.innerWidth / 2 - (home.safe.x + home.safe.w / 2), window.innerHeight / 2 - (home.safe.y + home.safe.h / 2)];
  }
  return [home.offX, home.offY];
}

function applyOffset(dt, snap = false) {
  const k = snap ? 1 : 1 - Math.exp(-10 * dt);
  off.x += (off.tx - off.x) * k;
  off.y += (off.ty - off.y) * k;
  if (Math.abs(off.tx - off.x) < 0.5) off.x = off.tx;
  if (Math.abs(off.ty - off.y) < 0.5) off.y = off.ty;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const v = camera.view;
  if (!off.x && !off.y) {
    if (v && v.enabled) camera.clearViewOffset();
  } else if (!v || !v.enabled || v.offsetX !== off.x || v.offsetY !== off.y || v.fullWidth !== W || v.fullHeight !== H) {
    camera.setViewOffset(W, H, off.x, off.y, W, H);
  }
}

// Chase camera: behind and above your own car, smoothed, looking ahead along the track.
const CHASE_BACK = 0.32;
const CHASE_UP = 0.16;
const CHASE_AHEAD = 0.3;
const chase = { eye: new THREE.Vector3(), look: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1), init: false };
const _cf = new THREE.Vector3();
const _ce = new THREE.Vector3();
const _cl = new THREE.Vector3();
function chaseStep(dt) {
  const car = isGuest() ? rival : player;
  if (car.state === 'running') track.tangentAt(car.u, _cf);
  else _cf.copy(chase.fwd);
  _cf.y = 0;
  if (_cf.lengthSq() < 1e-8) _cf.copy(chase.fwd);
  _cf.normalize();
  if (!chase.init) {
    chase.fwd.copy(_cf);
    chase.eye.copy(rig.position);
    chase.look.copy(look);
    chase.init = true;
  }
  chase.fwd.lerp(_cf, 1 - Math.exp(-6 * dt)).normalize();
  _ce.copy(car.position).addScaledVector(chase.fwd, -CHASE_BACK);
  _ce.y += CHASE_UP;
  _cl.copy(car.position).addScaledVector(chase.fwd, CHASE_AHEAD);
  chase.eye.lerp(_ce, 1 - Math.exp(-10 * dt));
  chase.look.lerp(_cl, 1 - Math.exp(-14 * dt));
  applyPose(chase.eye, chase.look);
}

const TV_FRAME = 0.62; // m of track around the car that a TV shot frames (scaled with the track): a tight, telephoto shot
const _tvAim = new THREE.Vector3();
function setFov(f) {
  if (Math.abs(camera.fov - f) < 0.01) return;
  camera.fov = f;
  camera.updateProjectionMatrix();
}
function tvStep(dt) {
  if (!tv.cams.length) return;
  const car = isGuest() ? rival : player;
  const u = car.state === 'running' ? car.u : track.nearestU(car.position, car.lane).u;
  const want = zoneOf(tv.cams, u);
  tv.held += dt;
  let cut = false;
  if (tv.cur < 0 || (want !== tv.cur && tv.held >= TV_HOLD)) {
    cut = tv.cur !== want;
    tv.cur = want;
    tv.held = 0;
  }
  const cam = tv.cams[tv.cur];
  // Aim a little ahead of the car, as a camera operator leads a moving subject.
  _tvAim.copy(car.position);
  if (car.state === 'running') {
    track.tangentAt(car.u, _cf);
    _tvAim.addScaledVector(_cf, Math.min(0.12, car.speed * 0.08));
  }
  const dist = cam.pos.distanceTo(_tvAim);
  const fov = tvFov(dist, TV_FRAME); // the shot frames the car, and cars are never scaled
  if (cut) {
    tv.look.copy(_tvAim);
    tv.fov = fov;
  } else {
    tv.look.lerp(_tvAim, 1 - Math.exp(-9 * dt));
    tv.fov += (fov - tv.fov) * (1 - Math.exp(-4 * dt));
  }
  setFov(tv.fov);
  applyPose(cam.pos, tv.look);
}

/** OVERVIEW, TV, CHASE or FREE. Leaving the others glides back to the fitted view unless `glide` is false. */
function setCamMode(mode, glide = true) {
  const prev = camMode;
  camMode = mode;
  if (mode !== 'tv') setFov(BASE_FOV);
  else {
    tween = null;
    tv.cur = -1;
  }
  view.free = mode === 'free';
  spectator.setLocked(mode !== 'overview');
  presetView = -1;
  dock.refresh();
  if (mode === 'free') {
    if (prev === 'free') return;
    tween = null;
    view.target.copy(look);
    const d = rig.position.clone().sub(view.target);
    view.dist = Math.max(d.length(), 0.01);
    view.yaw = Math.atan2(d.x, d.z);
    view.pitch = Math.min(TILT_MAX, Math.max(TILT_MIN, Math.asin(Math.min(1, d.y / view.dist))));
  } else if (mode === 'chase') {
    tween = null;
    chase.init = false;
  } else if (glide && prev !== 'overview') {
    view.target.copy(home.center);
    tweenTo(home.pos, home.center, 0.6);
  }
}
const CAM_ORDER = ['tv', 'chase', 'overview', 'free'];
const cycleCam = () => setCamMode(CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length]);

function applyPose(pos, target) {
  rig.position.copy(pos);
  camera.position.set(0, 0, 0);
  rig.updateMatrixWorld(true);
  look.copy(target);
  camera.lookAt(target);
}

/** Smooth camera move. */
function tweenTo(pos, target, dur) {
  if (dur <= 0) {
    tween = null;
    applyPose(pos, target);
    return;
  }
  tween = { from: rig.position.clone(), fromLook: look.clone(), to: pos.clone(), toLook: target.clone(), t: 0, dur };
}

const smooth = (t) => t * t * (3 - 2 * t);
function updateCameraTween(dt) {
  if (!tween) return;
  tween.t = Math.min(1, tween.t + dt / tween.dur);
  const e = smooth(tween.t);
  rig.position.lerpVectors(tween.from, tween.to, e);
  look.lerpVectors(tween.fromLook, tween.toLook, e);
  rig.updateMatrixWorld(true);
  camera.lookAt(look);
  if (tween.t >= 1) tween = null;
}

// ---------------------------------------------------------------- race: controller and menus
let phase = 'menu'; // 'menu' (title screen and orbit) | 'race'

const isGuest = () => online?.role === 'guest';
/**
 * The challenge is declared when the room opens: while you host a room its settings (circuit, size, laps, sky,
 * haunted, your car) are fixed until you close it. A guest always plays the host's settings.
 */
const settingsLocked = () => isGuest() || !!lobby?.snapshot().hosting;
/** Pick the car for the next race (the garage and the title's car arrows both use this). */
function selectCarNow(key) {
  if (race.busy || lobby.snapshot().hosting) return; // the room advertises your car
  playerModel = key;
  swapCarModel(isGuest() ? rival : player, key); // a guest's own car is lane 1
  garagePreview.setModel(key);
  refreshMenus();
}
const garageMenu = { models: CAR_KEYS.map((k) => ({ key: k, name: CAR_MODELS[k].name, stats: CAR_MODELS[k].stats })), canvas: garagePreview.canvas };
const title = mountTitle(
  {
    selectCar: (key) => selectCarNow(key),
    /** The car arrows: step through the garage's models in order, like the circuit arrows. */
    cycleCar: (d) => {
      if (race.busy || settingsLocked() || lobby.snapshot().hosting) return;
      const i = CAR_KEYS.indexOf(playerModel);
      selectCarNow(CAR_KEYS[(i + d + CAR_KEYS.length) % CAR_KEYS.length]);
    },
    prev: () => !settingsLocked() && selectCircuit((activeIndex - 1 + CIRCUITS.length) % CIRCUITS.length),
    next: () => !settingsLocked() && selectCircuit((activeIndex + 1) % CIRCUITS.length),
    pick: (i) => !settingsLocked() && selectCircuit(i),
    setMode: (m) => !online?.session && race.setMode(m),
    setRival: (k) => !online?.session && race.setRival(k),
    setLaps: (n) => !settingsLocked() && race.setLaps(n),
    start: () => beginRace(),
    toggleSound: () => toggleSound(),
    cycleQuality: () => {
      if (settingsLocked()) return;
      trackQuality = QUALITY_ORDER[(QUALITY_ORDER.indexOf(trackQuality) + 1) % QUALITY_ORDER.length];
      applyResolution();
      selectCircuit(activeIndex, { keepPreview: true }); // rebuilds the same circuit at the new detail; the preview keeps lapping
      refreshMenus();
    },
    /** SOLO (time trial), VS AI or ONLINE: one choice, because they exclude each other. */
    setPlay: (m) => {
      if (m === 'online') {
        playMode = 'online';
        lobby.enable();
      } else {
        if (playMode === 'online') lobby.disable();
        playMode = 'local';
        race.setMode(m === 'solo' ? MODE.TT : MODE.VS);
      }
      refreshMenus();
    },
    toggleDay: () => !settingsLocked() && toggleDay(),
    toggleHaunted: () => {
      if (settingsLocked()) return;
      race.setHaunted(!race.haunted);
      refreshMenus();
    },
  },
  (canvas, index, state = 'idle') => drawTile(canvas.getContext('2d'), CIRCUITS[index], state, canvas.width),
  CIRCUITS,
  garageMenu,
);
// Online play: the lobby panel lists open rooms. Local play never opens a connection.
let playMode = 'local'; // 'local' | 'online'
const lobbyUi = mountLobby(
  {
    create: () => lobby.host(roomSettings),
    closeRoom: () => lobby.closeRoom(),
    join: (code) => lobby.join(code),
  },
  // Each room shows its circuit, drawn like the title card's preview. The index comes off the network: checked here.
  (canvas, ci) => {
    const i = Number.isInteger(ci) && ci >= 0 && ci < CIRCUITS.length ? ci : 0;
    drawTile(canvas.getContext('2d'), CIRCUITS[i], 'idle', canvas.width);
  },
);
// Phones: the challenges list sits inside the title card. Wider screens: it floats on the right.
const narrow = window.matchMedia('(max-width: 760px)');
const dockLobby = () => lobbyUi.dock(narrow.matches ? title.lobbySlot : null, title.el);
// The right-hand card is as tall as the main card, so the two read as a symmetric pair.
const titleCard = title.el.querySelector('.card');
new ResizeObserver(() => {
  const cs = getComputedStyle(titleCard);
  const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  lobbyUi.matchHeight(titleCard.offsetHeight - chrome);
}).observe(titleCard);
dockLobby();
narrow.addEventListener('change', dockLobby);
const lobby = createLobby((snap) => {
  lobbyUi.render(snap);
  online.sync(snap);
  refreshMenus();
});
/** What this player has chosen: advertised in the open-challenges list and sent to the guest. */
function roomSettings() {
  return {
    circuit: CIRCUITS[activeIndex].label,
    mode: race.mode,
    rival: race.rivalKey,
    laps: race.laps,
    haunted: race.haunted,
    day: dayMode,
    car: CAR_MODELS[playerModel].name,
    ci: activeIndex,
    scale: Math.round(trackScale * 10) / 10,
  };
}
window.addEventListener('pagehide', () => lobby.leaveAll());
// Free view: the camera orbits the track (right-drag) and zooms (wheel). The track and cars stay put.
const view = { free: false, yaw: 0, pitch: 0.6, dist: 1, dragging: false, pan: false, lastX: 0, lastY: 0, target: new THREE.Vector3() };
const TILT_MIN = 0.02; // near straight down
const TILT_MAX = 1.5; // near the horizon
// Start lights and the chequered flag, on top of the screen.
const signals = mountSignals();
// Race dock: instructions, cameras, sound. Three round buttons in the bottom-right corner.
const dock = mountDock({
  items: [
    { id: 'tv', short: 'TV', label: 'TV CAMERAS', act: () => setCamMode('tv'), isOn: () => camMode === 'tv' },
    { id: 'chase', short: 'CH', label: 'CHASE', act: () => setCamMode('chase'), isOn: () => camMode === 'chase' },
    { id: 'overview', short: 'ALL', label: 'OVERVIEW', act: () => setCamMode('overview'), isOn: () => camMode === 'overview' && presetView < 0 },
    { id: 'free', short: 'FR', label: 'FREE', act: () => setCamMode('free'), isOn: () => camMode === 'free' },
    { sep: true },
    ...VIEW_NAMES.map((name, i) => ({ id: `view${i}`, short: ['BE', 'FL', 'HP', 'BR'][i], label: name, act: () => spectator.flyTo(i), isOn: () => presetView === i })),
    { sep: true },
    { id: 'cockpit', short: 'PiP', label: 'COCKPIT TV', act: () => (cockpitOn = !cockpitOn), isOn: () => cockpitOn },
  ],
  toggleSound: () => toggleSound(),
  isMuted: () => audio.muted,
  exit: () => enterMenu(),
});
const setupBar = mountSetupBar(() => readyToRace(), () => enterMenu());

const deskResults = mountResults({
  again: () => (online.session ? online.rematch() : startRace()), // online: the host restarts both screens
  exit: () => enterMenu(),
});

const race = new RaceController({
  player,
  rival,
  ghost,
  track,
  hazards,
  onChange: () => refreshMenus(),
  onBeep: () => audio.beep(880, 0.12, 0.35),
  onGo: () => audio.beep(1320, 0.45, 0.4),
  onDerail: (who, car) => {
    audio.impact(0.6);
    sparks.emit(car.position, 14, 1);
  },
  onLapDone: (who) => {
    if (who === 'player') player.shieldCharges = SHIELD_CHARGES; // a new lap refills the Shift immunities
    if (previewOn) return; // the title preview laps in silence
    audio.chick(); // lap done: the mechanical chick
    recorder.mark(who === 'player' ? 0 : 1);
  },
  onFinish: (result) => finishRace(result, result.winner === 'rival' ? 1 : 0),
});

race.driver.hazards = hazards; // the AI reads the Haunted zones
hazards.setTrack(track);

// ---------------------------------------------------------------- online 1v1, replay
const recorder = new Recorder();
const replay = new ReplayPlayer(camera);
const replayUi = mountReplayUi(() => stopReplay(true));
let replayWait = 0; // seconds of braking after the line before the replay starts
let pendingResult = null; // { result, winnerIndex } shown after the replay

let online = null;
online = createOnline({
  lobby,
  race,
  player,
  rival,
  audio,
  sparks,
  hazards,
  getTrack: () => track,
  getPhase: () => phase,
  getCfg: roomSettings,
  getModel: () => playerModel,
  validModel: (k) => typeof k === 'string' && CAR_KEYS.includes(k),
  applyCfg: applyRoomCfg,
  swapModels: (hostModel, guestModel) => {
    // Lane 0 is always the host's car and lane 1 the guest's, on both screens.
    swapCarModel(player, hostModel);
    swapCarModel(rival, guestModel);
  },
  ui: {
    toast: (m) => toast(m),
    enterSetup: () => enterSetup(),
    enterRace: () => enterRacePhase(),
    toMenu: (notify = true) => enterMenu(notify),
    setupWaiting: (on) => setupBar.waiting(on),
    startRace: () => startRace(),
    showResult: (r) => finishRace(r, r.winnerIndex),
    hideResult: () => {
      deskResults.hide();
      pendingResult = null;
      stopReplay();
      hazards.reset();
      recorder.clear();
    },
    changed: () => refreshMenus(),
    markLap: (i) => recorder.mark(i),
  },
});
lobby.onGame((name, data) => online.onMessage(name, data));

/** Guest and host adopt the same circuit, size, laps, sky and haunted setting. */
async function applyRoomCfg(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  const ci = Number.isInteger(cfg.ci) && cfg.ci >= 0 && cfg.ci < CIRCUITS.length ? cfg.ci : 0;
  if (!race.busy) {
    if (!!cfg.haunted !== race.haunted) race.setHaunted(!!cfg.haunted);
    if ([1, 3, 5, 8, 10].includes(cfg.laps) && cfg.laps !== race.laps) race.setLaps(cfg.laps);
    if (race.mode !== MODE.VS) race.setMode(MODE.VS);
    if (!!cfg.day !== dayMode) {
      dayMode = !!cfg.day;
      atmos.setDay(dayMode);
    }
  }
  if (ci !== activeIndex) {
    await selectCircuit(ci); // the size is the same 150 % everywhere
  }
  refreshMenus();
}

/** A small message that fades out, for online events. */
const toastEl = document.createElement('div');
Object.assign(toastEl.style, {
  position: 'fixed', left: '50%', top: '18px', transform: 'translate(-50%, -12px)', zIndex: '40', opacity: '0',
  padding: '10px 16px', borderRadius: '10px', font: '600 13px monospace', color: '#f1eaff', pointerEvents: 'none',
  background: 'rgba(12,14,24,0.88)', border: '1px solid rgba(190,140,255,0.45)', transition: 'opacity .25s, transform .25s',
});
document.body.appendChild(toastEl);
let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  toastEl.style.transform = 'translate(-50%, 0)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.opacity = '0';
    toastEl.style.transform = 'translate(-50%, -12px)';
  }, 3200);
}

/**
 * The race is over: let the cars brake for a moment, replay the winner's last lap from the cockpit,
 * then show the results. `winnerIndex` is 0 for the host's car (player) and 1 for the guest's car (rival).
 */
function finishRace(result, winnerIndex) {
  pendingResult = { result, winnerIndex };
  replayWait = REPLAY_DELAY;
}
const REPLAY_DELAY = 2.6; // s between the finish and the replay: the chequered flag is up meanwhile

function showPendingResult() {
  if (!pendingResult) return;
  const { result } = pendingResult;
  pendingResult = null;
  const guest = online.role === 'guest';
  deskResults.show(result, CIRCUITS[activeIndex].label, {
    againDisabled: guest,
    againLabel: guest ? 'WAITING FOR HOST' : online.session ? 'RACE AGAIN' : 'RACE AGAIN',
  });
}

/** The race buttons and panels step aside while the replay plays. */
function setReplayChrome(on) {
  dock.show(on && phase === 'race');
}

function stopReplay(showResults = false) {
  replayWait = 0;
  if (replay.active) {
    replay.stop();
    replayUi.show(false);
    setReplayChrome(true);
    hud.canvas.style.display = phase === 'race' ? 'block' : 'none';
    applyPose(home.pos, home.center);
    chase.init = false; // CHASE glides back in from the overview
    tv.cur = -1; // TV picks its camera again
  }
  if (showResults) showPendingResult();
}

function refreshMenus() {
  const s = {
    index: activeIndex,
    name: CIRCUITS[activeIndex].name,
    scale: Math.round(trackScale * 100),
    mode: race.mode,
    rivalKey: race.rivalKey,
    laps: race.laps,
    busy: race.busy,
    muted: audio.muted,
    day: dayMode,
    haunted: race.haunted,
    quality: trackQuality,
    playerModel,
    rivalsEnabled: race.mode === MODE.VS,
    online: playMode === 'online',
    hosting: !!lobby.snapshot().hosting,
    net: online ? { role: online.role, session: online.session } : null,
  };
  title.refresh(s);
  dock.refresh();
  // The challenges panel sits on the title screen only, in ONLINE mode.
  const lobbyVisible = phase === 'menu' && playMode === 'online';
  lobbyUi.show(lobbyVisible);
  if (lobbyVisible) lobbyUi.render(lobby.snapshot());
}

/** START on the title screen. In an online session the host starts it for both players; otherwise a local race. */
function beginRace() {
  if (race.busy) return;
  if (online.session) {
    if (online.role === 'host') online.hostStart();
    return; // the guest waits for the host
  }
  // Local: straight to the countdown. The view fits itself, so there is no camera setup step.
  audio.ensure();
  rivalModel = pickRivalModel();
  swapCarModel(rival, rivalModel);
  enterRacePhase();
  startRace();
}

/** Online only: both players press READY before the host starts the countdown. */
function enterSetup() {
  stopPreview(false);
  phase = 'setup';
  title.show(false);
  lobbyUi.show(false);
  setupBar.show(true);
  setupBar.waiting(false);
  dock.show(false);
  refreshMenus();
  refit(); // glide to the fitted view for the new screen layout
}

/** Setup -> race. Online, READY waits for both players and the host starts the countdown. */
function readyToRace() {
  if (race.busy) return;
  audio.ensure();
  if (online.ready()) return;
  rivalModel = pickRivalModel();
  swapCarModel(rival, rivalModel);
  enterRacePhase();
  startRace();
}

/** The race screen: HUD, exit button and race controls appear. */
function enterRacePhase() {
  stopPreview(false);
  audio.ensure();
  phase = 'race';
  audio.setMusic(false);
  setupBar.show(false);
  title.show(false);
  lobbyUi.show(false);
  dock.show(true);
  hud.canvas.style.display = 'block';
  recorder.clear();
  refreshMenus();
  placeChrome(); // the buttons are visible now, so their real widths place the panel
  refit(); // the HUD and the gauge are on screen now: fit the track around them
}

// ---------------------------------------------------------------- title preview
// When the circuit choice stays the same for PREVIEW_IDLE seconds, your car laps it on its own (a careful AI throttle)
// and the chase camera follows it. Choosing another circuit, starting a race or going online ends it.
// Browser automation (navigator.webdriver) keeps the still title, so the framing tests see a steady view.
// Esc leaves it for the track outline (until another circuit is chosen); C steps through the race cameras, so the
// player learns them before racing.
const PREVIEW_IDLE = 5;
const PREVIEW_AUTO = !navigator.webdriver;
const PREVIEW_PACE = 0.7; // the preview car runs at 70 % of the careful AI's pace
const PREVIEW_CAMS = [['tv', 'TV CAMERAS'], ['chase', 'CHASE'], ['overview', 'OVERVIEW']];
const previewAi = new AiDriver(track, { ...AI_PROFILES.rookie, top: AI_PROFILES.rookie.top * PREVIEW_PACE, brake: AI_PROFILES.rookie.brake * PREVIEW_PACE, jitter: 0 });
let previewOn = false;
let previewIdle = 0;
let previewSkip = false; // Esc pressed: no preview again until the circuit choice changes
let previewCam = 0; // index in PREVIEW_CAMS
let previewForce = false; // dev hook: run the preview even under automation

const tips = createTips();
loadKenneyModels(import.meta.env.BASE_URL).catch(() => {}); // the ready-made cars load in the background
// Debug label: the camera in use, numbered, bottom centre. Keys still work (C changes camera, Esc leaves the preview).
const camLabel = document.createElement('div');
camLabel.id = 'cam-label';
Object.assign(camLabel.style, { position: 'fixed', left: '50%', bottom: '8px', transform: 'translateX(-50%)', zIndex: '9', display: 'none',
  font: '700 12px monospace', color: '#ffd400', background: 'rgba(5,6,10,0.7)', padding: '3px 8px', borderRadius: '5px', pointerEvents: 'none', whiteSpace: 'nowrap' });
document.body.appendChild(camLabel);
let camLabelText = '';
const CAM_NUMBER = { tv: 1, chase: 2, overview: 3, free: 4 };
const CAM_NAME = { overview: 'OVERVIEW', tv: 'TV CAMERAS', chase: 'CHASE', free: 'FREE' };
/** The camera in use, for the debug label: "CAM 2 TV 5/12", or "PREVIEW CAM 3 CHASE" during the title preview. */
function camInUse() {
  const mode = previewOn ? PREVIEW_CAMS[previewCam][0] : camMode;
  const pre = previewOn ? 'PREVIEW ' : '';
  const tvPart = mode === 'tv' && tv.cams.length ? ` ${Math.max(0, tv.cur) + 1}/${tv.cams.length}` : '';
  return `${pre}CAM ${CAM_NUMBER[mode]} ${CAM_NAME[mode]}${tvPart}`;
}

// Preview camera changes glide: the view blends from where it was to the new camera over PREVIEW_BLEND seconds.
const PREVIEW_BLEND = 1.4;
let previewBlend = null; // { from, fromLook, fromFov, t } while a change is gliding

function blendPreview(dt) {
  if (!previewBlend) return;
  previewBlend.t += dt;
  const k = Math.min(1, previewBlend.t / PREVIEW_BLEND);
  const e = k * k * (3 - 2 * k);
  const pos = previewBlend.from.clone().lerp(rig.position, e);
  const lk = previewBlend.fromLook.clone().lerp(look, e);
  applyPose(pos, lk);
  const target = PREVIEW_CAMS[previewCam][0] === 'tv' ? tv.fov : BASE_FOV;
  setFov(previewBlend.fromFov + (target - previewBlend.fromFov) * e);
  if (k >= 1) previewBlend = null;
}

function setPreviewCam(i) {
  if (previewOn) previewBlend = { from: rig.position.clone(), fromLook: look.clone(), fromFov: camera.fov, t: 0 };
  previewCam = i;
  const [mode] = PREVIEW_CAMS[i];
  tween = null;
  if (mode === 'chase') chase.init = false;
  else if (mode === 'tv') tv.cur = -1;
  else {
    swayT = 0;
    tweenTo(home.pos, home.center, 0.6); // the fitted track outline, with the car lapping it
  }
}
function cyclePreviewCam() {
  if (previewOn) setPreviewCam((previewCam + 1) % PREVIEW_CAMS.length);
}
function startPreview() {
  previewOn = true;
  previewAi.setTrack(track);
  player.resetLane();
  player.placeOnTrack(0);
  setPreviewCam(0);
}
function stopPreview(glide = true) {
  previewIdle = 0;
  if (!previewOn) return;
  previewOn = false;
  setFov(BASE_FOV);
  player.resetLane();
  player.placeOnTrack(0);
  swayT = 0;
  if (glide && phase === 'menu') tweenTo(home.pos, home.center, 0.7);
}
/** Esc: back to the track outline, and no preview again until another circuit is chosen. */
function exitPreview() {
  if (!previewOn) return false;
  previewSkip = true;
  stopPreview();
  return true;
}

/** Race -> menu: cars and telemetry reset, the camera returns to the orbit preview. */
function enterMenu(notify = true) {
  if (notify) online.notifyExit();
  pendingResult = null;
  stopReplay();
  race.reset();
  player.resetLane();
  rival.resetLane();
  player.placeOnTrack(0);
  rival.placeOnTrack(0);
  spectator.cancel();
  deskResults.hide();
  phase = 'menu';
  if (camMode !== DEFAULT_CAM) setCamMode(DEFAULT_CAM, false);
  setupBar.show(false);
  audio.setMusic(true);
  title.show(true);
  dock.show(false);
  hud.canvas.style.display = 'none';
  refreshMenus();
  fitFrame(); // the title card is back: fit the track beside or above it
  layoutSig = layoutSignature();
  swayT = 0;
  tweenTo(home.pos, home.center, 0.9);
}

function startRace() {
  if (race.busy) return;
  audio.ensure();
  pendingResult = null;
  player.shield = 0;
  player.shieldCharges = SHIELD_CHARGES;
  stopReplay();
  recorder.clear();
  race.start();
}

let dayMode = false;
function toggleDay() {
  dayMode = false; // the whole game is dark: there is no day mode
  atmos.setDay(dayMode);
  refreshMenus();
}

function toggleSound() {
  audio.ensure();
  audio.setMuted(!audio.muted);
  refreshMenus();
}

// ---------------------------------------------------------------- mouse and touch
// Hold the left button to throttle (drag up for less). Right or middle drag orbits, the wheel zooms.
const canvas = renderer.domElement;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault(); // middle button pans; stop the browser's autoscroll
});
canvas.addEventListener('pointerdown', (e) => {
  // During setup the left button orbits too, since there is no race to throttle yet.
  const setupDrag = e.button === 0 && phase === 'setup';
  const orbitable = (e.button === 2 || e.button === 1 || setupDrag) && phase !== 'menu';
  if (!orbitable) return;
  if (camMode !== 'free') setCamMode('free'); // a right or middle drag takes the camera
  input.setPointerHeld(false); // a right-drag rotates the view and never touches the throttle
  view.pan = e.button === 1 || e.shiftKey;
  view.dragging = true;
  view.lastX = e.clientX;
  view.lastY = e.clientY;
});
window.addEventListener('pointerup', () => (view.dragging = false));
canvas.addEventListener('wheel', (e) => {
  if (phase === 'menu') return;
  e.preventDefault();
  if (camMode !== 'free') setCamMode('free'); // the wheel zooms the free camera
  const k = 1 + Math.sign(e.deltaY) * 0.08;
  view.dist = Math.min(home.dist * 2.5, Math.max(home.dist * 0.45, view.dist * k));
}, { passive: false });
// Touch: two fingers pinch to zoom and drag to rotate (this switches to free view). One finger still throttles.
const touches = new Map(); // pointerId -> { x, y }
let pinchPrev = null;
function touchGesture() {
  const [a, b] = [...touches.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    input.setPointerHeld(false); // the second finger stops the throttle
    if (camMode !== 'free') setCamMode('free');
    pinchPrev = touchGesture();
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2 && pinchPrev) {
    const g = touchGesture();
    view.yaw -= (g.x - pinchPrev.x) * 0.006;
    view.pitch = Math.min(TILT_MAX, Math.max(TILT_MIN, view.pitch + (g.y - pinchPrev.y) * 0.004));
    if (pinchPrev.d > 0 && g.d > 0) view.dist = Math.min(home.dist * 2.5, Math.max(home.dist * 0.45, view.dist * (pinchPrev.d / g.d)));
    pinchPrev = g;
  }
});
const endTouch = (e) => {
  if (e.pointerType !== 'touch') return;
  touches.delete(e.pointerId);
  if (touches.size < 2) pinchPrev = null;
};
window.addEventListener('pointerup', endTouch);
window.addEventListener('pointercancel', endTouch);

canvas.addEventListener('pointermove', (e) => {
  if (view.dragging && view.pan) {
    const k = view.dist * 0.0016;
    const rx = Math.cos(view.yaw); // camera right vector on the ground plane
    const rz = -Math.sin(view.yaw);
    view.target.x -= (e.clientX - view.lastX) * k * rx;
    view.target.z -= (e.clientX - view.lastX) * k * rz;
    view.target.y += (e.clientY - view.lastY) * k;
    view.lastX = e.clientX;
    view.lastY = e.clientY;
    return;
  }
  if (view.dragging) {
    view.yaw -= (e.clientX - view.lastX) * 0.006;
    view.pitch = Math.min(TILT_MAX, Math.max(TILT_MIN, view.pitch + (e.clientY - view.lastY) * 0.004));
    view.lastX = e.clientX;
    view.lastY = e.clientY;
    return;
  }
  if (input.pointerHeld && !(e.buttons & 1)) input.setPointerHeld(false); // left button released
  if (input.pointerHeld && touches.size < 2) {
    input.setPointerHeld(true, throttleAt(e.clientY));
    return;
  }
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || phase !== 'race') return; // setup: the left drag orbits; the menu has no car to drive
  if (touches.size >= 2) return; // the second finger is a camera gesture
  input.setPointerHeld(true, throttleAt(e.clientY));
});

/**
 * Slide throttle (as on the Mobialia slot racer): one finger or the mouse, anywhere across the screen. The height sets
 * the trigger: nothing in the bottom 15 %, full at 70 % up, linear in between.
 */
const THR_LOW = 0.15;
const THR_HIGH = 0.7;
function throttleAt(clientY) {
  const up = (window.innerHeight - clientY) / window.innerHeight;
  return Math.min(1, Math.max(0, (up - THR_LOW) / (THR_HIGH - THR_LOW)));
}

// Trigger gauge: a vertical bar filled to the throttle, green, then amber and red as your car nears its grip limit.
const trigger = document.createElement('div');
trigger.id = 'trigger';
Object.assign(trigger.style, {
  position: 'fixed', top: '27vh', height: '46vh', width: '22px', borderRadius: '11px', overflow: 'hidden', zIndex: '6',
  background: 'rgba(10,12,20,0.55)', border: '1px solid rgba(255,255,255,0.16)', pointerEvents: 'none', display: 'none',
  boxShadow: '0 0 14px rgba(0,0,0,0.35)',
});
const triggerFill = document.createElement('div');
Object.assign(triggerFill.style, { position: 'absolute', left: '0', right: '0', bottom: '0', height: '0%', background: '#58d68d', borderRadius: '10px' });
const triggerMark = document.createElement('div'); // the grip limit tint at the top of the bar
Object.assign(triggerMark.style, { position: 'absolute', left: '0', right: '0', top: '0', height: '100%', pointerEvents: 'none' });
trigger.append(triggerFill, triggerMark);
document.body.appendChild(trigger);
// Phones: a round camera button just above the gauge, under the same thumb. One tap = the C key (next camera).
const camFlip = document.createElement('button');
camFlip.id = 'camflip';
camFlip.type = 'button';
camFlip.title = 'Next camera (C)';
camFlip.setAttribute('aria-label', 'Next camera');
camFlip.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 8h3l1.6-2h6.8L17 8h3v10H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.2 12.2a3 3 0 0 1 5.3-1.4M14.8 13.8a3 3 0 0 1-5.3 1.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14.9 9.4v1.8h-1.8M9.1 16.6v-1.8h1.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
Object.assign(camFlip.style, {
  position: 'fixed', top: 'calc(27vh - 60px)', width: '48px', height: '48px', borderRadius: '50%', display: 'none', placeItems: 'center',
  padding: '0', cursor: 'pointer', zIndex: '9', color: '#e8e2f5', background: 'rgba(12,14,24,0.72)', border: '1px solid rgba(190,140,255,0.45)',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 4px 16px rgba(0,0,0,0.35)', touchAction: 'manipulation',
});
camFlip.addEventListener('click', () => {
  if (phase === 'race' || phase === 'setup') cycleCam();
});
// A tap here must not count as letting go of the throttle (the gauge listens for pointer-up on the window).
camFlip.addEventListener('pointerup', (e) => e.stopPropagation());
document.body.appendChild(camFlip);

/** Shift (haunted): a 2 s immunity from the hazards, if one of this lap's charges is left and none is running. */
function useShield() {
  if (!race.haunted || race.state !== 'RACING' || replay.active) return;
  if (player.shieldCharges <= 0 || player.shield > 0) return;
  player.shield = SHIELD_TIME;
  player.blinkT = Math.max(player.blinkT, SHIELD_TIME); // the car blinks as it does when it is put back on the track
  player.shieldCharges--;
  shieldHud.querySelector('.num').textContent = String(player.shieldCharges); // show the new count at once
  sparks.emit(player.position, 10, 0.8);
  audio.whoosh(); // the short weez

}
/** I key / locate button: show the arrow over your car for 3 s, or hide it if it is showing. */
function locateCar() {
  if (locator.showing && locateManual) {
    locator.hide();
    return;
  }
  locateManual = true;
  locator.flash(3);
}
// Phones: the locate button sits above the camera button, both over the gauge.
const locBtn = camFlip.cloneNode(false);
locBtn.id = 'locate';
locBtn.title = 'Find your car (I)';
locBtn.setAttribute('aria-label', 'Find your car');
locBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 15l-5-6h3V4h4v5h3z" fill="#ffd400" stroke="#ffd400" stroke-width="1.2" stroke-linejoin="round"/><ellipse cx="12" cy="19" rx="6" ry="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
locBtn.addEventListener('click', () => {
  if (phase === 'race') locateCar();
});
locBtn.addEventListener('pointerup', (e) => e.stopPropagation()); // a tap must not release the throttle
document.body.appendChild(locBtn);

function updateTrigger(throttle, car, show) {
  trigger.style.display = show ? 'block' : 'none';
  camFlip.style.display = show && compactQ.matches ? 'grid' : 'none';
  locBtn.style.display = camFlip.style.display;
  if (!show) return;
  triggerFill.style.height = `${Math.round(throttle * 100)}%`;
  const off = car.state !== 'running';
  const r = car.safeRatio;
  triggerFill.style.background = off || r > 0.95 ? '#ff4d3d' : r > 0.85 ? '#f5a623' : '#58d68d';
  trigger.style.borderColor = off || r > 0.95 ? 'rgba(255,77,61,0.8)' : 'rgba(255,255,255,0.16)';
}

/** Phones (either way up): HUD as a top band, camera panel and buttons at the bottom, the gauge under the right thumb. */
function placeChrome() {
  const compact = compactQ.matches;
  const wide = compact && window.innerWidth > window.innerHeight; // a phone on its side: everything in one top band
  hud.setCompact(compact, wide);
  // Phones: the start lights and the flag go under the HUD band; elsewhere at the top centre.
  const hb = hud.canvas.getBoundingClientRect();
  signals.setTop(compact && hb.height > 0 ? hb.bottom + 10 : 18);
  // Cockpit TVs: bottom-left on wide screens, stacked under the HUD band on phones (the dock owns the bottom right).
  Object.assign(tvRow.style, compact
    ? { left: '8px', bottom: 'auto', top: wide ? '96px' : '112px', flexDirection: 'column' }
    : { left: '12px', bottom: '12px', top: 'auto', flexDirection: 'row' });
  Object.assign(trigger.style, compact ? { right: '10px', left: 'auto' } : { left: '12px', right: 'auto' });
  // Phones: the throttle gauge keeps the right thumb. The round buttons (locate above, camera below) move to the bottom
  // left, stacked above the SHIFT counter, so the left thumb can change the view while the right one accelerates.
  if (compact) {
    const H = window.innerHeight;
    const tTop = Math.max((hb.height > 0 ? hb.bottom : 0) + 12, 0.2 * H);
    Object.assign(trigger.style, { top: `${Math.round(tTop)}px`, height: `${Math.round(Math.max(120, H - tTop - 90))}px` });
    Object.assign(camFlip.style, { top: 'auto', bottom: '98px', left: '12px', right: 'auto' });
    Object.assign(locBtn.style, { top: 'auto', bottom: '154px', left: '12px', right: 'auto' });
  } else {
    Object.assign(trigger.style, { top: '27vh', height: '46vh' });
  }
}
compactQ.addEventListener('change', () => {
  placeChrome();
  refit();
});
window.addEventListener('resize', () => placeChrome()); // turning the phone swaps the band layout

// ---------------------------------------------------------------- car callbacks
for (const c of cars) c.onImpact = (s) => audio.impact(s);

let switchCooldown = 0;
let cycleQueued = 0; // [ and ] keys step to the previous / next circuit
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'BracketRight') cycleQueued = 1;
  else if (e.code === 'BracketLeft') cycleQueued = -1;
  else if (e.code === 'Enter' && phase === 'menu') beginRace(); // races restart from the results card, not a key
  else if (e.code === 'KeyM') toggleSound();
  else if (e.code === 'KeyC' && previewOn) cyclePreviewCam();
  else if (e.code === 'Escape' && previewOn) exitPreview();
  else if (e.code === 'KeyC' && (phase === 'race' || phase === 'setup')) cycleCam();
  else if (e.code === 'KeyI' && phase === 'race') locateCar();
  else if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && phase === 'race') useShield();
  else if (e.code === 'Escape' && (phase === 'race' || phase === 'setup')) {
    if (!dock.closeOverlays()) enterMenu(); // Esc first closes the instructions or the camera menu
  }
});

/** Rebuild the track for circuit `i`, put both cars on the start line and reset the race. */
async function selectCircuit(i, { keepPreview = false } = {}) {
  if (!keepPreview) {
    stopPreview(false); // a new choice: back to the still title, the 5 s count starts again
    previewSkip = false;
  }
  const token = ++loadToken;
  pendingIndex = i;
  refreshMenus();
  const { points } = await loadCircuit(CIRCUITS[i].key, TABLE_Y, trackScale);
  if (token !== loadToken) return; // a newer press superseded this one
  try {
    const next = createTrack({ tableY: TABLE_Y, vmax: CAR.vmax, points, quality: trackQuality });
    prepareTrack(next);
    scene.add(next.group);
    const old = track;
    track = next;
    spectator.setTrack(track, TABLE_Y);
    for (const c of cars) c.setTrack(track);
    ghost.setTrack(track);
    race.setTrack(track);
    hazards.setTrack(track);
    atmos.setTrack(track, TABLE_Y);
    old.dispose();
    activeIndex = i;
    if (previewOn) previewAi.setTrack(track); // the preview keeps lapping the rebuilt circuit
    refit();
    if (window.__slot) window.__slot.track = track;
  } catch {
    // keep the current track if the new geometry could not be built
  }
  pendingIndex = -1;
  refreshMenus();
}

const unlock = () => {
  audio.ensure();
  if (phase === 'menu') audio.setMusic(true); // first gesture starts the title soundtrack
};
window.addEventListener('pointerdown', unlock);

// Menu sounds: buttons click, arrows tick, circuit picks chime, START rises.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (!b || !(b.closest('#title') || b.closest('#chooser') || b.closest('#results'))) return;
  if (b.closest('#chooser')) audio.uiSound('select');
  else if (b.dataset.act === 'prev' || b.dataset.act === 'next' || b.dataset.act === 'smaller' || b.dataset.act === 'bigger') audio.uiSound('tick');
  else if (b.dataset.act === 'start') audio.uiSound('go');
  else audio.uiSound('click');
});
window.addEventListener('keydown', unlock);

// ---------------------------------------------------------------- HUD data
let hudThrottle = 0;
/** "Me" is the host's car (player) except on the guest, where it is the rival car (lane 1). */
function hudData() {
  const guest = online.role === 'guest';
  const me = guest ? 'rival' : 'player';
  const opp = guest ? 'player' : 'rival';
  const meCar = guest ? rival : player;
  const oppCar = guest ? player : rival;
  const st = race.state;
  let status;
  if (st === 'READY') status = 'READY \u00b7 PRESS START';
  else if (st === 'COUNTDOWN') status = `COUNTDOWN ${Math.max(1, Math.ceil(race.countdown))}`;
  else if (st === 'RACING') status = 'RACING';
  else if (race.result.mode === MODE.TT) status = `FINISHED \u00b7 ${race.result.total.toFixed(2)} s`;
  else status = `FINISHED \u00b7 ${race.result.winner === me ? 'YOU WIN' : `${race.rivalName} WINS`}`;
  const vs = race.mode === MODE.VS;
  const lapTime = (who) => (st === 'RACING' ? race.clock - race.lap[who].lapStart : null);
  return {
    circuit: pendingIndex >= 0 ? 'LOADING' : CIRCUITS[activeIndex].label,
    modeLabel: online.session ? `ONLINE \u00b7 ${race.laps} LAPS${race.haunted ? ' \u00b7 HAUNTED' : ''}` : race.modeLabel,
    status,
    lapsTotal: race.laps,
    throttle: hudThrottle,
    muted: audio.muted,
    standing: guest ? online.standing() : race.standing(),
    showRival: vs,
    player: {
      speed: meCar.speed,
      lap: Math.min(race.lap[me].count + 1, race.laps),
      lapTime: lapTime(me),
      bestLap: guest ? race.lap.rival.best : race.personalBest,
      state: meCar.state,
      safeRatio: meCar.state === 'running' ? meCar.safeRatio : 0,
      recovery: meCar.penalty,
    },
    rival: {
      name: race.rivalName,
      speed: vs ? oppCar.speed : 0,
      lap: Math.min(race.lap[opp].count + 1, race.laps),
      lapTime: lapTime(opp),
      bestLap: race.lap[opp].best,
    },
  };
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
placeChrome();
fitFrame();
applyPose(home.pos, home.center);
refreshMenus();

function startReplayNow() {
  setFov(BASE_FOV); // the replay saves and restores the fov: give it the normal one
  const { winnerIndex } = pendingResult;
  const meIndex = online.role === 'guest' ? 1 : 0;
  const who = race.mode === MODE.TT || winnerIndex === meIndex ? 'YOU' : race.rivalName;
  if (replay.start(recorder, winnerIndex)) {
    tween = null;
    spectator.cancel();
    replayUi.show(true, who);
    hud.canvas.style.display = 'none';
    setReplayChrome(false);
  } else {
    showPendingResult();
  }
}

// Test readout: frames per second, bottom left, refreshed twice a second. Remove when done testing.
const fpsEl = document.createElement('div');
fpsEl.id = 'fps-test';
Object.assign(fpsEl.style, { position: 'fixed', left: '8px', bottom: '2px', zIndex: '20', font: '700 11px monospace', color: '#e8e2f5',
  background: 'rgba(5,6,10,0.6)', padding: '2px 6px', borderRadius: '5px', pointerEvents: 'none' });
fpsEl.textContent = '-- fps';
document.body.appendChild(fpsEl);
let fpsFrames = 0;
let fpsSince = performance.now();

renderer.setAnimationLoop(() => {
  fpsFrames++;
  const nowFps = performance.now();
  if (nowFps - fpsSince >= 500) {
    fpsEl.textContent = `${Math.round((fpsFrames * 1000) / (nowFps - fpsSince))} fps`;
    fpsFrames = 0;
    fpsSince = nowFps;
  }
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const now = performance.now() / 1000;
  rig.updateMatrixWorld(true);

  // Layout watcher: when the free part of the screen changes (a panel opens, the phone turns), fit again.
  sigAcc += dt;
  if (sigAcc > 0.25) {
    sigAcc = 0;
    const sig = layoutSignature();
    if (sig !== layoutSig) refit();
  }

  // Camera: a tween between views; on the title a gentle sway that stays fitted; in a race OVERVIEW stays where the
  // fit put it, CHASE follows your car, FREE is orbited by hand.
  let swayOff = null;
  if (!replay.active) {
    if (tween) updateCameraTween(dt);
    else if (phase === 'menu' && previewOn && PREVIEW_CAMS[previewCam][0] === 'chase') {
      chaseStep(dt);
      blendPreview(dt);
    } else if (phase === 'menu' && previewOn && PREVIEW_CAMS[previewCam][0] === 'tv') {
      tvStep(dt);
      blendPreview(dt);
    } else if (phase === 'menu') {
      swayT += dt * 0.25;
      const f = swayFit(SWAY * Math.sin(swayT));
      applyPose(f.pos, home.center);
      swayOff = [f.offX, f.offY];
    } else if (camMode === 'free') {
      const cp = Math.cos(view.pitch);
      applyPose(
        _orbitPos.set(Math.sin(view.yaw) * cp, Math.sin(view.pitch), Math.cos(view.yaw) * cp)
          .multiplyScalar(view.dist)
          .add(view.target),
        view.target,
      );
    } else if (camMode === 'chase' && phase === 'race') {
      chaseStep(dt);
    } else if (camMode === 'tv' && phase === 'race') {
      tvStep(dt);
    }
  }
  [off.tx, off.ty] = offsetTarget(swayOff);
  applyOffset(dt, replay.active);

  const state = input.update(dt);
  hudThrottle = state.throttle;
  if (phase === 'menu') {
    garagePreview.update(dt, renderer);
  }

  // Reset: keyboard R or gamepad B.
  if (state.padStart) (phase === 'menu' ? beginRace() : phase === 'setup' ? readyToRace() : null);
  if (state.padSound) toggleSound();

  // Circuit keys (title screen only; a guest follows the host's choice).
  switchCooldown = Math.max(0, switchCooldown - dt);
  const cycled = cycleQueued;
  cycleQueued = 0;
  let pick = -1;
  if (phase === 'menu' && !settingsLocked()) {
    if (cycled !== 0) pick = (activeIndex + cycled + CIRCUITS.length) % CIRCUITS.length;
    else if (switchCooldown === 0 && state.circuitIndex >= 0 && state.circuitIndex < CIRCUITS.length) pick = state.circuitIndex;
  }
  if (pick >= 0) {
    switchCooldown = 0.4;
    if (pick !== activeIndex || pendingIndex >= 0) selectCircuit(pick);
  }

  // Simulation. Host and local play run the race; a guest mirrors the host and drives its own car.
  const guest = online.role === 'guest';
  const meCar = guest ? rival : player;
  const oppCar = guest ? player : rival;
  if (guest && phase === 'race') {
    online.guestBefore(dt, now);
    const mine = race.state === 'RACING' ? state.throttle : 0;
    rival.update(dt, mine);
    online.guestAfter(dt, now, mine);
    player.updateLights(Math.min(1, player.speed / (CAR.vmax * player.spec.vmax)));
    rival.updateLights(state.throttle);
  } else if (guest) {
    rival.update(dt, 0);
  } else {
    // Race state machine decides throttles; the cars run the same physics either way.
    const th = race.throttles(dt, state.throttle);
    // Title preview: count the seconds the choice has stayed put, then let the car lap on its own.
    if (phase === 'menu' && pendingIndex < 0 && !online.session && !previewSkip && (PREVIEW_AUTO || previewForce)) {
      previewIdle += dt;
      if (!previewOn && previewIdle >= PREVIEW_IDLE) startPreview();
      if (previewOn && player.state !== 'running') stopPreview(); // never expected (the AI keeps under the limit)
    } else if (previewOn && phase !== 'menu') stopPreview(); // the title preview ends only when leaving the title
    player.update(dt, previewOn ? previewAi.throttle(player, dt) : th.player);
    if (race.mode === MODE.VS) rival.update(dt, th.rival);
    player.updateLights(state.throttle);
    if (race.mode === MODE.VS) rival.updateLights(th.rival);
    if (online.role === 'host') online.hostFrame(now, phase === 'race');
  }

  // Replay: record while racing and for the braking moment after the line, then fly the winner's cockpit.
  if (phase === 'race' && (race.state === 'RACING' || (pendingResult && replayWait > 0))) recorder.tick(dt, [player, rival]);
  if (pendingResult && replayWait > 0 && !replay.active) {
    replayWait -= dt;
    if (replayWait <= 0) startReplayNow();
  }

  // Friction sparks when a car runs close to its grip limit.
  for (const car of race.mode === MODE.VS ? cars : [player]) {
    if (car.state === 'running' && car.safeRatio > 0.9 && car.speed > 0.15 && Math.random() < 0.6) {
      sparks.emit(car.position, 2, 0.6);
    }
  }
  sparks.update(dt);
  if (!atmos.haunted) atmos.setHaunted(true); // the dark scenery (sky, storm, grass, graveyards) is the look of every mode
  if (atmos.day !== race.haunted) atmos.setDay(race.haunted); // haunted: the colder day palette, still dark; vanilla: the night palette
  audio.setMusicTheme(race.haunted); // the spooky soundtrack whenever haunted mode is selected
  atmos.quakeOn = phase === 'race' && !replay.active && race.haunted; // earthquakes are a haunted thing // earthquakes only shake a race, never the title screen
  atmos.update(dt);

  // Tire squeal: the player's own car, ramping up as it nears its derail limit.
  const squeal = meCar.state === 'running' ? (meCar.safeRatio - 0.88) / 0.12 : 0;
  audio.setSqueal(replay.active ? 0 : squeal);

  audio.setEngine(phase === 'race' && !replay.active);
  audio.update(dt, {
    vmax: CAR.vmax,
    player: { speed: meCar.speed, throttle: state.throttle, running: meCar.state === 'running' },
    rival: { speed: race.mode === MODE.VS ? oppCar.speed : 0 },
  });

  if (!replay.active) hud.update(dt, hudData());
  signals.update(
    dt,
    phase === 'race' && !replay.active ? race.state : null,
    race.countdown,
    () => {
      const r = race.result;
      if (!r) return 'FINISH';
      if (r.mode === MODE.TT) return `FINISH \u00b7 ${r.total.toFixed(2)} s`;
      return r.winner === (isGuest() ? 'rival' : 'player') ? 'YOU WIN' : `${race.rivalName} WINS`;
    },
    () => !!race.result && (race.result.mode === MODE.TT || race.result.winner === (isGuest() ? 'rival' : 'player')),
  );
  updateTrigger(hudThrottle, meCar, phase === 'race' && !replay.active);

  spectator.update(dt);

  // Haunted hazards: the kaiju, the spirit beam and the blade. The guest runs them for show; the host decides the hits.
  const hazardCars = race.mode === MODE.VS ? cars : [player];
  const shake = hazards.update(dt, race.state === 'RACING' && race.haunted, hazardCars);
  if (!replay.active) camera.position.copy(shake);
  // Storm earthquake: the camera shudders and the graveyard and forest tremble (cosmetic: no car is affected).
  const quake = atmos.quake * QUAKE_MOTION;
  if (!replay.active && quake > 0) {
    camera.position.x += (Math.random() - 0.5) * 0.03 * quake;
    camera.position.y += (Math.random() - 0.5) * 0.02 * quake;
    camera.position.z += (Math.random() - 0.5) * 0.03 * quake;
  }
  hazards.tremor(quake);

  // Find-your-car arrow: through the countdown and 3 s after GO, or when asked for (I / locate button).
  const rs = phase === 'race' ? race.state : '';
  if (rs === 'COUNTDOWN') locator.flash(0.3);
  if (rs === 'RACING' && lastRaceState === 'COUNTDOWN') locator.flash(3);
  lastRaceState = rs;
  if (!locator.showing) locateManual = false;
  locator.update(dt, meCar, camera, phase === 'race' && !replay.active && (camMode !== 'chase' || locateManual));
  tips.update(dt, previewOn, race.haunted, safeArea, phase !== 'menu' && phase !== 'setup');  // insert-coin tips over the idle preview

  // Shift immunity: the violet ring under the car and the charges on screen (haunted races only).
  const shieldOn = phase === 'race' && !replay.active && race.haunted;
  const shielding = shieldOn && player.shield > 0;
  shieldRing.visible = shielding;
  if (shielding) {
    shieldRing.position.set(player.position.x, player.position.y + 0.012, player.position.z);
    shieldRing.scale.setScalar(1 + 0.12 * Math.sin(now * 14));
  }
  const camShown = phase === 'race' || phase === 'setup' || previewOn;
  camLabel.style.display = camShown ? 'block' : 'none';
  if (camShown) {
    const t = camInUse();
    if (t !== camLabelText) {
      camLabelText = t;
      camLabel.textContent = t;
    }
  }
  shieldHud.style.display = shieldOn ? 'block' : 'none';
  // Phones: the two round buttons sit just above the FPS readout, or above the SHIFT counter in a haunted race.
  if (compactQ.matches) {
    const low = shieldOn ? 98 : 26;
    camFlip.style.bottom = `${low}px`;
    locBtn.style.bottom = `${low + 56}px`;
  }
  if (shieldOn) {
    const pips = [0, 1, 2].map((i) => (i < player.shieldCharges ? '\u25c6' : '\u25c7')).join(' ');
    shieldHud.querySelector('.num').textContent = String(player.shieldCharges);
    shieldHud.querySelector('.pips').textContent = pips + (shielding ? `  ${player.shield.toFixed(1)} s` : '');
  }

  // Cockpit TVs: race-only, refreshed at 30 Hz to keep the extra renders cheap.
  const tvOn = cockpitOn && phase === 'race' && !replay.active;
  tvRow.style.display = tvOn ? 'flex' : 'none';
  tvPlayer.show(tvOn);
  tvRival.show(tvOn && race.mode === MODE.VS);
  if (tvOn) {
    tvAcc += dt;
    if (tvAcc >= 1 / 30) {
      tvAcc = 0;
      tvPlayer.update(renderer, scene, meCar);
      if (race.mode === MODE.VS) tvRival.update(renderer, scene, oppCar);
    }
  }

  // The replay poses the cars and the camera last, so nothing above can override it.
  if (replay.active) {
    const r = replay.update(dt, [player, rival], rig);
    replayUi.update(replay.progress, r.speed);
    if (r.done) stopReplay(true);
  }

  // A guest that stops hearing from the host during a race gives up after a few seconds.
  if (guest && phase === 'race' && online.lastSnapAge > 6) {
    toast('Lost connection to the host.');
    lobby.leaveRoom();
  }

  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- UI chrome
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  refit(true);
  [off.tx, off.ty] = offsetTarget(phase === 'menu' ? [home.offX, home.offY] : null);
  applyOffset(0, true);
});

if (import.meta.env.DEV) {
  window.__slot = {
    player, rival, ghost, track, race, sparks, audio, renderer, selectCircuit, camera, spectator,
    getActive: () => activeIndex, startRace, beginRace, enterMenu, toggleSound, input, online, lobby, recorder, replay,
    aiProfiles: AI_PROFILES, getPhase: () => phase, home, three: THREE, hazards, atmos,
    getCamMode: () => camMode, locator, chaseStep, preview: (on) => { previewForce = on; if (!on) stopPreview(); }, isPreview: () => previewOn, previewCam: () => PREVIEW_CAMS[previewCam][0], tvStep, tv, rig, throttleAt, view, setCamMode,
    getRefits: () => refitCount, layoutSignature,
    /** True when no camera glide or viewpoint flight is under way (the view shows its final framing). */
    cameraIdle: () => !tween && !spectator.moving && pendingIndex < 0 && Math.abs(off.tx - off.x) < 1 && Math.abs(off.ty - off.y) < 1,
    /** Where the track lands on screen, against the free area the UI leaves. */
    frameStats() {
      camera.updateMatrixWorld(true);
      const W = window.innerWidth;
      const H = window.innerHeight;
      const safe = safeArea();
      const pts = sampleTrack(track.curve, DECK_HALF, 96);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, outSafe = 0, outView = 0;
      const v = new THREE.Vector3();
      for (const p of pts) {
        v.copy(p).project(camera);
        const sx = ((v.x + 1) / 2) * W;
        const sy = ((1 - v.y) / 2) * H;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        if (sx < 0 || sx > W || sy < 0 || sy > H || v.z > 1) outView++;
        if (sx < safe.x - 1 || sx > safe.x + safe.w + 1 || sy < safe.y - 1 || sy > safe.y + safe.h + 1) outSafe++;
      }
      const fx = (x1 - x0) / safe.w;
      const fy = (y1 - y0) / safe.h;
      return { phase, W, H, box: { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) },
        safe: { x: Math.round(safe.x), y: Math.round(safe.y), w: Math.round(safe.w), h: Math.round(safe.h) },
        fillX: +fx.toFixed(3), fillY: +fy.toFixed(3), fill: +Math.max(fx, fy).toFixed(3), outSafe, outView, n: pts.length,
        obstacles: obstacleRects().map((o) => o.id) };
    },
  };
}
