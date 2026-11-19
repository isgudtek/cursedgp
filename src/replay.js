import * as THREE from 'three';

/**
 * Winner replay. Every client records both cars' poses while it runs the race (the host from its simulation,
 * the guest from what it draws), so nothing extra goes over the network. After the finish the winner's last
 * lap plays back from inside its cabin.
 */

const SAMPLE_HZ = 30;
const KEEP_SECONDS = 40;
const MAX_REPLAY = 18; // s: longest replay, the end of the winner's final lap
const TAIL = 1.4; // s of braking after the line that the replay includes

const _eye = new THREE.Vector3();
const _at = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class Recorder {
  constructor() {
    this.clear();
  }

  clear() {
    this.t = 0;
    this.acc = 0;
    this.samples = []; // { t, c: [ {p:[x,y,z], q:[x,y,z,w], v} x2 ] }
    this.marks = [[], []]; // lap crossing times per car
  }

  /** Record one frame. `cars` is [hostCar, guestCar] (player, rival), `speeds` their speeds. */
  tick(dt, cars) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / SAMPLE_HZ) return;
    this.acc = 0;
    this.samples.push({
      t: this.t,
      c: cars.map((c) => ({
        p: [c.mesh.position.x, c.mesh.position.y, c.mesh.position.z],
        q: [c.mesh.quaternion.x, c.mesh.quaternion.y, c.mesh.quaternion.z, c.mesh.quaternion.w],
        v: c.speed,
        vis: c.mesh.visible,
      })),
    });
    const cut = this.t - KEEP_SECONDS;
    if (this.samples.length > 60 && this.samples[0].t < cut) {
      let n = 0;
      while (n < this.samples.length - 1 && this.samples[n].t < cut) n++;
      this.samples.splice(0, n);
    }
  }

  mark(i) {
    this.marks[i].push(this.t);
  }

  /** The stretch to replay for winner `i`: from the start of its last lap to now, never longer than MAX_REPLAY. */
  window(i) {
    const m = this.marks[i];
    const last = m.length >= 2 ? m[m.length - 2] : 0;
    const t1 = this.t;
    const t0 = Math.max(last, t1 - MAX_REPLAY, this.samples.length ? this.samples[0].t : 0);
    return { t0, t1, ok: t1 - t0 > 1.5 && this.samples.length > 10 };
  }
}

export class ReplayPlayer {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Group[]} carGroups unused hook kept for clarity: the poses are written to the real car meshes
   */
  constructor(camera) {
    this.camera = camera;
    this.active = false;
    this.rec = null;
    this.win = null;
    this.winner = 0;
    this.t = 0;
    this.saved = null;
  }

  start(rec, winnerIndex) {
    const w = rec.window(winnerIndex);
    if (!w.ok) return false;
    this.rec = rec;
    this.win = w;
    this.winner = winnerIndex;
    this.t = w.t0;
    this.active = true;
    this.saved = { fov: this.camera.fov, near: this.camera.near };
    this.camera.fov = 78;
    this.camera.near = 0.004;
    this.camera.updateProjectionMatrix();
    this.cursor = 0;
    return true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.cars) for (const c of this.cars) c.mesh.visible = true;
    this.camera.fov = this.saved.fov;
    this.camera.near = this.saved.near;
    this.camera.updateProjectionMatrix();
  }

  get progress() {
    return this.win ? Math.min(1, (this.t - this.win.t0) / (this.win.t1 - this.win.t0)) : 1;
  }

  /**
   * Advance and pose everything.
   * @param {number} dt
   * @param {import('./car.js').Car[]} cars [hostCar, guestCar]
   * @returns {{ done: boolean, speed: number }}
   */
  update(dt, cars, rig) {
    this.t += dt;
    const s = this.rec.samples;
    let i = this.cursor;
    while (i < s.length - 2 && s[i + 1].t < this.t) i++;
    this.cursor = i;
    const a = s[i];
    const b = s[Math.min(i + 1, s.length - 1)];
    const f = b.t > a.t ? Math.min(1, Math.max(0, (this.t - a.t) / (b.t - a.t))) : 0;
    let speed = 0;
    cars.forEach((car, k) => {
      const ca = a.c[k];
      const cb = b.c[k];
      car.mesh.position.set(ca.p[0] + (cb.p[0] - ca.p[0]) * f, ca.p[1] + (cb.p[1] - ca.p[1]) * f, ca.p[2] + (cb.p[2] - ca.p[2]) * f);
      _qa.set(ca.q[0], ca.q[1], ca.q[2], ca.q[3]);
      _qb.set(cb.q[0], cb.q[1], cb.q[2], cb.q[3]);
      car.mesh.quaternion.copy(_qa).slerp(_qb, f);
      car.mesh.visible = k === this.winner ? false : ca.vis; // onboard view: no hood in the way
      if (k === this.winner) speed = ca.v + (cb.v - ca.v) * f;
    });
    // Cockpit camera on the winner: eye in the cabin, looking along the nose.
    const car = cars[this.winner];
    car.mesh.updateMatrixWorld(true);
    rig.position.set(0, 0, 0);
    this.cars = cars;
    this.camera.position.copy(_eye.set(0, 0.045, -0.01));
    car.mesh.localToWorld(this.camera.position);
    _at.set(0, 0.03, -0.5);
    car.mesh.localToWorld(_at);
    this.camera.lookAt(_at);
    return { done: this.t >= this.win.t1, speed };
  }
}

/** Overlay for the replay: letterbox bars, a caption, a progress line and SKIP. */
// Old-school replay marker: a white "R" in a 5x7 pixel font, like a VCR / CRT on-screen display, with a phosphor glow
// and scanlines, blinking on and off with hard cuts.
const R_BITMAP = ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'];
const R_SVG = `<svg viewBox="0 0 5 7" shape-rendering="crispEdges" aria-hidden="true"><title>R</title>${R_BITMAP.flatMap((row, y) =>
  [...row].map((c, x) => (c === 'X' ? `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>` : ''))).join('')}</svg>`;
const REPLAY_CSS = `
#replay-ui .bigR { position: relative; align-self: flex-start; height: clamp(84px, 16vh, 176px); aspect-ratio: 5 / 7; color: #f4f6ff;
  filter: drop-shadow(0 0 4px rgba(255,255,255,0.85)) drop-shadow(0 0 16px rgba(160,210,255,0.55)) drop-shadow(5px 5px 0 rgba(0,0,0,0.55));
  animation: replay-blink 1.1s steps(1, end) infinite; user-select: none; }
#replay-ui .bigR svg { width: 100%; height: 100%; display: block; fill: currentColor; }
/* CRT scanlines across the letter. */
#replay-ui .bigR::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.38) 0 2px, rgba(0,0,0,0) 2px 4px); mix-blend-mode: multiply; }
@keyframes replay-blink { 0% { opacity: 1; } 55% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { #replay-ui .bigR { animation: none; opacity: 0.9; } }
`;

export function mountReplayUi(onSkip) {
  if (!document.getElementById('replay-style')) {
    const st = document.createElement('style');
    st.id = 'replay-style';
    st.textContent = REPLAY_CSS;
    document.head.appendChild(st);
  }
  const wrap = document.createElement('div');
  wrap.id = 'replay-ui';
  Object.assign(wrap.style, {
    position: 'fixed',
    inset: '0',
    display: 'none',
    pointerEvents: 'none',
    zIndex: '14',
    fontFamily: 'monospace',
    color: '#f1eaff',
  });
  wrap.innerHTML = `
    <div class="bar top" style="position:absolute;left:0;right:0;top:0;height:9vh;background:linear-gradient(180deg,rgba(5,6,10,.92),rgba(5,6,10,0))"></div>
    <div class="bar bot" style="position:absolute;left:0;right:0;bottom:0;height:14vh;background:linear-gradient(0deg,rgba(5,6,10,.92),rgba(5,6,10,0))"></div>
    <div class="cap" style="position:absolute;left:6vw;top:11vh;display:flex;flex-direction:column;gap:6px">
      <div class="bigR" role="img" aria-label="Replay">${R_SVG}</div>
      <div class="who" style="font:700 clamp(14px,2.2vw,22px) Georgia,serif;letter-spacing:.1em;text-shadow:0 2px 8px rgba(0,0,0,.7)"></div>
    </div>
    <div class="spd" style="position:absolute;right:5vw;top:3.5vh;font:700 34px monospace;text-align:right"></div>
    <div style="position:absolute;left:5vw;right:5vw;bottom:5vh;display:flex;align-items:center;gap:16px">
      <div style="flex:1;height:3px;background:rgba(255,255,255,.18);border-radius:2px;overflow:hidden"><div class="fill" style="height:100%;width:0;background:#b48cff"></div></div>
      <button class="skip" style="pointer-events:auto;font:700 12px monospace;letter-spacing:.12em;padding:9px 16px;border-radius:8px;cursor:pointer;color:#e8e2f5;border:1px solid rgba(190,140,255,.5);background:rgba(20,22,34,.85)">SKIP &#9654;</button>
    </div>`;
  document.body.appendChild(wrap);
  const q = (s) => wrap.querySelector(s);
  const skip = q('.skip');
  skip.tabIndex = -1;
  skip.addEventListener('click', () => {
    onSkip();
    skip.blur();
  });
  return {
    show(on, who = '') {
      wrap.style.display = on ? 'block' : 'none';
      if (on) q('.who').textContent = `${who} \u00b7 FINAL LAP`;
    },
    update(progress, speed) {
      q('.fill').style.width = `${Math.round(progress * 100)}%`;
      q('.spd').innerHTML = `${Math.round(speed * 43 * 3.6)}<span style="font-size:13px;color:#a79cc4"> km/h</span>`;
    },
  };
}

export const REPLAY_TAIL = TAIL;
