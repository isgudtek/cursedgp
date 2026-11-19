/**
 * Menus: title screen, garage, circuit chooser, online challenges, camera setup bar, results.
 */

const BTN_STYLE = {
  font: '700 13px monospace',
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid #2a3344',
  background: '#10151d',
  color: '#e8edf3',
  cursor: 'pointer',
};

function styleBtn(b, on) {
  Object.assign(b.style, BTN_STYLE);
  b.tabIndex = -1; // keeps Space (throttle) from activating a focused button
  if (on) {
    b.style.borderColor = '#58d68d';
    b.style.background = '#16351f';
  }
  return b;
}

/**
 * Results modal shown when a race finishes (desktop only; XR shows the result on the HUD).
 * @param {{ again: () => void, exit: () => void }} actions
 */
export function mountResults(actions) {
  const wrap = document.createElement('div');
  wrap.id = 'results';
  Object.assign(wrap.style, {
    position: 'fixed',
    inset: '0',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(5, 7, 10, 0.6)',
    zIndex: '20',
  });
  const card = document.createElement('div');
  Object.assign(card.style, {
    width: '360px',
    padding: '22px',
    borderRadius: '10px',
    background: '#10151d',
    border: '1px solid #2a3344',
    color: '#e8edf3',
    font: '600 15px monospace',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  });
  const title = document.createElement('div');
  title.style.font = '700 22px monospace';
  const table = document.createElement('div');
  Object.assign(table.style, { display: 'flex', flexDirection: 'column', gap: '4px', color: '#c9d1dc' });
  const buttons = document.createElement('div');
  Object.assign(buttons.style, { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' });
  const option = (label, fn) => {
    const b = styleBtn(document.createElement('button'), false);
    b.textContent = label;
    b.style.textAlign = 'center';
    b.addEventListener('click', () => {
      if (b.disabled) return;
      wrap.style.display = 'none';
      fn();
    });
    return b;
  };
  const againBtn = option('RACE AGAIN', actions.again);
  buttons.append(againBtn, option('EXIT TO MENU', actions.exit));
  card.append(title, table, buttons);
  wrap.appendChild(card);
  document.body.appendChild(wrap);

  const fmt = (t) => (t == null ? '--' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`);
  return {
    /** @param {{ againDisabled?: boolean, againLabel?: string }} [opts] online guests wait for the host's rematch */
    show(r, circuit, opts = {}) {
      againBtn.textContent = opts.againLabel || 'RACE AGAIN';
      againBtn.disabled = !!opts.againDisabled;
      againBtn.style.opacity = opts.againDisabled ? '0.5' : '1';
      const won = r.winner === 'player';
      title.textContent = r.mode === 'TT' ? 'TIME TRIAL COMPLETE' : won ? 'YOU WIN' : `${r.rivalName} WINS`;
      title.style.color = won || r.mode === 'TT' ? '#58d68d' : '#ff8b82';
      const rows = [
        ['Circuit', circuit],
        ['Laps', String(r.laps)],
        ['Winner', r.mode === 'TT' ? 'YOU' : won ? 'YOU' : r.rivalName],
        ['Your best lap', fmt(r.playerBest)],
        ...(r.mode === 'VS' ? [[`${r.rivalName} best lap`, fmt(r.rivalBest)]] : []),
        ['Total time', fmt(r.total)],
      ];
      table.replaceChildren(
        ...rows.map(([k, v]) => {
          const line = document.createElement('div');
          line.style.display = 'flex';
          line.style.justifyContent = 'space-between';
          line.innerHTML = `<span></span><b></b>`;
          line.firstChild.textContent = k;
          line.lastChild.textContent = v;
          return line;
        }),
      );
      wrap.style.display = 'flex';
    },
    hide() {
      wrap.style.display = 'none';
    },
  };
}

// ---------------------------------------------------------------- desktop title screen and in-race exit

const STYLE = `
#title { position: fixed; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 4vw; z-index: 12; pointer-events: none;
  font-family: Georgia, 'Times New Roman', serif; color: #e8e2f5; }
#title .card { pointer-events: auto; width: 340px; max-height: 96vh; overflow-y: auto; padding: 16px 16px 12px; border-radius: 16px;
  background: rgba(12,14,24,0.62); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 0 60px rgba(120,60,255,0.16); display: flex; flex-direction: column; gap: 9px; scrollbar-width: thin; }
#title .brand { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
#title h1 { margin: 0; font-size: 25px; letter-spacing: .12em; white-space: nowrap; color: #f1eaff; text-shadow: 0 0 16px rgba(170,110,255,0.5); }
#title .kicker { font: 600 9px monospace; letter-spacing: .28em; color: #8f86a8; text-transform: uppercase; }
#title button { font: 700 11px monospace; letter-spacing: .03em; padding: 7px 6px; border-radius: 8px; cursor: pointer; min-height: 32px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(20,22,34,0.8); color: #d8d0ea; transition: background .15s, border-color .15s; }
#title button:hover { border-color: rgba(190,140,255,0.6); }
#title button.on { background: rgba(92,46,160,0.6); border-color: #b48cff; color: #fff; }
#title button:disabled { opacity: .4; cursor: default; }
/* HAUNTED: black with a glowing yellow label and slime drips, spookier than the other chips. */
#title button[data-act=haunted] { position: relative; overflow: visible; background: #050505; border: 1px solid #3a3200; color: #ffd400;
  font-family: Georgia, 'Times New Roman', serif; font-style: italic; letter-spacing: .1em;
  text-shadow: 0 0 6px rgba(255,212,0,0.55), 0 1px 0 #000; box-shadow: inset 0 0 10px rgba(255,212,0,0.08); }
#title button[data-act=haunted]:hover { border-color: #ffd400; }
#title button[data-act=haunted].on { background: #000; border-color: #ffd400; color: #ffe95c;
  box-shadow: 0 0 14px rgba(255,212,0,0.35), inset 0 0 12px rgba(255,212,0,0.18); animation: haunt-flicker 3.2s infinite steps(1); }
#title button[data-act=haunted]::after { content: ''; position: absolute; left: 14%; right: 14%; top: 100%; height: 7px; pointer-events: none;
  background: radial-gradient(circle at 12% 0, #ffd400 0 2px, transparent 2.5px), radial-gradient(circle at 47% 0, #ffd400 0 1.5px, transparent 2px),
  radial-gradient(circle at 80% 0, #ffd400 0 2.5px, transparent 3px); opacity: .7; }
#title button[data-act=haunted]:not(.on)::after { opacity: .25; }
@keyframes haunt-flicker { 0%, 100% { opacity: 1; } 41% { opacity: .55; } 43% { opacity: 1; } 77% { opacity: .75; } 78% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { #title button[data-act=haunted].on { animation: none; } }
#title .circuit { display: grid; grid-template-columns: 30px 1fr 30px; align-items: center; gap: 6px; }
#title .circuit .arrow { height: 54px; padding: 0; font-size: 13px; }
#title .pv { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; line-height: 1.2; }
#title .pv canvas { width: 118px; height: 118px; border-radius: 8px; background: #0a0d12; display: block; }
#title .pv .name { font: 700 12px monospace; color: #e8e2f5; text-align: center; }
#garage-pop .gpick { display: grid; grid-template-columns: 34px 1fr 34px; align-items: center; gap: 8px; }
#garage-pop .gpick .arrow { height: 60px; padding: 0; font-size: 14px; border-radius: 8px; cursor: pointer; color: #e8e2f5; background: rgba(20,22,34,0.85); border: 1px solid rgba(190,140,255,0.45); }
#garage-pop .gpick .arrow:hover { border-color: #b48cff; }
#title .pv .all { font: 600 9px monospace; letter-spacing: .18em; color: #8f86a8; }
#title .sec { display: grid; grid-template-columns: 46px 1fr; align-items: center; gap: 8px; }
#title .lab { font: 700 9px monospace; letter-spacing: .2em; color: #8f86a8; }
#title .seg { display: flex; gap: 0; }
#title .seg button { flex: 1; border-radius: 0; margin-left: -1px; }
#title .seg button:first-child { border-radius: 8px 0 0 8px; margin-left: 0; }
#title .seg button:last-child { border-radius: 0 8px 8px 0; }
#title .seg button small { display: block; font-size: 9px; font-weight: 600; color: #a79cc4; letter-spacing: 0; }
#title .chips { display: flex; gap: 5px; flex-wrap: wrap; }
#title .chips > * { flex: 1 1 auto; }
#title .chips .seg { flex: 0 0 auto; }
#title .chips .seg button { padding: 7px 9px; }
#title .size { display: flex; align-items: center; gap: 4px; }
#title .size button { width: 30px; flex: 0 0 30px; padding: 0; font-size: 14px; }
#title .size span { flex: 1; text-align: center; font: 700 11px monospace; color: #c9bfe0; }
#title .car { text-align: left; padding-left: 10px; }
/* The rules row: laps, H/V, detail and car on one line, all small. */
#title .rules-row { display: flex; flex-wrap: nowrap; align-items: center; gap: 4px; }
#title .rules-row .laps-seg { flex: 0 0 auto; }
#title .rules-row .laps-seg button { font-size: 10px; padding: 5px 4px; min-width: 26px; line-height: 1.1; }
#title .rules-row .laps-seg small { font-size: 7px; letter-spacing: 0; }
#title .rules-row .mini { font: 700 10px monospace; padding: 5px 0; min-width: 28px; min-height: 28px; border-radius: 6px; flex: 0 0 auto; }
#title .start { font-size: 14px; padding: 12px; letter-spacing: .14em; background: linear-gradient(180deg,#5c2ea0,#3d1d6e); border-color: #b48cff; color: #fff; }
#title .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
#title .foot button { padding: 5px 9px; min-height: 0; font-size: 10px; color: #8f86a8; }
#title .foot .keys { font: 600 9px monospace; color: #6f6788; letter-spacing: .04em; }
#title .lobby-slot:empty { display: none; }
/* Online panel: on wide screens a card like the main one (#title .card), mirrored on the right. */
#lobby { flex-direction: column; gap: 9px; font-family: monospace; color: #e8e2f5; }
#lobby.card { pointer-events: auto; width: 340px; max-height: 96vh; overflow-y: auto; padding: 16px 16px 12px; border-radius: 16px; box-sizing: content-box;
  background: rgba(12,14,24,0.62); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 0 60px rgba(120,60,255,0.16); scrollbar-width: thin; }
#lobby .lhead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
#lobby h2 { margin: 0; font: 700 22px Georgia, 'Times New Roman', serif; letter-spacing: .12em; color: #f1eaff; text-shadow: 0 0 16px rgba(170,110,255,0.5); white-space: nowrap; }
#lobby .kicker { font: 600 9px monospace; letter-spacing: .28em; color: #8f86a8; text-transform: uppercase; }
#lobby .status { font: 600 11px monospace; color: #c9bfe0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
#lobby .status .msg { flex-basis: 100%; color: #a79cc4; font-weight: 500; line-height: 1.4; }
#lobby .dot { width: 8px; height: 8px; border-radius: 50%; background: #f5a623; box-shadow: 0 0 8px currentColor; color: #f5a623; }
#lobby .dot.live { background: #58d68d; color: #58d68d; }
#lobby .dot.down { background: #ff6b5e; color: #ff6b5e; }
#lobby .list { display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; overflow-y: auto; }
#lobby .empty { font: 600 11px monospace; color: #a79cc4; padding: 14px 10px; border-radius: 8px; text-align: center; border: 1px dashed rgba(255,255,255,0.14); }
#lobby .room { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(20,22,34,0.8); }
#lobby .room .info { flex: 1; min-width: 0; line-height: 1.35; }
#lobby .room .thumb { width: 52px; height: 52px; flex: 0 0 52px; border-radius: 6px; background: #0a0d12; display: block; }
#lobby.docked .room .thumb { width: 44px; height: 44px; flex-basis: 44px; }
#lobby .room .rt { font: 700 12px monospace; color: #e8e2f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#lobby .room .code { font-weight: 600; color: #8f86a8; font-size: 10px; }
#lobby .room .rs { font: 600 10px monospace; color: #a79cc4; }
#lobby button { font: 700 11px monospace; letter-spacing: .03em; padding: 7px 10px; border-radius: 8px; cursor: pointer; min-height: 32px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(20,22,34,0.8); color: #d8d0ea; transition: background .15s, border-color .15s; }
#lobby button:hover { border-color: rgba(190,140,255,0.6); }
#lobby button.on { background: rgba(92,46,160,0.6); border-color: #b48cff; color: #fff; }
#lobby button:disabled { opacity: .45; cursor: default; }
#lobby .create { font-size: 14px; padding: 12px; letter-spacing: .14em; background: linear-gradient(180deg,#5c2ea0,#3d1d6e); border-color: #b48cff; color: #fff; }
#lobby .create.closing { background: rgba(20,22,34,0.85); border-color: rgba(255,139,130,0.6); color: #ffb4ad; }
#lobby .hint { font: 600 9px monospace; color: #6f6788; line-height: 1.5; letter-spacing: .02em; }
/* Phones: inside the main card, no card chrome of its own. */
#lobby.docked { gap: 7px; }
#lobby.docked .lhead, #lobby.docked .hint { display: none; }
#lobby.docked .list { max-height: 30vh; }
@media (max-width: 760px) {
  #title { align-items: flex-end; padding: 0; }
  #title .card { width: 100%; box-sizing: border-box; max-height: 70vh; border-radius: 16px 16px 0 0; padding: 12px 12px 10px;
    padding-bottom: max(10px, env(safe-area-inset-bottom)); gap: 8px; }
  #title h1 { font-size: 21px; }
  #title .pv canvas { width: 84px; height: 84px; }
  #title .circuit .arrow { height: 44px; }
  #title button { min-height: 36px; } /* finger-sized */
  #title .foot .keys { display: none; }
}
#garage-pop .garage { display: flex; flex-direction: column; gap: 8px; }
#garage-pop .garage .gh { font: 700 11px monospace; letter-spacing: .2em; color: #8f86a8; }
#garage-pop .garage .gh span { letter-spacing: 0; color: #6f6788; font-weight: 400; }
#garage-pop .gname { font: 700 14px monospace; letter-spacing: .12em; text-align: center; color: #f4f6ff; margin: 2px 0 6px; }
#garage-pop .gcars button { font-size: 10px; padding: 7px 4px; letter-spacing: 0; }
#garage-pop .gprev canvas { width: 100%; height: auto; display: block; border-radius: 10px; background: #0a0d12; border: 1px solid rgba(255,255,255,0.08); }
#garage-pop .gstats { display: flex; flex-direction: column; gap: 5px; }
#garage-pop .gstats .srow { display: flex; align-items: center; gap: 8px; font: 700 11px monospace; color: #c9bfe0; }
#garage-pop .gstats .lab { width: 52px; }
#garage-pop .gstats .bar { flex: 1; height: 8px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; }
#garage-pop .gstats .fill { height: 100%; background: linear-gradient(90deg, #7b4bd6, #c49bff); transition: width .3s; }
#chooser { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 30;
  background: rgba(5,6,10,0.7); font-family: monospace; }
#chooser .box { width: min(640px, 92vw); max-height: 80vh; overflow: auto; padding: 22px; border-radius: 14px;
  background: rgba(12,14,24,0.92); border: 1px solid rgba(255,255,255,0.08); color: #e8e2f5; }
#chooser .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
#chooser h2 { margin: 0; font: 700 16px Georgia, serif; letter-spacing: .12em; }
#chooser .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
#chooser button { padding: 4px; border-radius: 8px; cursor: pointer; line-height: 0;
  border: 1px solid rgba(255,255,255,0.1); background: rgba(20,22,34,0.8); color: #d8d0ea; }
#chooser button:hover { border-color: rgba(190,140,255,0.6); }
#chooser button.on { background: rgba(92,46,160,0.6); border-color: #b48cff; color: #fff; }
#chooser .close { padding: 6px 12px; }
#garage-pop { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 30;
  background: rgba(5,6,10,0.7); font-family: monospace; }
#garage-pop .box { width: min(380px, 92vw); max-height: 88vh; overflow: auto; padding: 22px; border-radius: 14px;
  background: rgba(12,14,24,0.92); border: 1px solid rgba(255,255,255,0.08); color: #e8e2f5; }
#garage-pop .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
#garage-pop h2 { margin: 0; font: 700 16px Georgia, serif; letter-spacing: .12em; }
#garage-pop .gcars button { font: 700 11px monospace; padding: 8px 4px; border-radius: 8px; cursor: pointer; flex: 1;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(20,22,34,0.8); color: #d8d0ea; }
#garage-pop .gcars button.on { background: rgba(92,46,160,0.6); border-color: #b48cff; color: #fff; }
#garage-pop .close { font: 700 12px monospace; padding: 6px 12px; border-radius: 8px; cursor: pointer; background: rgba(20,22,34,0.8); color: #d8d0ea; border: 1px solid rgba(255,255,255,0.12); }
#setup-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 8; display: none;
  flex-direction: column; align-items: center; gap: 8px; padding: 12px 16px; border-radius: 12px;
  background: rgba(12,14,24,0.75); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.1); font-family: monospace; color: #e8e2f5; }
#setup-bar .hint { font-size: 11px; color: #a79cc4; text-align: center; }
#setup-bar .btns { display: flex; gap: 8px; }
#setup-bar button { font: 700 13px monospace; padding: 10px 14px; border-radius: 8px; cursor: pointer; color: #e8e2f5;
  border: 1px solid rgba(190,140,255,0.5); background: rgba(20,22,34,0.85); }
#setup-bar button.ready { background: linear-gradient(180deg,#5c2ea0,#3d1d6e); border-color: #b48cff; letter-spacing: .08em; }
`;

/**
 * Title screen: circuit, play mode (SOLO / VS AI / ONLINE), rival, rules, car, START. Mobile first: on narrow
 * screens it becomes a bottom sheet with finger-sized controls.
 * @param {{ prev, next, pick, scale, setPlay, setRival, setLaps, start, toggleSound }} actions
 * @param {(canvas: HTMLCanvasElement, index: number, state: string) => void} drawPreview
 * @param {{ label: string, name: string }[]} circuits
 */
export function mountTitle(actions, drawPreview, circuits, garage) {
  if (!document.getElementById('phantom-style')) {
    const st = document.createElement('style');
    st.id = 'phantom-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.id = 'title';
  // Grouped by what goes together: the circuit; how you play (SOLO, VS AI and ONLINE exclude each other, and the
  // rival only exists for VS AI); the race rules; your car; then START.
  root.innerHTML = `
    <div class="card">
      <div class="brand"><span class="kicker">Midnight circuit</span></div>
      <div class="circuit">
        <button class="arrow" data-act="prev" aria-label="Previous circuit">&#9664;</button>
        <button class="pv" data-act="choose" aria-label="All circuits">
          <canvas width="240" height="240"></canvas>
          <span class="name"></span><span class="all">ALL CIRCUITS &#9662;</span>
        </button>
        <button class="arrow" data-act="next" aria-label="Next circuit">&#9654;</button>
      </div>
      <div class="sec"><span class="lab">PLAY</span>
        <div class="seg" data-group="play">
          <button data-value="solo">SOLO<small>time trial</small></button>
          <button data-value="ai">VS AI<small>rival</small></button>
          <button data-value="online">ONLINE<small>1v1</small></button>
        </div>
      </div>
      <div class="lobby-slot"></div>
      <div class="sec rival-sec"><span class="lab">RIVAL</span>
        <div class="seg" data-group="rival">
          <button data-value="rookie">SPECTER<small>rookie</small></button>
          <button data-value="pro">BANSHEE<small>pro</small></button>
          <button data-value="maniac">REAPER<small>maniac</small></button>
        </div>
      </div>
      <div class="sec rules-sec"><span class="lab">RULES</span>
        <div class="chips rules-row">
          <div class="seg laps-seg" data-group="laps"><button data-value="1">1<small>laps</small></button><button data-value="3">3<small>laps</small></button><button data-value="5">5<small>laps</small></button><button data-value="8">8<small>laps</small></button><button data-value="10">10<small>laps</small></button></div>
          <button class="mini" data-act="haunted" title="Haunted (H) or vanilla (V)"></button>
          <button class="mini" data-act="quality" title="Track detail: L, M or H"></button>
          <button class="mini" data-act="garage" title="Choose your car"></button>
        </div>
      </div>
      <button class="start" data-act="start">START RACE</button>
      <div class="foot"><button data-act="sound"></button><span class="keys">SPACE throttle · C camera · M sound</span></div>
    </div>`;
  document.body.appendChild(root);
  const q = (sel) => root.querySelector(sel);
  const preview = q('canvas');
  q('[data-act=prev]').addEventListener('click', () => actions.prev());
  q('[data-act=next]').addEventListener('click', () => actions.next());
  q('[data-act=start]').addEventListener('click', () => actions.start());

  // CHOOSE popup: every circuit as a button.
  const chooser = document.createElement('div');
  chooser.id = 'chooser';
  chooser.innerHTML = `<div class="box">
    <div class="head"><h2>CHOOSE A CIRCUIT</h2><button class="close">CLOSE</button></div>
    <div class="grid"></div></div>`;
  document.body.appendChild(chooser);
  const grid = chooser.querySelector('.grid');
  const closeChooser = () => (chooser.style.display = 'none');
  // Each circuit is drawn as its outline tile, the same style as the in-game picker.
  const thumbs = circuits.map((c, i) => {
    const b = document.createElement('button');
    b.dataset.index = String(i);
    b.title = c.name;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    cv.style.width = cv.style.height = '86px';
    cv.style.display = 'block';
    drawPreview(cv, i, 'idle');
    b.appendChild(cv);
    b.addEventListener('click', () => {
      closeChooser();
      actions.pick(i);
    });
    grid.appendChild(b);
    return { b, cv };
  });
  let thumbIndex = -1; // circuit whose tile is drawn as active
  chooser.querySelector('.close').addEventListener('click', closeChooser);
  chooser.addEventListener('click', (e) => {
    if (e.target === chooser) closeChooser();
  });
  q('[data-act=choose]').addEventListener('click', () => (chooser.style.display = 'flex'));

  // Garage popup: three car buttons, the turning preview, and stat bars for the selected car.
  const garagePop = document.createElement('div');
  garagePop.id = 'garage-pop';
  garagePop.innerHTML = `<div class="box">
    <div class="head"><h2>GARAGE</h2><button class="close">CLOSE</button></div>
    <div class="garage">
      <div class="gh">YOUR CAR <span>(the rival picks another)</span></div>
      <div class="gname"></div>
      <div class="gpick">
        <button class="arrow" data-g="prev" aria-label="Previous car">&#9664;</button>
        <div class="gprev"></div>
        <button class="arrow" data-g="next" aria-label="Next car">&#9654;</button>
      </div>
      <div class="gstats"></div>
    </div></div>`;
  document.body.appendChild(garagePop);
  const gq = (sel) => garagePop.querySelector(sel);
  gq('[data-g=prev]').addEventListener('click', () => actions.cycleCar(-1));
  gq('[data-g=next]').addEventListener('click', () => actions.cycleCar(1));
  garagePop.querySelector('.close').addEventListener('click', () => (garagePop.style.display = 'none'));
  garagePop.addEventListener('click', (e) => {
    if (e.target === garagePop) garagePop.style.display = 'none';
  });
  q('[data-act=garage]').addEventListener('click', () => (garagePop.style.display = 'flex'));
  const gname = gq('.gname');
  gq('.gprev').appendChild(garage.canvas);
  const statRows = {};
  const gstats = gq('.gstats');
  for (const [key, label] of [['top', 'TOP SPEED'], ['accel', 'ACCEL'], ['grip', 'CORNER GRIP']]) {
    const row = document.createElement('div');
    row.className = 'srow';
    row.innerHTML = `<span class="lab">${label}</span><div class="bar"><div class="fill"></div></div>`;
    gstats.appendChild(row);
    statRows[key] = row.querySelector('.fill');
  }
  q('[data-act=sound]').addEventListener('click', () => actions.toggleSound());
  q('[data-act=haunted]').addEventListener('click', () => actions.toggleHaunted());
  q('[data-act=quality]').addEventListener('click', () => actions.cycleQuality());

  for (const [group, fn] of [['play', actions.setPlay], ['rival', actions.setRival], ['laps', actions.setLaps]]) {
    root.querySelectorAll(`[data-group=${group}] button`).forEach((b) =>
      b.addEventListener('click', () => fn(group === 'laps' ? Number(b.dataset.value) : b.dataset.value)),
    );
  }
  const groupButtons = (group) => [...root.querySelectorAll(`[data-group=${group}] button`)];
  let drawnIndex = -2;
  return {
    el: root,
    /** On small screens the challenges list sits inside the card, under PLAY. */
    lobbySlot: q('.lobby-slot'),
    show(on) {
      root.style.display = on ? 'flex' : 'none';
    },
    /** @param {{ index: number, name: string, mode: string, rivalKey: string, laps: number, busy: boolean, muted: boolean, rivalsEnabled: boolean }} s */
    refresh(s) {
      if (drawnIndex !== s.index) {
        drawPreview(preview, s.index);
        drawnIndex = s.index;
      }
      q('.name').textContent = s.name;
      if (thumbIndex !== s.index) {
        if (thumbIndex >= 0) drawPreview(thumbs[thumbIndex].cv, thumbIndex, 'idle');
        drawPreview(thumbs[s.index].cv, s.index, 'active');
        thumbIndex = s.index;
      }
      grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.index) === s.index));
      const play = s.online ? 'online' : s.mode === 'TT' ? 'solo' : 'ai';
      for (const b of groupButtons('play')) b.classList.toggle('on', b.dataset.value === play);
      q('.rival-sec').style.display = play === 'ai' ? '' : 'none'; // the rival only exists against the AI
      for (const b of groupButtons('rival')) {
        b.classList.toggle('on', b.dataset.value === s.rivalKey);
        b.disabled = !s.rivalsEnabled || s.busy;
        b.style.opacity = s.rivalsEnabled ? '1' : '0.4';
      }
      for (const b of groupButtons('laps')) b.classList.toggle('on', Number(b.dataset.value) === s.laps);
      for (const b of groupButtons('play')) b.disabled = s.busy;
      for (const b of groupButtons('laps')) b.disabled = s.busy;
      const net = s.net || { role: null, session: false };
      const startBtn = q('[data-act=start]');
      startBtn.disabled = s.busy || net.role === 'guest' || (s.online && s.hosting && !net.session);
      startBtn.textContent = net.role === 'guest' ? 'WAITING FOR THE HOST...' : s.online && s.hosting && !net.session ? 'WAITING FOR AN OPPONENT...' : net.session ? 'START ONLINE RACE' : 'START RACE';
      // In a session the host's settings rule: the guest cannot change them, and nobody races the AI.
      const locked = net.role === 'guest' || !!s.hosting; // a guest plays the host's settings; a host's room is declared
      for (const sel of ['[data-act=prev]', '[data-act=next]', '[data-act=choose]', '[data-act=haunted]']) q(sel).disabled = locked || s.busy;
      for (const b of groupButtons('laps')) b.disabled = b.disabled || locked;
      for (const b of groupButtons('rival')) b.disabled = b.disabled || net.session;
      q('[data-act=sound]').textContent = s.muted ? 'SOUND OFF' : 'SOUND ON';
      q('[data-act=quality]').textContent = (s.quality || 'medium')[0].toUpperCase();
      const h = q('[data-act=haunted]');
      h.textContent = s.haunted ? 'H' : 'V';
      h.classList.toggle('on', !!s.haunted);
      const chosen = garage.models.find((m) => m.key === s.playerModel);
      q('[data-act=garage]').textContent = 'GARAGE';
      gname.textContent = chosen.name; // the selected car's name, under the arrows' preview
      q('[data-act=garage]').disabled = !!s.hosting;
      for (const k of ['top', 'accel', 'grip']) statRows[k].style.width = `${chosen.stats[k]}%`;
    },
  };
}

/**
 * Online panel. On wide screens it is a second card on the right of the title screen, in the same style and width
 * as the main card and mirrored to it. On phones it sits inside the main card under PLAY.
 * Lists open rooms with JOIN (or FULL), and CREATE NEW / CLOSE ROOM.
 * @param {{ create: () => void, closeRoom: () => void, join: (code: string) => void }} actions
 */
export function mountLobby(actions, drawPreview) {
  const wrap = document.createElement('div');
  wrap.id = 'lobby';
  wrap.style.display = 'none';
  wrap.innerHTML = `
    <div class="lhead"><h2>ONLINE 1V1</h2><span class="kicker">Open challenges</span></div>
    <div class="status"></div>
    <div class="list"></div>
    <button type="button" class="create"></button>
    <div class="hint">Create a room with your settings, or join one: the host's circuit, sky, laps and haunted mode apply.</div>`;
  document.body.appendChild(wrap);
  const q = (sel) => wrap.querySelector(sel);
  const status = q('.status');
  const list = q('.list');
  const create = q('.create');
  create.tabIndex = -1;
  create.addEventListener('click', () => {
    if (create.dataset.mode === 'close') actions.closeRoom();
    else actions.create();
    create.blur();
  });

  const CONNECTION = {
    off: ['connecting...', 'wait'],
    connecting: ['connecting...', 'wait'],
    connected: ['live', 'live'],
    disconnected: ['reconnecting...', 'wait'],
    suspended: ['offline, retrying', 'down'],
    failed: ['connection failed', 'down'],
    closed: ['closed', 'down'],
    nokey: ['no Ably key', 'down'],
  };

  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = 'No open challenges. Create one.';
  list.appendChild(empty);
  const rowsByCode = new Map();
  function makeRow(code) {
    const el = document.createElement('div');
    el.className = 'room';
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 96;
    thumb.className = 'thumb';
    const info = document.createElement('div');
    info.className = 'info';
    const title = document.createElement('div');
    title.className = 'rt';
    const name = document.createElement('span');
    const tag = document.createElement('span');
    tag.className = 'code';
    tag.textContent = `  #${code}`;
    title.append(name, tag);
    const sub = document.createElement('div');
    sub.className = 'rs';
    info.append(title, sub);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      actions.join(code);
      btn.blur();
    });
    el.append(thumb, info, btn);
    return { el, name, sub, btn, thumb, ci: -1 };
  }

  return {
    show: (on) => (wrap.style.display = on ? 'flex' : 'none'),
    /**
     * Phones: inside `slot` (the main card). Wide screens: a card of its own inside `pane` (the title layer), so it
     * shows and hides with the title screen and sits opposite the main card.
     */
    dock(slot, pane) {
      const docked = !!slot;
      (docked ? slot : pane).appendChild(wrap);
      wrap.classList.toggle('docked', docked);
      wrap.classList.toggle('card', !docked);
    },
    /** Match the main card's height, so the two cards are symmetric. */
    matchHeight(px) {
      wrap.style.minHeight = wrap.classList.contains('card') && px ? `${px}px` : '';
    },
    /** @param {object} s snapshot from createLobby() */
    render(s) {
      const hosting = s.hosting;
      const [conn, cls] = CONNECTION[s.connection] ?? [s.connection, 'wait'];
      status.innerHTML = '';
      const dot = document.createElement('span');
      dot.className = `dot ${cls}`;
      const line = document.createElement('span');
      line.textContent = `ONLINE: ${conn}`;
      status.append(dot, line);
      if (s.message) {
        const m = document.createElement('div');
        m.className = 'msg';
        m.textContent = s.message;
        status.appendChild(m);
      }
      create.textContent = hosting ? `CLOSE ROOM ${hosting}` : 'CREATE NEW';
      create.dataset.mode = hosting ? 'close' : 'open';
      create.classList.toggle('closing', !!hosting);
      create.disabled = s.connection === 'nokey' || !!s.joined;

      // Rows are kept per room and updated in place. Rebuilding them on every heartbeat would replace a
      // JOIN button between mouse down and mouse up, and the click would be lost.
      empty.style.display = s.rooms.length ? 'none' : 'block';
      const seen = new Set();
      let prev = empty;
      for (const r of s.rooms) {
        seen.add(r.code);
        let row = rowsByCode.get(r.code);
        if (!row) {
          row = makeRow(r.code);
          rowsByCode.set(r.code, row);
        }
        row.name.textContent = r.circuit;
        if (row.ci !== r.ci) {
          drawPreview(row.thumb, r.ci); // the room's circuit outline
          row.ci = r.ci;
        }
        // The host's choices, as picked on its title screen: sky, laps, haunted, car.
        row.sub.textContent = [r.day ? 'day' : 'night', `${r.laps} laps`, r.haunted ? 'haunted' : null, r.car || null].filter(Boolean).join(' \u00b7 ');
        const canJoin = r.joinable && !hosting && !s.joined;
        if (r.hostId === s.clientId) row.btn.innerHTML = 'WAITING<br>FOR OPPONENT'; // a fixed string, not user text
        else row.btn.textContent = r.joinable ? 'JOIN' : 'FULL';
        row.btn.disabled = !canJoin;
        row.btn.classList.toggle('on', canJoin);
        if (prev.nextSibling !== row.el) list.insertBefore(row.el, prev.nextSibling);
        prev = row.el;
      }
      for (const [code, row] of rowsByCode) {
        if (!seen.has(code)) {
          row.el.remove();
          rowsByCode.delete(code);
        }
      }
    },
  };
}

/** Bottom bar for the camera setup step: READY TO RACE and BACK. */
export function mountSetupBar(onReady, onBack) {
  if (!document.getElementById('phantom-style')) {
    const st = document.createElement('style');
    st.id = 'phantom-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  const bar = document.createElement('div');
  bar.id = 'setup-bar';
  bar.innerHTML = `
    <div class="hint">Online race: press READY. The countdown starts when both players are ready.</div>
    <div class="btns"><button class="back">BACK</button><button class="ready">READY TO RACE</button></div>`;
  document.body.appendChild(bar);
  const readyBtn = bar.querySelector('.ready');
  readyBtn.addEventListener('click', () => {
    if (!readyBtn.disabled) onReady();
  });
  bar.querySelector('.back').addEventListener('click', () => onBack());
  return {
    show: (on) => (bar.style.display = on ? 'flex' : 'none'),
    /** Online: READY was pressed, now waiting for the other player. */
    waiting(on) {
      readyBtn.disabled = on;
      readyBtn.textContent = on ? 'WAITING FOR OPPONENT...' : 'READY TO RACE';
      readyBtn.style.opacity = on ? '0.7' : '1';
    },
  };
}
