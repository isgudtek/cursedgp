/**
 * Race sync maths for the 1v1 online mode. No THREE and no network here, so it can run under Node tests.
 *
 * Model: the host runs the race and publishes a snapshot SNAP_HZ times a second. The guest
 *  - draws the host's car from a short interpolation buffer (a little in the past, always smooth), and
 *  - drives its own car locally (zero input lag) and pulls it toward the host's authoritative state.
 */

export const NET = {
  SNAP_HZ: 15, // host -> guest snapshots per second
  THR_HZ: 15, // guest -> host throttle messages per second (also sent on a change)
  INTERP_DELAY: 0.12, // s: the opponent is drawn this far behind the newest snapshot
  MAX_EXTRAP: 0.3, // s: longest dead-reckoning past the newest snapshot
  SNAP_METRES: 0.35, // own car further than this from the host's state is moved there at once
  BLEND_RATE: 7, // 1/s: how fast the own car converges on the host's state
};

export const RACE_CODE = { READY: 0, COUNTDOWN: 1, RACING: 2, FINISHED: 3 };
export const RACE_NAME = ['READY', 'COUNTDOWN', 'RACING', 'FINISHED'];
export const CAR_CODE = { running: 0, derailed: 1, held: 2 };
export const CAR_NAME = ['running', 'derailed', 'held'];

/** Signed shortest difference b - a on the 0..1 ring. */
export function wrapDelta(a, b) {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

const r4 = (n) => Math.round(n * 10000) / 10000;
const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Pack one car for the wire: [u, speed, state, penalty, safeRatio, flags, lateral offset, ...pose when off the slot].
 * flags: 1 webbed, 2 boost, 4 blinking, 8 in lane 1 (a haunted portal can swap the lanes).
 */
export function packCar(c) {
  const flags = (c.webbed ? 1 : 0) | (c.boostT > 0 ? 2 : 0) | (c.blinkT > 0 ? 4 : 0) | (c.lane === 1 ? 8 : 0);
  const a = [r4(c.u), r3(c.speed), CAR_CODE[c.state] ?? 0, r3(c.penalty), r3(c.safeRatio), flags, r4(c.offset ?? 0)];
  if (c.state !== 'running') a.push(r4(c.px), r4(c.py), r4(c.pz), r4(c.qx), r4(c.qy), r4(c.qz), r4(c.qw));
  return a;
}

/** Inverse of packCar. Returns null for anything malformed, because the data comes off the network. */
export function unpackCar(a) {
  if (!Array.isArray(a) || a.length < 7) return null;
  for (let i = 0; i < a.length; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return null;
  const st = a[2] | 0;
  if (st < 0 || st > 2) return null;
  const car = {
    u: ((a[0] % 1) + 1) % 1,
    speed: Math.max(0, Math.min(5, a[1])),
    st,
    pen: Math.max(0, Math.min(5, a[3])),
    safe: Math.max(0, Math.min(5, a[4])),
    flags: a[5] | 0,
    lat: Math.max(-0.05, Math.min(0.05, a[6])),
    lane: a[5] & 8 ? 1 : 0,
    pos: null,
    quat: null,
  };
  if (st !== 0) {
    if (a.length < 14) return null;
    car.pos = [a[7], a[8], a[9]];
    car.quat = [a[10], a[11], a[12], a[13]];
  }
  return car;
}

/** Validates and unpacks a whole snapshot. Returns null when it is not usable. */
export function readSnapshot(d, localNow) {
  if (!d || typeof d !== 'object') return null;
  const nums = [d.q, d.ht, d.s, d.cd, d.ck, d.el];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  if (d.s < 0 || d.s > 3 || !Array.isArray(d.c) || d.c.length !== 2 || !Array.isArray(d.lp) || d.lp.length !== 2) return null;
  const c0 = unpackCar(d.c[0]);
  const c1 = unpackCar(d.c[1]);
  if (!c0 || !c1) return null;
  const lap = (l) => {
    if (!Array.isArray(l) || l.length < 4) return null;
    return { count: Math.max(0, Math.min(99, l[0] | 0)), lapStart: Number(l[1]) || 0, best: l[2] < 0 ? null : Number(l[2]), valid: !!l[3] };
  };
  const l0 = lap(d.lp[0]);
  const l1 = lap(d.lp[1]);
  if (!l0 || !l1) return null;
  let res = null;
  if (d.res && typeof d.res === 'object') {
    res = {
      winner: d.res.w === 'rival' ? 'rival' : 'player',
      total: Number(d.res.t) || 0,
      pBest: d.res.pb == null || d.res.pb < 0 ? null : Number(d.res.pb),
      rBest: d.res.rb == null || d.res.rb < 0 ? null : Number(d.res.rb),
      laps: Number(d.res.l) === 5 ? 5 : 3,
    };
  }
  return {
    q: d.q,
    ht: d.ht,
    state: d.s | 0,
    countdown: d.cd,
    clock: d.ck,
    elapsed: d.el,
    cars: [c0, c1],
    laps: [l0, l1],
    ack: typeof d.ack === 'number' ? d.ack : null, // guest's own send time echoed back
    hold: typeof d.hold === 'number' ? d.hold : 0, // seconds the host held that message before replying
    res,
    mon: d.mon && typeof d.mon === 'object' ? d.mon : null, // monster events; Monsters.importState validates them
    recv: localNow,
  };
}

/**
 * Interpolation buffer for the opponent's car. `ht` is the host clock in seconds. The offset between the
 * two clocks follows the lowest latency seen, so network jitter does not move the playback point.
 */
export class SnapBuffer {
  constructor(delay = NET.INTERP_DELAY) {
    this.delay = delay;
    this.snaps = [];
    this.offset = null;
    this.lastQ = -1;
  }

  clear() {
    this.snaps.length = 0;
    this.offset = null;
    this.lastQ = -1;
  }

  /** @returns {boolean} false for stale or duplicate snapshots */
  push(snap) {
    if (snap.q <= this.lastQ && this.lastQ - snap.q < 1000) return false; // out of order or repeated
    this.lastQ = snap.q;
    const raw = snap.recv - snap.ht;
    if (this.offset === null || raw < this.offset) this.offset = raw;
    else this.offset += (raw - this.offset) * 0.02;
    this.snaps.push(snap);
    while (this.snaps.length > 30) this.snaps.shift();
    return true;
  }

  get latest() {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  /**
   * State of car `i` (0 host, 1 guest) at local time `now`, in the past by `delay`.
   * @returns {{ u:number, speed:number, st:number, pen:number, safe:number, flags:number, pos:number[]|null, quat:number[]|null, extrapolated:boolean }|null}
   */
  sample(i, now, trackLength) {
    const n = this.snaps.length;
    if (!n) return null;
    const t = now - this.offset - this.delay; // host time to show
    const first = this.snaps[0];
    const last = this.snaps[n - 1];
    if (t <= first.ht) return { ...first.cars[i], extrapolated: false };
    if (t >= last.ht) {
      const c = last.cars[i];
      const dt = Math.min(NET.MAX_EXTRAP, t - last.ht);
      if (c.st !== 0 || !trackLength) return { ...c, extrapolated: true };
      return { ...c, u: (c.u + (c.speed * dt) / trackLength) % 1, extrapolated: true };
    }
    let k = 1;
    while (k < n && this.snaps[k].ht < t) k++;
    const a = this.snaps[k - 1];
    const b = this.snaps[k];
    const f = b.ht > a.ht ? (t - a.ht) / (b.ht - a.ht) : 0;
    const ca = a.cars[i];
    const cb = b.cars[i];
    const out = {
      u: (((ca.u + wrapDelta(ca.u, cb.u) * f) % 1) + 1) % 1,
      speed: ca.speed + (cb.speed - ca.speed) * f,
      st: f < 0.5 ? ca.st : cb.st,
      pen: ca.pen + (cb.pen - ca.pen) * f,
      safe: ca.safe + (cb.safe - ca.safe) * f,
      flags: f < 0.5 ? ca.flags : cb.flags,
      lat: ca.lat + (cb.lat - ca.lat) * f,
      lane: f < 0.5 ? ca.lane : cb.lane,
      pos: null,
      quat: null,
      extrapolated: false,
    };
    if (ca.pos && cb.pos) {
      out.pos = ca.pos.map((v, j) => v + (cb.pos[j] - v) * f);
      const q = ca.quat.map((v, j) => v + (cb.quat[j] - v) * f);
      const m = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      out.quat = q.map((v) => v / m);
    } else if (cb.pos || ca.pos) {
      const s = cb.pos ? cb : ca;
      out.pos = s.pos.slice();
      out.quat = s.quat.slice();
    }
    return out;
  }
}

/**
 * Where the guest's own car should be, from the newest snapshot: the host's value pushed forward by the
 * time since the snapshot was made and by the round trip, because the guest's input leads the host's view.
 * @returns {{ u:number, speed:number }}
 */
export function ownTarget(host, snap, now, rtt, trackLength) {
  const age = Math.max(0, now - snap.recv) + Math.min(0.5, Math.max(0, rtt));
  return { u: (host.u + (host.speed * age) / trackLength) % 1, speed: host.speed };
}

/** Round trip time from a snapshot that echoes one of our messages. */
export function roundTrip(snap, now) {
  if (snap.ack == null) return null;
  const rtt = now - snap.ack - snap.hold;
  return rtt >= 0 && rtt < 5 ? rtt : null;
}

/**
 * One reconcile step for the guest's own car on the slot.
 * @returns {{ u:number, snapped:boolean, errMetres:number }}
 */
export function reconcileOwn(localU, target, dt, trackLength) {
  const err = wrapDelta(localU, target.u);
  const m = Math.abs(err) * trackLength;
  if (m > NET.SNAP_METRES) return { u: target.u, snapped: true, errMetres: m };
  const k = 1 - Math.exp(-NET.BLEND_RATE * dt);
  return { u: (((localU + err * k) % 1) + 1) % 1, snapped: false, errMetres: m };
}
