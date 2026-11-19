/**
 * Desktop input: keyboard, mouse drag and gamepad. `update()` returns a plain state object for main.js.
 *   Space / ArrowUp  full throttle        1-9  pick circuit
 *   mouse hold       drag up for less     gamepad RT analog, A full, B reset, Start, Y sound
 */
export class Input {
  constructor() {
    this.keyHeld = false;
    this.pointerHeld = false;
    this.pointerValue = null; // null = full throttle; otherwise the drag position (0..1)
    this.keyThrottle = 0;
    this.padPrev = { start: false, reset: false, sound: false };
    this.resetQueued = false;
    this.circuitQueued = -1;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        this.keyHeld = true;
        e.preventDefault(); // Space / Up must not scroll or press a focused control
      } else if (/^Digit[1-9]$/.test(e.code) && !e.repeat) {
        this.circuitQueued = Number(e.code.slice(5)) - 1;
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') this.keyHeld = false;
    });
    window.addEventListener('blur', () => {
      this.keyHeld = false;
      this.pointerHeld = false;
    });
    window.addEventListener('pointerup', () => (this.pointerHeld = false));

    this.state = { throttle: 0, resetRequested: false, circuitIndex: -1, padStart: false, padSound: false };
  }

  /** Mouse throttle, driven by main.js so that clicks on buttons do not also accelerate the car. */
  setPointerHeld(held, value = null) {
    this.pointerHeld = held;
    this.pointerValue = held ? value : null;
  }

  update(dt) {
    const s = this.state;
    s.resetRequested = this.resetQueued;
    this.resetQueued = false;
    s.circuitIndex = this.circuitQueued;
    this.circuitQueued = -1;

    // Keys and mouse: a smoothed ramp, so the throttle feels like a trigger and not a switch.
    const pointer = this.pointerHeld ? (this.pointerValue ?? 1) : 0;
    const target = this.keyHeld ? 1 : pointer;
    this.keyThrottle += (target - this.keyThrottle) * (1 - Math.exp(-(target ? 6 : 14) * dt));
    if (this.keyThrottle < 0.01) this.keyThrottle = 0;
    let throttle = this.keyThrottle;

    // Gamepad (standard mapping): RT analog throttle, A full, Start / B / Y on press.
    s.padStart = false;
    s.padSound = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const a = pad.buttons[0] && pad.buttons[0].pressed ? 1 : 0;
      throttle = Math.max(throttle, rt, a);
      const start = !!(pad.buttons[9] && pad.buttons[9].pressed);
      const reset = !!(pad.buttons[1] && pad.buttons[1].pressed);
      const sound = !!(pad.buttons[3] && pad.buttons[3].pressed);
      if (start && !this.padPrev.start) s.padStart = true;
      if (reset && !this.padPrev.reset) s.resetRequested = true;
      if (sound && !this.padPrev.sound) s.padSound = true;
      this.padPrev = { start, reset, sound };
      break; // first connected pad only
    }

    s.throttle = Math.min(1, Math.max(0, throttle));
    return s;
  }
}
