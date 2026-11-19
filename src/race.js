import { AiDriver, AI_PROFILES } from './ai.js';

export const MODE = { TT: 'TT', VS: 'VS' };
export const LAP_OPTIONS = [1, 3, 5, 8, 10];

const fresh = () => ({ count: 0, lapStart: 0, best: null, valid: true });

/**
 * Race state machine: READY -> COUNTDOWN (3, 2, 1, GO) -> RACING -> FINISHED.
 *
 * Owns lap counting, derail bookkeeping, the AI driver, the time-trial ghost, and the race
 * result. Cars are moved by the caller with the throttles returned from `throttles()`.
 *
 * @param {{
 *   player: import('./car.js').Car, rival: import('./car.js').Car, ghost: import('./car.js').Car,
 *   track: object,
 *   onChange: () => void, onBeep: (n: number) => void, onGo: () => void,
 *   onLapDone: (who: 'player'|'rival', t: number) => void,
 *   onDerail: (who: 'player'|'rival', car: import('./car.js').Car) => void,
 *   onFinish: (result: object) => void,
 * }} o
 */
export class RaceController {
  constructor(o) {
    this.o = o;
    this.track = o.track;
    this.haunted = true; // Haunted Mode is the default; the VANILLA button turns it off
    this.mode = MODE.VS;
    this.rivalKey = 'pro';
    this.opponent = null; // online: { name, throttle } replaces the AI rival with the other player
    this.follower = false; // online guest: the host runs the race, this side only mirrors it
    this.laps = 3;
    this.driver = new AiDriver(this.track, AI_PROFILES[this.rivalKey]);
    this.clock = 0;
    this.state = 'READY';
    this.countdown = 0;
    this.shown = 0; // last countdown digit announced
    this.elapsed = 0; // race time since GO
    this.result = null;
    this.lap = { player: fresh(), rival: fresh() };
    this.personalBest = null; // best valid player lap this session
    this.ghostBest = null; // samples [{t, u}] of the fastest valid player lap
    this.ghostTime = Infinity;
    this.ghostBuf = [];

    o.player.onLap = () => this._lapDone('player');
    o.rival.onLap = () => this._lapDone('rival');
    o.player.onDerail = () => this._derailed('player');
    o.rival.onDerail = () => this._derailed('rival');
    this._applyMode();
  }

  get rivalProfile() {
    return AI_PROFILES[this.rivalKey];
  }

  get rivalName() {
    return this.opponent ? this.opponent.name : this.rivalProfile.name;
  }

  get modeLabel() {
    const base = this.mode === MODE.TT ? 'TIME TRIAL' : `VS ${this.rivalName}`;
    return this.haunted ? `${base} \u00b7 HAUNTED` : base;
  }

  /** Haunted Mode on or off. Only changed between races. */
  setHaunted(on) {
    if (this.busy) return false;
    this.haunted = on;
    this.o.hazards?.setVisible(on);
    this.reset();
    return true;
  }

  /** Track changed: keep the session, restart the race, and rebuild the AI driver. */
  setTrack(track) {
    this.track = track;
    this.driver.setTrack(track);
    this.ghostBest = null;
    this.ghostTime = Infinity;
    this.reset();
  }

  _applyMode() {
    this.o.rival.mesh.visible = this.mode === MODE.VS;
    this.driver.profile = this.rivalProfile;
  }

  /** Mode and rival changes are only accepted between races. */
  setMode(m) {
    if (this.busy) return false;
    this.mode = m;
    this._applyMode();
    this.reset();
    return true;
  }

  setRival(key) {
    if (this.busy || !AI_PROFILES[key]) return false;
    this.rivalKey = key;
    this._applyMode();
    this.reset();
    return true;
  }

  setLaps(n) {
    if (this.busy || !LAP_OPTIONS.includes(n)) return false;
    this.laps = n;
    this.reset();
    return true;
  }

  get busy() {
    return this.state === 'COUNTDOWN' || this.state === 'RACING';
  }

  /** Back to READY: race result cleared, cars left where they are. */
  reset() {
    this.o.hazards?.reset();
    this.o.ghost.mesh.visible = false;
    this.state = 'READY';
    this.result = null;
    this.countdown = 0;
    this.elapsed = 0;
    this.lap = { player: fresh(), rival: fresh() };
    this.ghostBuf = [];
    this.driver.reset();
    this.o.onChange();
  }

  /** Put both cars on the grid and start the 3-2-1 countdown. */
  start() {
    if (this.busy) return;
    this.o.hazards?.reset();
    this.o.player.resetLane(); // a portal may have swapped them last race
    this.o.rival.resetLane();
    this.o.player.placeOnTrack(0);
    this.o.rival.placeOnTrack(0);
    this.driver.reset();
    this.o.ghost.mesh.visible = false;
    this.state = 'COUNTDOWN';
    this.countdown = 3;
    this.shown = 3;
    this.elapsed = 0;
    this.result = null;
    this.lap = { player: fresh(), rival: fresh() };
    this.ghostBuf = [];
    this.o.onBeep(3);
    this.o.onChange();
  }

  _go() {
    this.state = 'RACING';
    this.lap.player.lapStart = this.clock;
    this.lap.rival.lapStart = this.clock;
    this.o.onGo();
    this.o.onChange();
  }

  /**
   * Throttles for this frame. `playerInput` is the player's 0..1 throttle.
   * The caller applies them: player.update(dt, p) and, in VS mode only, rival.update(dt, r).
   * @returns {{ player: number, rival: number }}
   */
  throttles(dt, playerInput) {
    this.clock += dt;
    if (this.state === 'COUNTDOWN') {
      this.countdown -= dt;
      const digit = Math.ceil(this.countdown);
      if (digit < this.shown && digit >= 1) {
        this.shown = digit;
        this.o.onBeep(digit);
      }
      if (this.countdown <= 0) this._go();
      return { player: 0, rival: 0 };
    }
    if (this.state === 'RACING') {
      this.elapsed += dt;
      if (this.mode === MODE.TT && this.o.player.state === 'running') {
        this.ghostBuf.push({ t: this.clock - this.lap.player.lapStart, u: this.o.player.u });
      }
      const rival = this.mode !== MODE.VS ? 0 : this.opponent ? this.opponent.throttle : this.driver.throttle(this.o.rival, dt);
      this._updateGhost();
      return { player: playerInput, rival };
    }
    if (this.state === 'FINISHED') return { player: 0, rival: 0 };
    return { player: playerInput, rival: this.opponent ? this.opponent.throttle : 0 }; // READY: free practice driving, no timing
  }

  _lapDone(who) {
    if (this.follower) return; // the host counts laps
    const L = this.lap[who];
    const t = this.clock - L.lapStart;
    if (this.state === 'RACING') {
      if (who === 'player' && L.valid && t > 1) {
        L.best = L.best === null ? t : Math.min(L.best, t);
        if (this.personalBest === null || t < this.personalBest) this.personalBest = t;
        if (this.mode === MODE.TT && t < this.ghostTime) {
          this.ghostTime = t;
          this.ghostBest = this.ghostBuf.slice();
        }
      } else if (who === 'rival' && L.valid && t > 1) {
        L.best = L.best === null ? t : Math.min(L.best, t);
      }
      L.count++;
      L.lapStart = this.clock;
      L.valid = true;
      this.o.onLapDone(who, t);
      if (who === 'player') this.ghostBuf = [];
      if (L.count >= this.laps) this._finish(who);
    } else {
      L.count++;
      L.lapStart = this.clock;
      L.valid = true;
    }
    this.o.onChange();
  }

  _derailed(who) {
    if (this.follower) return this.o.onDerail(who, this.o[who]); // sound and sparks only
    this.lap[who].valid = false;
    this.o.onDerail(who, this.o[who]);
    this.o.onChange();
  }

  /** Result as the host builds it: `winner` is 'player' (the host's car) or 'rival'. Also used for the guest's copy. */
  _finish(winner) {
    this.o.ghost.mesh.visible = false;
    this.state = 'FINISHED';
    this.result = {
      winner, // 'player' | 'rival'
      mode: this.mode,
      laps: this.laps,
      total: this.elapsed,
      playerBest: this.lap.player.best,
      rivalBest: this.lap.rival.best,
      rivalName: this.rivalName,
    };
    this.o.onFinish(this.result);
    this.o.onChange();
  }

  /** Progress in metres along the whole race (laps done plus position on the current lap). */
  progress(who) {
    const car = this.o[who];
    return (this.lap[who].count + car.u) * this.track.length;
  }

  /** VS only: who leads and by how many metres. */
  standing() {
    if (this.mode !== MODE.VS) return null;
    const d = this.progress('player') - this.progress('rival');
    return { leader: d >= 0 ? 'player' : 'rival', gap: Math.abs(d) };
  }

  /** Lap time so far for the player, or null while not racing. */
  get playerLapTime() {
    return this.state === 'RACING' ? this.clock - this.lap.player.lapStart : null;
  }

  /** Time-trial ghost: replays the fastest saved lap from the start line. */
  _updateGhost() {
    const g = this.o.ghost;
    const show = this.mode === MODE.TT && this.ghostBest !== null;
    g.mesh.visible = show;
    if (!show) return;
    const tl = this.clock - this.lap.player.lapStart;
    const s = this.ghostBest;
    let lo = 0;
    let hi = s.length - 1;
    if (tl >= s[hi].t) {
      g.placeOnTrack(s[hi].u);
      return;
    }
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= tl) lo = mid;
      else hi = mid;
    }
    const a = s[lo];
    const b = s[hi];
    const k = b.t > a.t ? (tl - a.t) / (b.t - a.t) : 0;
    let du = b.u - a.u;
    if (du > 0.5) du -= 1;
    if (du < -0.5) du += 1;
    g.placeOnTrack(a.u + du * k);
  }
}
