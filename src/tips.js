/**
 * The first screen's message area, centred in the free space beside the title card:
 *  - no tip showing (the still title): the cursed GP logo;
 *  - the idle preview: a rotating "insert coin" tip in the pixel font. On big screens the logo stays above the tip.
 * It takes no clicks, and it hides during a race.
 */
const PIXEL_TIP_CSS = `
#tip-overlay { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 11; display: none; pointer-events: none;
  text-align: center; width: min(92vw, 720px); flex-direction: column; align-items: center; gap: 18px; }
#tip-overlay .logo { display: none; width: min(92vw, 840px); height: auto; image-rendering: auto; filter: drop-shadow(0 0 14px rgba(190,140,255,0.35)); }
/* The logo shows only on the still title, when no tip is on the canvas. It flickers in like a light coming on, then
   its glow breathes. (Restarts each time it appears, since the overlay's display changes.) */
#tip-overlay.idle .logo { display: block; animation: logo-in 1.8s steps(12, end) both, logo-glow 3.6s ease-in-out 1.8s infinite; }
@keyframes logo-in {
  0% { opacity: 0; filter: blur(14px) brightness(2.2); transform: scale(0.94); }
  30% { opacity: 0.35; filter: blur(6px) brightness(1.6); transform: scale(0.99); }
  45% { opacity: 0.05; }
  60% { opacity: 0.8; filter: blur(2px) brightness(1.3); }
  80% { opacity: 0.45; }
  100% { opacity: 1; filter: none; transform: scale(1); }
}
@keyframes logo-glow {
  0%, 100% { filter: drop-shadow(0 0 10px rgba(190,140,255,0.35)); }
  50% { filter: drop-shadow(0 0 26px rgba(190,140,255,0.7)) drop-shadow(0 0 60px rgba(120,60,255,0.35)); }
}
@media (prefers-reduced-motion: reduce) { #tip-overlay.idle .logo { animation: none; } }
#tip-overlay h1 { margin: 0; display: none; font-family: 'GP Pixel', monospace; font-weight: 400; font-size: 16px; line-height: 1.8; color: #ffd400;
  letter-spacing: 0; text-transform: uppercase; text-shadow: 0 0 6px rgba(255,212,0,0.7), 0 0 18px rgba(255,160,0,0.45), 3px 3px 0 rgba(0,0,0,0.6);
  animation: tip-blink 1.6s steps(1, end) infinite; }
#tip-overlay.tip h1 { display: block; }
@keyframes tip-blink { 0% { opacity: 1; } 70% { opacity: 1; } 85% { opacity: .35; } 100% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { #tip-overlay h1 { animation: none; } }
@media (max-width: 760px) { #tip-overlay h1 { font-size: 12px; } }
`;

const TIP_EVERY = 3.6; // s per tip

/** The tip list: `haunted` tips appear only in haunted mode. */
function tipsFor(haunted) {
  const list = [
    ['PRESS C TO CHANGE CAMERA'],
    ['TIP: YOU CAN RACE 1V1 ONLINE'],
    ['HOLD SPACE OR THE SCREEN TO GO'],
    ['TIP: USE [ AND ] TO CHANGE CIRCUIT'],
    ['TIP: VISIT THE GARAGE TO CHANGE YOUR CAR'],
  ];
  if (haunted) list.splice(1, 0, ['PRESS SHIFT TO FEND OFF AMENITIES'], ['TIP: SHIFT GIVES 3 SHIELDS PER LAP']);
  return list;
}

export function createTips() {
  const style = document.createElement('style');
  style.id = 'tip-style';
  style.textContent = PIXEL_TIP_CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'tip-overlay';
  el.setAttribute('aria-live', 'polite');
  const logo = document.createElement('img');
  logo.className = 'logo';
  logo.alt = 'Cursed GP';
  logo.src = `${import.meta.env.BASE_URL}cursedGP_logo.png`;
  const h1 = document.createElement('h1');
  el.append(logo, h1);
  document.body.appendChild(el);

  let t = 0;
  let index = -1;
  let shown = false;
  let lastText = '';
  let lastMode = '';
  return {
    /**
     * @param {number} dt
     * @param {boolean} on true while the title preview runs (the tips rotate)
     * @param {boolean} haunted the haunted setting
     * @param {() => {x:number,y:number,w:number,h:number}} areaFn the free area to centre in (the safe area)
     * @param {boolean} racing true during a race: nothing is shown
     */
    update(dt, on, haunted, areaFn, racing = false) {
      if (racing) {
        el.style.display = 'none';
        shown = false;
        return;
      }
      if (!on) {
        // The still title: the logo fills the message area; no tip.
        if (lastMode !== 'idle') {
          el.className = 'idle';
          lastMode = 'idle';
        }
        shown = false;
      } else {
        if (!shown) {
          shown = true;
          t = TIP_EVERY; // the first tip comes at once
          index = -1;
        }
        t += dt;
        const list = tipsFor(haunted);
        if (t >= TIP_EVERY) {
          t = 0;
          index = (index + 1) % list.length;
        }
        const [text] = list[Math.max(0, index) % list.length];
        if (text !== lastText) {
          lastText = text;
          h1.textContent = text;
        }
        const mode = 'tip';
        if (lastMode !== mode) {
          el.className = mode;
          lastMode = mode;
        }
      }
      const a = areaFn();
      el.style.left = `${Math.round(a.x + a.w / 2)}px`;
      el.style.top = `${Math.round(a.y + a.h / 2)}px`;
      el.style.display = 'flex';
    },
  };
}
