const W = 512;
const H = 320;
const CH = 132; // compact (phone) band height, same 512 px width

const fmt = (t) => {
  if (t == null) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
};

/**
 * Telemetry HUD: a canvas shown as a fixed overlay in the top-right corner.
 */
export class Hud {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.acc = 1;
    this.compact = false;
  }

  /** Phones: a short band across the top with the essentials in big type, instead of the full panel. */
  setCompact(on, wide = false) {
    this.compact = on;
    this.canvas.height = on ? CH : H;
    Object.assign(this.canvas.style, on
      ? { top: '8px', left: '8px', right: 'auto', width: wide ? 'min(42vw, 360px)' : 'min(calc(100vw - 16px), 420px)', aspectRatio: `${W} / ${CH}` }
      : { top: '12px', right: '12px', left: 'auto', width: 'min(320px, 44vw)', aspectRatio: `${W} / ${H}` });
    this.acc = 1; // redraw at once
  }

  _compact(d) {
    const g = this.ctx;
    g.clearRect(0, 0, W, CH); // the band is see-through: clear first, or old digits show under new ones
    g.fillStyle = 'rgba(10,13,18,0.92)';
    g.fillRect(0, 0, W, CH);
    const p = d.player;
    g.textBaseline = 'alphabetic';
    // Left: your speed, big, then lap and lap time.
    g.textAlign = 'left';
    g.fillStyle = '#f2f5f9';
    g.font = '700 50px monospace';
    const num = String(Math.round(p.speed * 43 * 3.6));
    g.fillText(num, 14, 52);
    const nw = g.measureText(num).width;
    g.fillStyle = '#7f8ea3';
    g.font = '600 18px monospace';
    g.fillText('km/h', 20 + nw, 52);
    g.fillStyle = '#c9d1dc';
    g.font = '700 24px monospace';
    g.fillText(`LAP ${p.lap}/${d.lapsTotal}`, 14, 86);
    g.fillStyle = '#f2f5f9';
    g.font = '600 22px monospace';
    g.fillText(fmt(p.lapTime).slice(1), 160, 86);
    // Right: position against the rival.
    g.textAlign = 'right';
    if (d.standing) {
      const lead = d.standing.leader === 'player';
      g.fillStyle = lead ? '#58d68d' : '#ff8b82';
      g.font = '700 30px monospace';
      g.fillText(lead ? 'P1' : 'P2', W - 14, 44);
      g.fillStyle = '#c9d1dc';
      g.font = '600 18px monospace';
      g.fillText(`${lead ? '+' : '-'}${d.standing.gap.toFixed(2)} m`, W - 14, 70);
      g.fillStyle = '#8fb8ff';
      g.fillText(`${d.rival.name} L${d.rival.lap}`, W - 14, 92);
    } else {
      g.fillStyle = '#58d68d';
      g.font = '600 18px monospace';
      g.fillText(`BEST ${fmt(p.bestLap).slice(1)}`, W - 14, 44);
    }
    // Bottom strip: a warning if there is one, otherwise the race status.
    let text = d.status;
    let bg = d.status.startsWith('RACING') ? '#16351f' : d.status.startsWith('COUNT') ? '#4a3408' : '#1b2230';
    let fg = '#e8edf3';
    if (p.state === 'derailed' || p.state === 'held') {
      text = `DE-SLOTTED \u00b7 ${Math.max(0, p.recovery).toFixed(1)}s`;
      bg = Math.floor(performance.now() / 250) % 2 ? '#7a1710' : '#4a0f0b';
      fg = '#ffd9d6';
    } else if (p.safeRatio > 0.85) {
      text = 'BRAKE! BEND AHEAD';
      bg = '#6b4a05';
      fg = '#ffe39a';
    }
    g.fillStyle = bg;
    g.fillRect(0, 102, W, 30);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.font = '700 19px monospace';
    g.fillText(text, W / 2, 124);
    g.textAlign = 'left';
  }

  /** Desktop: the same readout as a fixed overlay in the top-right corner (no pointer capture). */
  showOverlay() {
    Object.assign(this.canvas.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      width: 'min(320px, 44vw)', // smaller on phones
      height: 'auto',
      aspectRatio: '512 / 320',
      pointerEvents: 'none',
      borderRadius: '8px',
      zIndex: '5',
      display: 'block',
    });
    if (!this.canvas.isConnected) document.body.appendChild(this.canvas);
  }

  /**
   * @param {number} dt
   * @param {{
   *   circuit: string, modeLabel: string, status: string, lapsTotal: number, throttle: number, muted: boolean,
   *   standing: { leader: 'player'|'rival', gap: number } | null, showRival: boolean,
   *   player: { speed: number, lap: number, lapTime: number|null, bestLap: number|null, state: string, safeRatio: number, recovery: number },
   *   rival: { name: string, speed: number, lap: number, lapTime: number|null, bestLap: number|null },
   * }} d
   */
  update(dt, d) {
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    if (this.compact) return this._compact(d);

    const g = this.ctx;
    g.fillStyle = '#0a0d12';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#10151d';
    g.fillRect(8, 8, W - 16, H - 16);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';

    // Header: who is who, circuit and mode.
    g.font = '700 20px monospace';
    g.fillStyle = '#ff8b82';
    g.fillText('YOU', 24, 40);
    if (d.showRival) {
      g.fillStyle = '#8fb8ff';
      g.textAlign = 'right';
      g.fillText(d.rival.name, W - 24, 40);
      g.textAlign = 'left';
    }
    g.fillStyle = '#e8edf3';
    g.textAlign = 'center';
    g.fillText(d.circuit, W / 2, 40);
    g.font = '600 14px monospace';
    g.fillStyle = '#7f8ea3';
    g.fillText(d.modeLabel + (d.muted ? '  \u00b7  MUTED' : ''), W / 2, 62);
    g.textAlign = 'left';

    const columns = [
      { x: 24, c: d.player, showLap: true, name: 'YOU' },
      { x: 280, c: d.rival, showLap: d.showRival },
    ];
    for (const { x, c, showLap } of columns) {
      if (c === d.rival && !d.showRival) continue;
      g.font = '700 60px monospace';
      const num = String(Math.round(c.speed * 43 * 3.6)).padStart(3, ' ');
      g.fillStyle = '#f2f5f9';
      g.fillText(num, x - 4, 124);
      const w = g.measureText(num).width;
      g.fillStyle = '#7f8ea3';
      g.font = '600 18px monospace';
      g.fillText('km/h', x + w + 6, 124);

      g.fillStyle = '#c9d1dc';
      g.font = '600 20px monospace';
      g.fillText(showLap ? `LAP ${c.lap}/${d.lapsTotal}` : '', x, 154);
      g.fillStyle = '#f2f5f9';
      g.font = '700 26px monospace';
      g.fillText(fmt(c.lapTime), x, 182);
      g.fillStyle = '#58d68d';
      g.font = '600 17px monospace';
      g.fillText(`BEST ${fmt(c.bestLap)}`, x, 204);
    }

    // Standing (VS): who leads and by how far.
    g.textAlign = 'center';
    g.font = '600 16px monospace';
    g.fillStyle = '#c9d1dc';
    if (d.standing) {
      const who = d.standing.leader === 'player' ? 'YOU LEAD' : `${d.rival.name} LEADS`;
      g.fillText(`${who}  \u00b7  +${d.standing.gap.toFixed(2)} m`, W / 2, 230);
    }

    // Race status bar.
    g.fillStyle = d.status.startsWith('RACING') ? '#16351f' : d.status.startsWith('COUNT') ? '#4a3408' : '#1b2230';
    g.fillRect(24, 240, W - 48, 24);
    g.fillStyle = '#e8edf3';
    g.font = '700 18px monospace';
    g.fillText(d.status, W / 2, 258);

    g.textAlign = 'left';
    // Throttle bar.
    g.fillStyle = '#222a36';
    g.fillRect(24, 272, W - 48, 8);
    g.fillStyle = '#f5a623';
    g.fillRect(24, 272, (W - 48) * d.throttle, 8);

    // Warning line for the player car.
    const p = d.player;
    let text = '';
    let bg = '#1b2230';
    let fg = '#c9d1dc';
    if (p.state === 'derailed' || p.state === 'held') {
      const blink = Math.floor(performance.now() / 250) % 2 === 0;
      text = p.state === 'held'
        ? 'PLACE CAR ON TRACK'
        : `DE-SLOTTED - RECOVER ${Math.max(0, p.recovery).toFixed(1)}s`;
      bg = blink ? '#7a1710' : '#4a0f0b';
      fg = '#ffd9d6';
    } else if (p.safeRatio > 0.85) {
      text = 'BRAKE! BEND AHEAD';
      bg = '#6b4a05';
      fg = '#ffe39a';
    } else {
      text = 'ON SLOT';
      bg = '#16351f';
      fg = '#58d68d';
    }
    g.fillStyle = bg;
    g.fillRect(24, 290, W - 48, 22);
    g.fillStyle = fg;
    g.font = '700 16px monospace';
    g.textAlign = 'center';
    g.fillText(text, W / 2, 306);
    g.textAlign = 'left';

  }
}
