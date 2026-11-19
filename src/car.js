import * as THREE from 'three';
import { buildCarModel, CAR_MODELS } from './cars.js';
import { LANE_OFFSETS } from './track.js';

export const CAR = { vmax: 1.6, grabRadius: 0.08, gravity: 9.81 };
export const PENALTY = 1.5; // seconds a de-slotted car waits before it is placed back on the slot

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

const rand = (s) => (Math.random() - 0.5) * 2 * s;

/**
 * A slot car. While `running` it is a pure function of `u` on the spline. When it derails it
 * becomes a tiny ballistic body and waits PENALTY seconds before it is placed back on the slot.
 * While `held` it follows a hand or controller ray. Player and AI rivals use the same physics.
 */
export class Car {
  /**
   * @param {ReturnType<import('./track.js').createTrack>} track
   * @param {{ lane: number, color: number, world: { tableY: number, hx: number, hz: number } }} o
   */
  constructor(track, { lane, color, world, model = 'formula' }) {
    this.track = track;
    this.lane = lane;
    this.homeLane = lane; // the lane the car starts every race in
    this.offset = LANE_OFFSETS[lane]; // sideways position now (m); between the lanes while changing lane
    this.swap = null; // { from, to, toLane, t, dur } while a lane change is under way
    this.world = world;
    this.t = 0;
    this._setBuild(model, color);
    this.state = 'running'; // 'running' | 'derailed' | 'held'
    this.u = 0;
    this.speed = 0;
    this.safeRatio = 0; // speed / maxSafeSpeed at the current position
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.floorTime = 0;
    this.penalty = 0; // seconds left before a derailed car is placed back on the slot
    this.derailU = 0; // slot position where the car left the track, used for recovery
    this.lightBoost = 1; // LED and glow multiplier, set by the atmosphere
    this.hazardGrip = 1; // corner grip multiplier from Haunted hazards (poltergeist beam)
    this.lift = 0; // chassis lift from the phantom beam (m)
    this.webbed = false; // caught in a spider web
    this.webBreak = 0; // seconds of full throttle towards breaking free
    this.boostT = 0; // spectral boost time left
    this.batT = 0; // seconds left inside a bat swarm (half speed)
    this.shield = 0; // Shift immunity (haunted): seconds left in which hazards cannot hit this car
    this.shieldCharges = 0; // Shift immunities left this lap
    this.wobble = 0; // jolt wobble amount
    this.blinkT = 0; // invulnerability blink time left
    this.isPlayerCar = false;
    this.kinematic = false; // online opponent: pose comes from the network, monsters and physics must not touch it
    this.ghost = false;
    this.onLap = null;
    this.onDerail = null;
    this.onImpact = null;
    this.placeOnTrack(0);
  }

  /** Handling profile and model of this car. */
  get model() {
    return this.modelKey;
  }

  _setBuild(key, color) {
    const built = buildCarModel(key, color ?? CAR_MODELS[key].color);
    this.modelKey = key;
    this.spec = CAR_MODELS[key].spec;
    this.mesh = built.group;
    this.lights = built.lights;
    this.beacon = built.beacon;
    this.lightBoost = this.lightBoost ?? 1;
  }

  /**
   * Swap the model in place. The caller re-adds `mesh` to the scene, since the group changes.
   * @returns {THREE.Group} the previous group, so the caller can remove it
   */
  setModel(key, color) {
    const old = this.mesh;
    const keep = { pos: old.position.clone(), quat: old.quaternion.clone(), scale: old.scale.clone() };
    this._setBuild(key, color);
    this.mesh.position.copy(keep.pos);
    this.mesh.quaternion.copy(keep.quat);
    this.mesh.scale.copy(keep.scale);
    return old;
  }

  get position() {
    return this.mesh.position;
  }

  /** Move to a freshly built track and sit on the start line of this car's lane. */
  setTrack(track) {
    this.track = track;
    this.resetLane();
    this.placeOnTrack(0);
  }

  placeOnTrack(u) {
    this.u = ((u % 1) + 1) % 1;
    this.state = 'running';
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.floorTime = 0;
    this.penalty = 0;
    this.batT = 0;
    this.track.frameAt(this.u, this.offset, this.mesh.position, this.mesh.quaternion);
  }

  /** Back to its own lane for a new race. */
  resetLane() {
    this.lane = this.homeLane;
    this.offset = LANE_OFFSETS[this.lane];
    this.swap = null;
  }

  /** Haunted portal: slide across to the other lane over `dur` seconds. */
  /** Slide to the other lane over `dur` seconds, or, when `dist` is given, over that many metres of track (so the car
   *  follows a crossover drawn on the deck at any speed). */
  startSwap(dur = 0.45, dist = 0) {
    if (this.swap || this.kinematic) return false;
    const toLane = 1 - this.lane;
    this.swap = { from: this.offset, to: LANE_OFFSETS[toLane], toLane, t: 0, dur, dist };
    return true;
  }

  _stepSwap(dt, force = false) {
    const s = this.swap;
    if (!s) return;
    s.t += s.dist ? Math.abs(this.speed) * dt : dt;
    const k = force ? 1 : Math.min(1, s.t / (s.dist || s.dur));
    const e = k * k * (3 - 2 * k);
    this.offset = s.from + (s.to - s.from) * e;
    if (k >= 1) {
      this.offset = s.to;
      this.lane = s.toLane;
      this.swap = null;
    }
  }

  /** Put the car back in the slot: nearest slot point if loose, start line if already running. */
  reset() {
    if (this.state === 'running') {
      this.placeOnTrack(0);
    } else {
      this.placeOnTrack(this.track.nearestU(this.mesh.position, this.lane).u);
    }
  }

  /** Light intensity follows throttle; the tail brightens while the car is slowing. */
  updateLights(throttle) {
    const on = this.state === 'running' ? 1 : 0.35;
    const k = this.lightBoost; // set by the atmosphere: strong at night, off in daylight
    // The open-wheel F1 rain light flashes; the other cars keep steady tail lights.
    const flash = this.modelKey === 'formula' ? (Math.sin(this.t * 9) > 0 ? 1 : 0.25) : 1;
    const tail = (0.25 + 1.4 * throttle) * on * k * flash;
    if (this.beacon) this.beacon.material.emissiveIntensity = 1.4 * k * (Math.sin(this.t * 10) > 0 ? 1 : 0.05);
    for (const l of this.lights.tail) {
      l.mat.emissiveIntensity = tail;
      l.halo.material.opacity = Math.min(1, (0.2 + 0.6 * throttle) * on * k * flash);
    }
    for (const l of this.lights.head) {
      l.mat.emissiveIntensity = 0.9 * on * k;
      l.halo.material.opacity = Math.min(1, 0.45 * on * k);
    }
  }

  /** Ghost: a translucent copy of the car with its own materials, no lights, no physics. */
  makeGhost(color = 0x9fd8ff) {
    this.ghost = true;
    this.mesh.traverse((o) => {
      if (o.isSprite) o.visible = false;
      if (o.isMesh) {
        const mat = o.material.clone();
        mat.transparent = true;
        mat.opacity = 0.28;
        mat.depthWrite = false;
        if (mat.color) mat.color.setHex(color);
        o.material = mat;
      }
    });
    for (const l of [...this.lights.head, ...this.lights.tail]) l.mesh.visible = false;
  }

  update(dt, throttle) {
    this.t += dt;
    if (this.shield > 0) this.shield = Math.max(0, this.shield - dt);
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      this.mesh.visible = Math.floor(this.t * 12) % 2 === 0; // invulnerable blink after a recovery
      if (this.blinkT <= 0) this.mesh.visible = true;
    }
    if (this.state === 'running') this._run(dt, throttle);
    else if (this.state === 'derailed') this._fall(dt);
  }

  /** Monster knock: a speed spike and a wobble. */
  jolt(dv) {
    if (this.kinematic) return;
    this.speed = Math.min(CAR.vmax * this.spec.vmax * 1.2, this.speed + dv);
    this.wobble = 1;
  }

  /** Spectral boost: a short top-speed surge after a near miss. */
  boost(seconds) {
    if (this.kinematic) return;
    this.boostT = Math.max(this.boostT, seconds);
  }

  _run(dt, throttle) {
    // Monster effects on the drive: a boost raises top speed, a web caps it until the car breaks free,
    // a phantom lift surges the throttle response.
    if (this.boostT > 0) this.boostT -= dt;
    let vmax = this.spec.vmax * (this.boostT > 0 ? 1.3 : 1);
    if (this.batT > 0) {
      this.batT -= dt;
      vmax *= 0.5; // a bat swarm: the car crawls until it lets go
    }
    if (this.webbed) {
      vmax *= 0.35; // the web drags hard...
      if (throttle > 0.9) this.webBreak += dt; // ...until full throttle is held long enough to break free
      else this.webBreak = Math.max(0, this.webBreak - dt);
      if (this.webBreak > 0.8) {
        this.webbed = false;
        this.webBreak = 0;
      }
    }
    const target = throttle * CAR.vmax * vmax;
    let k = throttle < 0.04 ? 3.4 : target > this.speed ? 1.8 * this.spec.accel : 2.8; // brake / accelerate / lift
    if (this.lift > 0) k *= 2; // a phantom lift surges the throttle response
    this.speed += (target - this.speed) * (1 - Math.exp(-k * dt));
    const next = this.u + (this.speed * dt) / this.track.length;
    if (next >= 1 && this.onLap) this.onLap();
    this.u = next % 1;
    this._stepSwap(dt);
    this.track.frameAt(this.u, this.offset, this.mesh.position, this.mesh.quaternion);
    // Visual feedback: the lift raises the chassis, and a jolt makes it wobble.
    this.mesh.position.y += this.lift;
    if (this.wobble > 0) {
      this.wobble = Math.max(0, this.wobble - dt * 2.5);
      this.mesh.rotateZ(this.wobble * 0.35 * Math.sin(this.t * 38));
    }

    const safe = this.track.safeSpeedAt(this.u) * this.spec.grip * this.hazardGrip; // grip sets the derail threshold
    this.safeRatio = this.speed / safe;
    if (this.speed > safe) this._derail();
  }

  /** `hazard`: a haunted hazard's hit, which a Shift immunity blocks. The car's own overspeed crash is never blocked. */
  _derail(hazard = false) {
    if (hazard && this.shield > 0) return;
    if (this.kinematic) return;
    this._stepSwap(0, true); // a lane change in progress finishes: the car comes back in its new lane
    const T = _a;
    this.track.tangentAt(this.u, T);
    const out = _b;
    this.track.tangentAt(this.u + 0.004, out).sub(T); // points to the inside of the bend
    out.y = 0;
    if (out.lengthSq() < 1e-10) out.set(-T.z, 0, T.x);
    out.normalize().negate(); // centrifugal direction
    this.vel.copy(T).multiplyScalar(this.speed).addScaledVector(out, this.speed * 0.4);
    this.vel.y += 0.5;
    this.angVel.set(rand(14), rand(8), rand(14));
    this.state = 'derailed';
    this.floorTime = 0;
    this.speed = 0;
    this.penalty = PENALTY;
    this.derailU = this.u;
    if (this.onDerail) this.onDerail();
  }

  _fall(dt) {
    const w = this.world;
    const p = this.mesh.position;
    this.vel.y -= CAR.gravity * dt;
    p.addScaledVector(this.vel, dt);

    const onTable = Math.abs(p.x) < w.hx && Math.abs(p.z) < w.hz;
    // Over the green grass a derailed car lands on it instead of falling into the empty space beyond.
    const onGrass = !onTable && w.onGrass && w.onGrass(p.x, p.z);
    const ground = onTable ? w.tableY : onGrass ? w.tableY - 0.0015 : 0;
    let contact = false;
    if (p.y <= ground) {
      contact = true;
      p.y = ground;
      if (this.vel.y < -0.35 && this.onImpact) this.onImpact(Math.min(1, -this.vel.y / 3));
      this.vel.y = this.vel.y < -0.3 ? -this.vel.y * 0.3 : 0;
      const f = Math.exp(-5 * dt);
      this.vel.x *= f;
      this.vel.z *= f;
    }
    this.angVel.multiplyScalar(Math.exp(-(contact ? 4 : 0.3) * dt));
    const ang = this.angVel.length();
    if (ang > 1e-4) {
      _q.setFromAxisAngle(_v.copy(this.angVel).divideScalar(ang), ang * dt);
      this.mesh.quaternion.premultiply(_q).normalize();
    }
    if (contact && Math.hypot(this.vel.x, this.vel.z) < 0.4) this._uprighten(dt, 8);

    // Recovery penalty: the car is placed back on the nearest slot point when it runs out.
    if (this.penalty > 0) {
      this.penalty -= dt;
      if (this.penalty <= 0) {
        this.placeOnTrack(this.derailU); // back onto the slot where it left
        this.blinkT = 1.2; // invulnerable for a moment, and it blinks
      }
    }

    if (p.y <= 0.001) {
      this.floorTime += dt;
      if (this.floorTime > 2.5) this.reset(); // fell off the table: auto-recover
    } else {
      this.floorTime = 0;
    }
  }

  _uprighten(dt, rate) {
    _v.copy(FWD).applyQuaternion(this.mesh.quaternion);
    _q2.setFromAxisAngle(UP, Math.atan2(-_v.x, -_v.z));
    this.mesh.quaternion.slerp(_q2, 1 - Math.exp(-rate * dt));
  }

  grab() {
    this.state = 'held';
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.speed = 0;
  }

  holdAt(target, dt) {
    const p = this.mesh.position;
    _a.copy(p);
    p.lerp(target, 1 - Math.exp(-28 * dt));
    if (dt > 0) this.vel.lerp(_b.copy(p).sub(_a).divideScalar(dt), 0.5);
    this._uprighten(dt, 10);
  }

  /** @returns {boolean} true when the car was snapped back into its slot. */
  release() {
    const hit = this.track.nearestU(this.mesh.position, this.lane);
    if (hit.dist < 0.14) {
      this.placeOnTrack(hit.u);
      return true;
    }
    this.state = 'derailed';
    this.floorTime = 0;
    this.penalty = PENALTY;
    this.derailU = this.track.nearestU(this.mesh.position, this.lane).u;
    if (this.vel.length() > 3) this.vel.setLength(3);
    this.angVel.set(rand(4), rand(4), rand(4));
    return false;
  }
}
