/**
 * Fully procedural audio (no assets): motor whine, rail hiss, track-joint clatter
 * and impact thuds. All pitch/level modulation is driven by car speed.
 */

const JOINT_SPACING = 0.18; // metres between plastic track joints

class MotorVoice {
  constructor(ctx, dest, gain, detune) {
    this.saw = ctx.createOscillator();
    this.saw.type = 'sawtooth';
    this.sq = ctx.createOscillator();
    this.sq.type = 'square';
    this.sq.detune.value = detune;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 4;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.base = gain;
    const mixSq = ctx.createGain();
    mixSq.gain.value = 0.4;
    this.saw.connect(this.filter);
    this.sq.connect(mixSq).connect(this.filter);
    this.filter.connect(this.out).connect(dest);
    this.saw.start();
    this.sq.start();
  }

  set(ctx, speedRatio, throttle, active) {
    const t = ctx.currentTime;
    const freq = 110 + speedRatio * 950;
    this.saw.frequency.setTargetAtTime(freq, t, 0.04);
    this.sq.frequency.setTargetAtTime(freq * 2.01, t, 0.04);
    this.filter.frequency.setTargetAtTime(500 + speedRatio * 2600 + throttle * 600, t, 0.05);
    const level = active ? this.base * (0.25 + 0.55 * speedRatio + 0.4 * throttle) : 0;
    this.out.gain.setTargetAtTime(level, t, 0.05);
  }
}

export class SlotAudio {
  constructor() {
    this.ctx = null;
    this.jointAcc = 0;
    this.muted = false;
    this.engineOn = false;
    // Title and menu soundtrack (public/audio/racing.mp3); haunted mode has its own (public/audio/haunted.mp3).
    // Browsers only allow playback after a user gesture.
    this.tracks = {
      normal: new Audio(`${import.meta.env.BASE_URL}audio/racing.mp3`),
      haunted: new Audio(`${import.meta.env.BASE_URL}audio/haunted.mp3`),
    };
    for (const a of Object.values(this.tracks)) {
      a.loop = true;
      a.volume = 0.45;
      a.preload = 'auto';
    }
    this.music = this.tracks.normal;
    this.musicOn = false;
  }

  /** Pick the soundtrack: the spooky theme when haunted mode is selected. Switching starts the new one from the top. */
  setMusicTheme(haunted) {
    const next = haunted ? this.tracks.haunted : this.tracks.normal;
    if (next === this.music) return;
    this.music.pause();
    this.music = next;
    this.music.currentTime = 0;
    this._syncMusic();
  }

  /** Soundtrack on (title and menu) or off (during a race). */
  setMusic(on) {
    this.musicOn = on;
    this._syncMusic();
  }

  _syncMusic() {
    for (const a of Object.values(this.tracks)) if (a !== this.music) a.pause();
    if (this.musicOn && !this.muted) this.music.play().catch(() => {}); // blocked until the first gesture
    else this.music.pause();
  }

  /** Must be called from a user gesture (key, click, XR session start). */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(comp).connect(ctx.destination);

      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      this.player = new MotorVoice(ctx, this.master, 0.07, 6);
      this.rival = new MotorVoice(ctx, this.master, 0.035, -9);

      // Continuous rail hiss.
      const hissSrc = ctx.createBufferSource();
      hissSrc.buffer = this.noise;
      hissSrc.loop = true;
      const hissF = ctx.createBiquadFilter();
      hissF.type = 'bandpass';
      hissF.frequency.value = 5200;
      hissF.Q.value = 0.7;
      this.hiss = ctx.createGain();
      this.hiss.gain.value = 0;
      hissSrc.connect(hissF).connect(this.hiss).connect(this.master);
      hissSrc.start();

      // Looping noise gated by `clack()` => joint clatter.
      const clSrc = ctx.createBufferSource();
      clSrc.buffer = this.noise;
      clSrc.loop = true;
      const clF = ctx.createBiquadFilter();
      clF.type = 'bandpass';
      clF.frequency.value = 2400;
      clF.Q.value = 1.2;
      this.clatter = ctx.createGain();
      this.clatter.gain.value = 0;
      clSrc.connect(clF).connect(this.clatter).connect(this.master);
      clSrc.start();

      // Tire squeal: a narrow band of noise, gated by how close a car is to its derail limit.
      const sqSrc = ctx.createBufferSource();
      sqSrc.buffer = this.noise;
      sqSrc.loop = true;
      const sqF = ctx.createBiquadFilter();
      sqF.type = 'bandpass';
      sqF.frequency.value = 3400;
      sqF.Q.value = 9;
      this.squealGain = ctx.createGain();
      this.squealGain.gain.value = 0;
      sqSrc.connect(sqF).connect(this.squealGain).connect(this.master);
      sqSrc.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Plain electronic beep: countdown ticks and the GO tone. */
  beep(freq, dur = 0.12, vol = 0.35) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Menu sounds: click, tick (arrows), select (circuit picked), go (START). */
  uiSound(kind) {
    if (!this.ctx) return;
    if (kind === 'tick') this.beep(900, 0.035, 0.15);
    else if (kind === 'select') {
      this.beep(1046, 0.08, 0.2);
      setTimeout(() => this.beep(1568, 0.12, 0.2), 60);
    } else if (kind === 'go') this.beep(1320, 0.2, 0.3);
    else this.beep(640, 0.05, 0.18);
  }

  /** Two-note chime played when any car completes a lap. */
  chime() {
    this.beep(880, 0.16, 0.25);
    setTimeout(() => this.beep(1320, 0.22, 0.25), 90);
  }

  /** Lap done: a mechanical "chick", a latch clicking shut (a burst of band-passed noise) with a low wooden thump. */
  chick() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.05);
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, 0.08);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /** Tire squeal level 0..1, applied continuously. */
  setSqueal(level) {
    if (!this.ctx) return;
    this.squealGain.gain.setTargetAtTime(0.08 * Math.min(1, Math.max(0, level)), this.ctx.currentTime, 0.05);
  }

  /** Engines and rail noise play only during a race; the title screen is silent. */
  setEngine(on) {
    this.engineOn = on;
  }

  setMuted(on) {
    this.muted = on;
    this._syncMusic();
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on ? 0 : 0.7, this.ctx.currentTime, 0.03);
  }

  /** Haunted: a low rumble that swells during the kaiju's charge. */
  kaijuCharge(on) {
    if (!this.ctx) return;
    if (!this.rumble) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 38;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 140;
      this.rumble = ctx.createGain();
      this.rumble.gain.value = 0;
      osc.connect(lp).connect(this.rumble).connect(this.master);
      osc.start();
    }
    this.rumble.gain.setTargetAtTime(on ? 0.45 : 0, this.ctx.currentTime, on ? 0.6 : 0.05);
  }

  /** Haunted: the kaiju's foot hits the track. */
  stomp() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.52);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(lp).connect(ng).connect(this.master);
    src.start(t, Math.random() * 0.5, 0.4);
  }

  /** Haunted storm: distant thunder, a short crack followed by a rolling low rumble. `level` 0..1. */
  /** The shared thunder bus: the sound plus a reverb of a big stone hall, built once. */
  _thunderBus() {
    if (!this.thBus) {
      const ctx = this.ctx;
      const len = Math.round(ctx.sampleRate * 2.8);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-3.2 * i) / len);
      }
      const bus = ctx.createGain();
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      bus.connect(this.master);
      bus.connect(conv).connect(wet).connect(this.master);
      this.thBus = bus;
    }
    return this.thBus;
  }

  /**
   * Haunted thunder, different every time: a sharp crack (random pitch and length), a falling rumble that rolls for
   * 2.4-3.4 s (4.6-6.2 s when `long`), an echo rolling back off the hills, a low boom under it, and a stone-hall reverb.
   * `level` 0..1. About 40 % louder than the first version.
   */
  thunder(level = 1, long = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const v = Math.min(1, Math.max(0, level)) * rnd(0.85, 1.15) * 1.4;
    const out = this._thunderBus();
    const roll = long ? rnd(4.6, 6.2) : rnd(2.4, 3.4);
    const t = ctx.currentTime + rnd(0, 0.06);
    const crack = ctx.createBufferSource();
    crack.buffer = this.noise;
    const cbp = ctx.createBiquadFilter();
    cbp.type = 'bandpass';
    cbp.frequency.value = rnd(700, 1900);
    cbp.Q.value = rnd(0.4, 1.2);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.3 * v + 0.001, t + 0.004);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + rnd(0.18, 0.32));
    crack.connect(cbp).connect(cg).connect(out);
    crack.start(t, Math.random() * 0.5, 0.4);
    // A low-passed rumble that falls in pitch, uneven (a tremolo) and with a random swell.
    const layer = (start, dur, peak, lpStart, lpEnd) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lpStart, start);
      lp.frequency.exponentialRampToValueAtTime(lpEnd, start + dur);
      lp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + rnd(0.15, 0.45));
      g.gain.setTargetAtTime(peak * 0.5, start + 0.5, 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rnd(3, 9);
      const lg = ctx.createGain();
      lg.gain.value = peak * 0.35;
      lfo.connect(lg).connect(g.gain);
      src.connect(lp).connect(g).connect(out);
      src.start(start, Math.random() * 0.5);
      src.stop(start + dur + 0.1);
      lfo.start(start);
      lfo.stop(start + dur + 0.1);
    };
    layer(t, roll, 0.7 * v, rnd(260, 420), rnd(40, 70));
    layer(t + rnd(0.6, 1.1), roll * 0.7, 0.35 * v, rnd(160, 240), rnd(35, 55)); // the echo
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(rnd(40, 60), t);
    boom.frequency.exponentialRampToValueAtTime(rnd(20, 28), t + roll * 0.6);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.05);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + roll * 0.7);
    boom.connect(bg).connect(out);
    boom.start(t);
    boom.stop(t + roll * 0.7 + 0.05);
  }

  /** Haunted: a wolf howl from the dark edge of the forest. A saw voice rises, wavers with vibrato and breathes through a
   *  band-pass, then falls away. Different length and pitch each time. */
  howl() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const dur = rnd(2.2, 3.4);
    const base = rnd(260, 320);
    const peak = base * rnd(1.6, 1.9);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(peak, t + dur * 0.45);
    osc.frequency.linearRampToValueAtTime(base * 0.95, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = rnd(4.5, 6);
    const vibG = ctx.createGain();
    vibG.gain.value = 14;
    vib.connect(vibG).connect(osc.frequency);
    const voice = ctx.createBiquadFilter();
    voice.type = 'bandpass';
    voice.frequency.value = rnd(650, 900);
    voice.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.5);
    g.gain.setValueAtTime(0.32, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(voice).connect(g).connect(this.master);
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
    // breath: a little filtered noise under the cry
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.05, t + 0.4);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(ng).connect(this.master);
    src.start(t, Math.random() * 0.5, dur);
  }

  /** Haunted: a wooden creak, a door or a coffin lid, low and short, with a wobble. */
  creak() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.9 + Math.random() * 0.9;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f0 = 70 + Math.random() * 50;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f0 * (1.4 + Math.random() * 0.4), t + dur * 0.5);
    osc.frequency.linearRampToValueAtTime(f0 * 0.8, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Haunted earthquake: a sub-bass boom that drops in pitch, then a trembling ground rumble (~3 s). `level` 0..1. */
  quake(level = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const v = Math.min(1, Math.max(0, level));
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(72, t);
    boom.frequency.exponentialRampToValueAtTime(24, t + 1.6);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.9 * v + 0.001, t + 0.03);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    boom.connect(bg).connect(this.master);
    boom.start(t);
    boom.stop(t + 1.85);
    // Ground rumble: low-passed noise with a fast tremolo, so it shudders.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.7 * v + 0.001, t + 0.3);
    rg.gain.setTargetAtTime(0.45 * v + 0.001, t + 0.6, 0.6);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lg = ctx.createGain();
    lg.gain.value = 0.25 * v;
    lfo.connect(lg).connect(rg.gain);
    src.connect(lp).connect(rg).connect(this.master);
    src.start(t, Math.random() * 0.5);
    lfo.start(t);
    src.stop(t + 3.05);
    lfo.stop(t + 3.05);
  }

  /** Haunted: eerie vibrato warble while the player's car is inside the poltergeist beam. */
  warble(level) {
    if (!this.ctx) return;
    if (!this.warbleOsc) {
      const ctx = this.ctx;
      this.warbleOsc = ctx.createOscillator();
      this.warbleOsc.type = 'sine';
      this.warbleOsc.frequency.value = 620;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.value = 60;
      lfo.connect(depth).connect(this.warbleOsc.frequency);
      this.warbleGain = ctx.createGain();
      this.warbleGain.gain.value = 0;
      this.warbleOsc.connect(this.warbleGain).connect(this.master);
      this.warbleOsc.start();
      lfo.start();
    }
    this.warbleGain.gain.setTargetAtTime(0.12 * level, this.ctx.currentTime, 0.05);
  }

  /** Haunted: metallic whoosh as the pendulum blade crosses the track. */
  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, 0.3);
  }

  /** Spider: a sticky swish when a web lands or a car tangles in one. */
  webSnare() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, 0.25);
  }

  /** Gargoyle: a rising ectoplasm chirp as the orb is launched. */
  orbLaunch() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(1100, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.72);
  }

  /** Gargoyle: the orb hits the track. */
  orbBoom() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.36);
  }

  /** Claws: a low grinding rumble while the claw wakes. */
  clawRumble(on) {
    if (!this.ctx) return;
    if (!this.clawGain) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'bandpass';
      lp.frequency.value = 180;
      lp.Q.value = 2;
      this.clawGain = ctx.createGain();
      this.clawGain.gain.value = 0;
      src.connect(lp).connect(this.clawGain).connect(this.master);
      src.start();
    }
    this.clawGain.gain.setTargetAtTime(on ? 0.35 : 0, this.ctx.currentTime, on ? 0.3 : 0.05);
  }

  /** Claws: a metallic clank as the fingers snap shut. */
  clawSnap() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.beep(620, 0.06, 0.3);
    setTimeout(() => this.beep(410, 0.14, 0.3), 40);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, 0, 0.14);
  }

  /** Bats: a leathery flutter (noise chopped by a fast LFO) plus high squeaks, louder as the swarm closes in. */
  batSwarm(level) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.batGain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 1.2;
      const flutter = ctx.createGain();
      flutter.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23; // wing beats
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(flutter.gain);
      this.batGain = ctx.createGain();
      this.batGain.gain.value = 0;
      src.connect(bp).connect(flutter).connect(this.batGain).connect(this.master);
      src.start();
      lfo.start();
      this.batSqueak = 0;
    }
    this.batGain.gain.setTargetAtTime(0.32 * level, ctx.currentTime, 0.12);
    // Random squeaks while the swarm is near.
    if (level > 0.3 && ctx.currentTime > this.batSqueak) {
      this.batSqueak = ctx.currentTime + 0.12 + Math.random() * 0.35;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const f0 = 3800 + Math.random() * 2600;
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06 * level, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.09);
    }
  }

  _clack(strength) {
    const g = this.clatter.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(strength, t);
    g.exponentialRampToValueAtTime(0.0005, t + 0.035);
  }

  /** Short plastic bounce / thud when a derailed car hits the table. */
  impact(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500 + strength * 1800;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 * strength + 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, 0.2);
  }

  /**
   * @param {number} dt
   * @param {{ vmax: number, player: { speed: number, throttle: number, running: boolean }, rival: { speed: number } }} s
   */
  update(dt, s) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const on = this.engineOn; // engines, rail hiss and clatter only while a race is on
    const pr = on ? Math.min(1, s.player.speed / s.vmax) : 0;
    const rr = on ? Math.min(1, s.rival.speed / s.vmax) : 0;
    this.player.set(ctx, pr, on ? s.player.throttle : 0, on && s.player.running);
    this.rival.set(ctx, rr, rr, on);
    this.hiss.gain.setTargetAtTime(0.03 * pr, ctx.currentTime, 0.08);
    if (!on) {
      this.jointAcc = 0;
      return;
    }

    this.jointAcc = Math.min(this.jointAcc + s.player.speed * dt, JOINT_SPACING * 2);
    if (this.jointAcc >= JOINT_SPACING) {
      this.jointAcc -= JOINT_SPACING;
      this._clack(0.03 + 0.07 * pr);
    }
  }
}
