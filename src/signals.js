/**
 * Race signals on top of the screen: the start lights (three round lights that light red with the countdown beeps and
 * turn green at GO) and a waving chequered flag at the finish. DOM only, no 3D.
 */

const STYLE = `
#signals { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); z-index: 8; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; gap: 8px; font-family: monospace; }
#signals .pod { display: none; gap: 14px; padding: 10px 16px; border-radius: 40px; background: rgba(8,9,14,0.86);
  border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 6px 22px rgba(0,0,0,0.45); transition: opacity .5s; }
#signals .lamp { width: 38px; height: 38px; border-radius: 50%; background: radial-gradient(circle at 35% 32%, #3a1414, #160707 70%);
  border: 2px solid #050505; box-shadow: inset 0 2px 6px rgba(0,0,0,0.8); transition: background .08s, box-shadow .08s; }
#signals .lamp.red { background: radial-gradient(circle at 35% 32%, #ffb3a8, #ff2a1f 45%, #9c0d07 100%);
  box-shadow: 0 0 18px 4px rgba(255,42,31,0.7), inset 0 -3px 6px rgba(0,0,0,0.35); }
#signals .lamp.green { background: radial-gradient(circle at 35% 32%, #d6ffd9, #33e05a 45%, #0b7a25 100%);
  box-shadow: 0 0 20px 5px rgba(51,224,90,0.7), inset 0 -3px 6px rgba(0,0,0,0.3); }
#signals .flag { display: none; flex-direction: column; align-items: center; gap: 8px; transition: opacity .4s; }
#signals .cloth { width: 132px; height: 84px; border-radius: 3px; transform-origin: left center;
  background: repeating-conic-gradient(#111 0 25%, #f4f4f4 0 50%) 0 0 / 22px 22px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.5); animation: flag-wave 0.9s ease-in-out infinite alternate; }
#signals .pole { position: absolute; left: -6px; top: -6px; width: 5px; height: 118px; border-radius: 3px; background: linear-gradient(90deg,#9aa0a8,#e6e8ea,#8a9098); }
#signals .flagbox { position: relative; padding-left: 4px; }
#signals .word { font: 900 22px Georgia, 'Times New Roman', serif; letter-spacing: .14em; color: #fff; padding: 6px 14px; border-radius: 8px;
  background: rgba(8,9,14,0.8); border: 1px solid rgba(255,255,255,0.14); text-shadow: 0 0 12px rgba(255,255,255,0.35); white-space: nowrap; }
#signals .word.win { color: #8ff0a8; border-color: rgba(88,214,141,0.6); }
@keyframes flag-wave { 0% { transform: perspective(300px) rotateY(0deg) skewY(-4deg); } 100% { transform: perspective(300px) rotateY(-22deg) skewY(4deg); } }
@media (max-width: 760px), (max-height: 500px) {
  #signals .lamp { width: 28px; height: 28px; }
  #signals .pod { gap: 10px; padding: 8px 12px; }
  #signals .cloth { width: 104px; height: 66px; background-size: 18px 18px; }
  #signals .pole { height: 96px; }
  #signals .word { font-size: 17px; }
}
@media (prefers-reduced-motion: reduce) { #signals .cloth { animation: none; } }
`;

const GO_HOLD = 0.9; // s the green lights stay on after GO
const FLAG_HOLD = 3.2; // s the flag stays up at the finish

export function mountSignals() {
  if (!document.getElementById('signals-style')) {
    const st = document.createElement('style');
    st.id = 'signals-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.id = 'signals';
  root.innerHTML = `<div class="pod" aria-label="Start lights"><div class="lamp"></div><div class="lamp"></div><div class="lamp"></div></div>
    <div class="flag" aria-label="Chequered flag"><div class="flagbox"><div class="pole"></div><div class="cloth"></div></div><div class="word"></div></div>`;
  document.body.appendChild(root);
  const pod = root.querySelector('.pod');
  const lamps = [...root.querySelectorAll('.lamp')];
  const flag = root.querySelector('.flag');
  const word = root.querySelector('.word');
  let prevState = null;
  let goT = 0;
  let flagT = 0;
  let lit = -1;

  const setLamps = (n, green) => {
    const key = green ? 99 : n;
    if (key === lit) return;
    lit = key;
    lamps.forEach((l, i) => {
      l.classList.toggle('green', green);
      l.classList.toggle('red', !green && i < n);
    });
  };

  return {
    el: root,
    /** Place the signals below `top` px (on phones the HUD band sits at the top). */
    setTop(px) {
      root.style.top = `${Math.round(px)}px`;
    },
    /**
     * @param {number} dt
     * @param {string|null} state race state, or null when no race is on screen (title, replay)
     * @param {number} countdown seconds left in the countdown
     * @param {() => string} resultText the line under the flag, read once when the race finishes
     * @param {() => boolean} won whether the winner is this player
     */
    update(dt, state, countdown, resultText, won) {
      if (state === 'COUNTDOWN') {
        // 3 s countdown, a beep at 3, 2 and 1: one more red light at each beep.
        pod.style.display = 'flex';
        pod.style.opacity = '1';
        setLamps(Math.min(3, Math.max(1, 4 - Math.ceil(countdown))), false);
        goT = 0;
      } else if (state === 'RACING' && (prevState === 'COUNTDOWN' || goT > 0)) {
        if (prevState === 'COUNTDOWN') goT = GO_HOLD + 0.5; // GO: all green, then fade out
        goT -= dt;
        setLamps(3, true);
        pod.style.display = 'flex';
        pod.style.opacity = goT > 0.5 ? '1' : '0';
        if (goT <= 0) {
          pod.style.display = 'none';
          goT = 0;
        }
      } else {
        pod.style.display = 'none';
      }
      if (state === 'FINISHED' && prevState === 'RACING') {
        flagT = FLAG_HOLD;
        word.textContent = resultText();
        word.classList.toggle('win', won());
      }
      if (flagT > 0 && state === 'FINISHED') {
        flagT -= dt;
        flag.style.display = 'flex';
        flag.style.opacity = flagT > 0.4 ? '1' : '0';
      } else {
        flagT = 0;
        flag.style.display = 'none';
      }
      prevState = state;
    },
  };
}
