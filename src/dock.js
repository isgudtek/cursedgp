/**
 * Race dock: three round buttons in the bottom-right corner, replacing the old key-hint block and the camera panel.
 *   (i)   instructions overlay (and EXIT TO MENU)
 *   (cam) a vertical menu of round camera buttons: modes and preset viewpoints, plus the cockpit TVs
 *   (spk) sound on / off
 */

const ICON = {
  info: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="7" r="1.6" fill="currentColor"/><path d="M12 11v7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 8h3l1.6-2h6.8L17 8h3v10H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  on: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 10h4l5-4v12l-5-4H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  off: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 10h4l5-4v12l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

const STYLE = `
#dock { position: fixed; right: 12px; bottom: 12px; z-index: 9; display: none; gap: 10px; align-items: flex-end; font-family: monospace; }
#dock .rb { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; padding: 0;
  color: #e8e2f5; background: rgba(12,14,24,0.72); border: 1px solid rgba(190,140,255,0.45);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 4px 16px rgba(0,0,0,0.35); transition: background .15s, border-color .15s, transform .1s; }
#dock .rb:hover { border-color: #b48cff; }
#dock .rb:active { transform: scale(0.94); }
#dock .rb.on { background: rgba(92,46,160,0.75); border-color: #b48cff; }
#dock .rb.muted { color: #ff8b82; border-color: rgba(255,139,130,0.6); }
#dock .camwrap { position: relative; }
#dock .cammenu { position: absolute; right: 2px; bottom: 58px; display: none; flex-direction: column-reverse; flex-wrap: wrap-reverse; align-content: flex-end;
  gap: 8px; max-height: calc(100vh - 90px); }
#dock .cammenu.open { display: flex; }
#dock .item { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
#dock .item .lab { font: 700 11px monospace; letter-spacing: .06em; padding: 5px 8px; border-radius: 6px; white-space: nowrap;
  color: #e8e2f5; background: rgba(12,14,24,0.82); border: 1px solid rgba(255,255,255,0.1); pointer-events: none; }
#dock .item .rb { width: 42px; height: 42px; font: 700 11px monospace; letter-spacing: .02em; }
#dock .sep { height: 1px; width: 42px; align-self: flex-end; background: rgba(255,255,255,0.14); margin: 2px 0; }
#help-pop { position: fixed; inset: 0; z-index: 30; display: none; align-items: center; justify-content: center; background: rgba(5,6,10,0.6); font-family: monospace; }
#help-pop .box { width: min(440px, 92vw); max-height: 86vh; overflow: auto; padding: 20px; border-radius: 14px; box-sizing: border-box;
  background: rgba(12,14,24,0.94); border: 1px solid rgba(255,255,255,0.08); color: #e8e2f5; }
#help-pop .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
#help-pop h2 { margin: 0; font: 700 16px Georgia, serif; letter-spacing: .12em; }
#help-pop .x { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: #e8e2f5; background: rgba(20,22,34,0.85); border: 1px solid rgba(255,255,255,0.14); }
#help-pop h3 { margin: 14px 0 6px; font: 700 10px monospace; letter-spacing: .22em; color: #8f86a8; }
#help-pop .row { display: grid; grid-template-columns: 120px 1fr; gap: 8px; font-size: 12px; line-height: 1.5; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
#help-pop .row b { color: #f1eaff; }
#help-pop kbd { font: 700 11px monospace; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); }
#help-pop .acts { display: flex; gap: 8px; margin-top: 16px; position: sticky; bottom: -20px; padding: 10px 0 2px; background: rgba(12,14,24,0.96); }
#help-pop .acts button { flex: 1; font: 700 12px monospace; letter-spacing: .08em; padding: 11px; border-radius: 8px; cursor: pointer; color: #e8e2f5;
  background: rgba(20,22,34,0.85); border: 1px solid rgba(255,255,255,0.14); }
#help-pop .acts .primary { background: linear-gradient(180deg,#5c2ea0,#3d1d6e); border-color: #b48cff; color: #fff; }
/* Short screens (a phone on its side): the camera menu becomes a grid of columns, filled top to bottom. */
@media (max-height: 560px) {
  #dock .cammenu.open { display: grid; grid-auto-flow: column; grid-template-rows: repeat(5, auto); gap: 6px 14px; max-height: none; }
  #dock .sep { display: none; }
  #help-pop .box { padding: 14px 16px; }
  #help-pop h3 { margin: 8px 0 4px; }
  #help-pop .row { font-size: 11px; line-height: 1.35; }
}
@media (max-width: 760px), (max-height: 500px) {
  #dock { right: 10px; bottom: 10px; gap: 8px; }
  #dock .rb { width: 44px; height: 44px; }
  #dock .item .rb { width: 40px; height: 40px; }
  #dock .cammenu { bottom: 52px; gap: 6px; }
}
`;

function rb(html, title) {
  const b = document.createElement('button');
  b.className = 'rb';
  b.type = 'button';
  b.tabIndex = -1; // Space is the throttle: never press a focused button with it
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = html;
  return b;
}

/**
 * @param {{
 *   items: { id: string, short: string, label: string, act: () => void, isOn: () => boolean, sep?: boolean }[],
 *   toggleSound: () => void, isMuted: () => boolean, exit: () => void,
 * }} o
 */
export function mountDock(o) {
  if (!document.getElementById('dock-style')) {
    const st = document.createElement('style');
    st.id = 'dock-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  const dock = document.createElement('div');
  dock.id = 'dock';
  const info = rb(ICON.info, 'Instructions');
  info.dataset.dock = 'info';
  const camWrap = document.createElement('div');
  camWrap.className = 'camwrap';
  const cam = rb(ICON.cam, 'Cameras');
  cam.dataset.dock = 'cam';
  const menu = document.createElement('div');
  menu.className = 'cammenu';
  camWrap.append(menu, cam);
  const sound = rb(ICON.on, 'Sound on / off');
  sound.dataset.dock = 'sound';
  dock.append(info, camWrap, sound);
  document.body.appendChild(dock);

  // Camera menu: one round button per entry, with its name beside it. column-reverse keeps the first entry nearest the
  // camera button; wrap-reverse adds a second column when a short screen (a phone on its side) runs out of height.
  const entries = o.items.map((it) => {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'sep';
      menu.appendChild(s);
      return null;
    }
    const row = document.createElement('div');
    row.className = 'item';
    const lab = document.createElement('span');
    lab.className = 'lab';
    lab.textContent = it.label;
    const b = rb(`<span>${it.short}</span>`, it.label);
    b.dataset.cam = it.id;
    b.addEventListener('click', () => {
      it.act();
      refresh();
      if (!it.keepOpen) setMenu(false);
    });
    row.append(lab, b);
    menu.appendChild(row);
    return { it, b };
  }).filter(Boolean);

  const setMenu = (open) => {
    menu.classList.toggle('open', open);
    cam.classList.toggle('on', open);
  };
  cam.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
  // A tap anywhere else closes the menu (the tap still drives the car).
  window.addEventListener('pointerdown', (e) => {
    if (menu.classList.contains('open') && !camWrap.contains(e.target)) setMenu(false);
  }, true);

  sound.addEventListener('click', () => {
    o.toggleSound();
    refresh();
  });

  // Instructions overlay.
  const pop = document.createElement('div');
  pop.id = 'help-pop';
  pop.innerHTML = `<div class="box" role="dialog" aria-label="Instructions">
    <div class="head"><h2>HOW TO RACE</h2><button class="x" type="button" aria-label="Close">${ICON.close}</button></div>
    <h3>DRIVE</h3>
    <div class="row"><b>Throttle</b><span>Slide a finger or the mouse up and down anywhere: low is slow, high is fast. Keys: hold <kbd>Space</kbd> or <kbd>&uarr;</kbd>. Gamepad: <kbd>RT</kbd>.</span></div>
    <div class="row"><b>Grip</b><span>The bar on the screen edge shows your throttle. Amber and red mean the next bend will throw you off the slot: ease off.</span></div>
    <div class="row"><b>De-slotted</b><span>The car is put back on the slot after 1.5 s.</span></div>
    <h3>CAMERAS</h3>
    <div class="row"><b>Camera button</b><span>OVERVIEW (whole track), TV (trackside cameras), CHASE (behind your car), FREE, and preset views. <kbd>C</kbd> cycles the modes.</span></div>
    <div class="row"><b>Free camera</b><span>Two fingers, or right-drag, rotate. Pinch or the wheel zooms. Middle-drag or <kbd>Shift</kbd>-drag pans.</span></div>
    <h3>MORE</h3>
    <div class="row"><b>Find your car</b><span>A yellow arrow points at your car at the start. Press <kbd>I</kbd> (or the arrow button on a phone) to show it again.</span></div>
    <div class="row"><b>Sound</b><span>The speaker button, or <kbd>M</kbd>.</span></div>
    <div class="row"><b>Menu</b><span>EXIT TO MENU below, or <kbd>Esc</kbd>.</span></div>
    <div class="acts"><button type="button" class="exit">EXIT TO MENU</button><button type="button" class="primary resume">RESUME</button></div>
  </div>`;
  document.body.appendChild(pop);
  const showHelp = (on) => (pop.style.display = on ? 'flex' : 'none');
  info.addEventListener('click', () => showHelp(true));
  pop.querySelector('.x').addEventListener('click', () => showHelp(false));
  pop.querySelector('.resume').addEventListener('click', () => showHelp(false));
  pop.querySelector('.exit').addEventListener('click', () => {
    showHelp(false);
    o.exit();
  });
  pop.addEventListener('click', (e) => {
    if (e.target === pop) showHelp(false);
  });

  function refresh() {
    for (const { it, b } of entries) b.classList.toggle('on', !!it.isOn());
    const muted = o.isMuted();
    sound.innerHTML = muted ? ICON.off : ICON.on;
    sound.classList.toggle('muted', muted);
    sound.title = muted ? 'Sound off (tap to turn on)' : 'Sound on (tap to mute)';
  }
  refresh();

  return {
    el: dock,
    show(on) {
      dock.style.display = on ? 'flex' : 'none';
      if (!on) {
        setMenu(false);
        showHelp(false);
      }
    },
    refresh,
    /** Esc first closes an open overlay or menu; returns true if it did. */
    closeOverlays() {
      const open = pop.style.display === 'flex' || menu.classList.contains('open');
      showHelp(false);
      setMenu(false);
      return open;
    },
    get helpOpen() {
      return pop.style.display === 'flex';
    },
  };
}
