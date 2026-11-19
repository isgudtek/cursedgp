import { CAR } from './car.js';

/**
 * AI rival profiles. Rivals drive through the same Car physics as the player, including the
 * centrifugal derailment check. A profile only decides the throttle.
 *
 *   top    fraction of CAR.vmax the rival is willing to run on straights
 *   brake  multiplier on the track's safe speed. Below 1 the rival never exceeds the derail
 *          limit on its own. Above 1 it will overshoot bends and derail.
 *   jitter random throttle error (fraction of target) re-rolled every reaction interval
 */
export const AI_PROFILES = {
  rookie: { key: 'rookie', name: 'SPECTER', tag: 'Rookie', top: 0.7, brake: 0.8, jitter: 0.02, caution: 1 },
  pro: { key: 'pro', name: 'BANSHEE', tag: 'Pro', top: 0.9, brake: 0.93, jitter: 0.05, caution: 1 },
  maniac: { key: 'maniac', name: 'REAPER', tag: 'Maniac', top: 1.0, brake: 0.98, jitter: 0.12, caution: 0 },
};

// Distances ahead (metres) scanned for slow corners. The speed controller slows gradually (about
// 1 m to shed most of the speed), so the scan has to reach that far ahead.
const LOOK_M = [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0, 1.25, 1.5];
const REACTION = 0.25; // seconds between jitter re-rolls

export class AiDriver {
  constructor(track, profile) {
    this.track = track;
    this.profile = profile;
    this.timer = 0;
    this.noise = 0;
  }

  setTrack(track) {
    this.track = track;
    this.reset();
  }

  reset() {
    this.timer = 0;
    this.noise = 0;
  }

  /** Throttle 0..1 for `car` this frame. */
  throttle(car, dt) {
    const p = this.profile;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = REACTION;
      this.noise = (Math.random() * 2 - 1) * p.jitter;
    }
    const top = car.spec.vmax * CAR.vmax;
    let target = p.top * top;
    for (const s of LOOK_M) {
      const u = car.u + s / this.track.length;
      target = Math.min(target, this.track.safeSpeedAt(u) * car.spec.grip * p.brake);
      // Haunted zones: Rookie and Pro brake for them, Maniac (caution 0) runs through.
      if (this.hazards) target = Math.min(target, this.hazards.capAt(u, p.caution, car.lane));
    }
    target *= 1 + this.noise;
    return Math.min(1, Math.max(0, target / top));
  }
}
