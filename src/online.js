import { NET, RACE_CODE, packCar, readSnapshot, SnapBuffer, ownTarget, roundTrip, reconcileOwn } from './netsync.js';

/**
 * Online 1v1 session on top of the lobby. The host runs the race (physics, laps, monsters, results) and
 * streams snapshots. The guest drives its own car locally and corrects it toward the host's state, and
 * draws the host's car from an interpolation buffer. See netsync.js for the maths.
 *
 *   ctl channel  : cfg setup ready begin exit            (low rate, reliable enough for a menu flow)
 *   fast channel : snap (host -> guest)  thr (guest -> host)
 */

const STATES = ['READY', 'COUNTDOWN', 'RACING', 'FINISHED'];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const nowSec = () => performance.now() / 1000;

function carView(c) {
  const p = c.mesh.position;
  const q = c.mesh.quaternion;
  return { u: c.u, speed: c.speed, state: c.state, penalty: c.penalty, safeRatio: c.safeRatio, webbed: c.webbed, boostT: c.boostT, blinkT: c.blinkT, lane: c.lane, offset: c.offset, px: p.x, py: p.y, pz: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
}

/**
 * @param {{
 *  lobby: ReturnType<import('./lobby.js').createLobby>,
 *  race: import('./race.js').RaceController,
 *  player: import('./car.js').Car, rival: import('./car.js').Car,
 *  audio: object, sparks: object,
 *  getTrack: () => object,
 *  getCfg: () => object, applyCfg: (cfg: object) => Promise<void>,
 *  getModel: () => string, validModel: (k: string) => boolean,
 *  swapModels: (hostModel: string, guestModel: string, role: 'host'|'guest') => void,
 *  ui: { toast: (m: string) => void, enterSetup: () => void, enterRace: () => void, toMenu: () => void,
 *        setupWaiting: (on: boolean) => void, startRace: () => void, showResult: (r: object) => void,
 *        hideResult: () => void, changed: () => void, markLap: (i: number) => void },
 * }} ctx
 */
export function createOnline(ctx) {
  const { lobby, race, player, rival, audio, sparks, hazards, ui } = ctx;
  const S = {
    role: null, // 'host' | 'guest' | null
    peer: false,
    hostReady: false,
    guestReady: false,
    guestModel: null,
    q: 0,
    lastPublish: 0,
    peerLt: null, // host: newest guest send-time seen
    peerLtAt: 0,
    thr: { sent: -1, at: 0 },
    lastCfg: '',
    appliedQ: -1,
    finishedHandled: false,
    disagree: 0,
    prevLapCount: [0, 0],
    prevCarState: [0, 0],
    prevDigit: 0,
    prevRaceState: 0,
    rtt: 0.1,
    lastSnapAt: 0,
  };
  const buf = new SnapBuffer();

  // ------------------------------------------------------------ session lifecycle

  function setRole(role) {
    S.role = role;
    S.peer = !!role;
    S.hostReady = S.guestReady = false;
    S.guestModel = null;
    S.appliedQ = -1;
    S.finishedHandled = false;
    S.disagree = 0;
    S.prevLapCount = [0, 0];
    S.prevCarState = [0, 0];
    S.prevDigit = 0;
    S.prevRaceState = 0;
    S.lastCfg = '';
    S.thr = { sent: -1, at: 0 };
    S.peerLt = null;
    buf.clear();
    race.follower = role === 'guest';
    hazards.setPuppet(role === 'guest'); // the guest replays the host's monsters, it never decides them
    player.kinematic = role === 'guest'; // on the guest, the host's car is drawn from the network
    race.opponent = role ? { name: role === 'host' ? 'GUEST' : 'HOST', throttle: 0 } : null;
    if (role) race.setMode('VS');
    ui.changed();
  }

  /** Called with every lobby snapshot: works out whether a 1v1 session exists and tears it down when it ends. */
  function sync(snap) {
    const wantHost = !!snap.hosting && snap.hostHasGuest;
    const wantGuest = !!snap.joined;
    const want = wantHost ? 'host' : wantGuest ? 'guest' : null;
    if (want === S.role) return;
    const had = S.role;
    setRole(want);
    if (had && !want) {
      ui.toast(had === 'host' ? 'Opponent left.' : 'Disconnected from the host.');
      ui.toMenu();
    } else if (want === 'host') {
      ui.toast('Opponent joined. Press START RACE.');
    } else if (want === 'guest') {
      ui.toast('Joined. The host chooses the circuit and starts the race.');
    }
  }

  function pushCfg(force = false) {
    if (S.role !== 'host') return;
    const cfg = ctx.getCfg();
    const key = JSON.stringify(cfg);
    if (!force && key === S.lastCfg) return;
    S.lastCfg = key;
    lobby.send('cfg', cfg);
  }

  // ------------------------------------------------------------ flow (menu -> setup -> race)

  /** Host presses START RACE on the title screen. */
  function hostStart() {
    if (S.role !== 'host' || race.busy) return;
    S.hostReady = S.guestReady = false;
    lobby.send('setup', { cfg: ctx.getCfg() });
    ui.enterSetup();
  }

  /** READY TO RACE in the camera setup. Returns true when the online flow took over. */
  function ready() {
    if (!S.role) return false;
    ui.setupWaiting(true);
    if (S.role === 'guest') {
      lobby.send('ready', { model: ctx.getModel() });
    } else {
      S.hostReady = true;
      if (S.guestReady) beginHost();
    }
    return true;
  }

  function beginHost(again = false) {
    const hm = ctx.getModel();
    const gm = S.guestModel && ctx.validModel(S.guestModel) ? S.guestModel : hm;
    ctx.swapModels(hm, gm, 'host');
    race.opponent.throttle = 0;
    lobby.send('begin', { hm, gm, q: S.q }); // snapshots up to q belong to the previous race
    S.hostReady = S.guestReady = false;
    if (!again) ui.enterRace();
    ui.hideResult();
    ui.startRace();
  }

  /** Host: results screen RACE AGAIN. */
  function rematch() {
    if (S.role === 'host') beginHost(true);
  }

  /** The local player leaves the race for the title screen: tell the other side. */
  function notifyExit() {
    if (S.role) lobby.send('exit', {});
    S.hostReady = S.guestReady = false;
  }

  // ------------------------------------------------------------ incoming messages

  function onMessage(name, data) {
    if (name === 'accepted') {
      ctx.applyCfg(data);
      return;
    }
    if (S.role === 'guest') {
      if (name === 'cfg') ctx.applyCfg(data);
      else if (name === 'setup') {
        ctx.applyCfg(data?.cfg).then(() => ui.enterSetup());
      } else if (name === 'begin') {
        const hm = ctx.validModel(data?.hm) ? data.hm : 'formula';
        const gm = ctx.validModel(data?.gm) ? data.gm : 'formula';
        ctx.swapModels(hm, gm, 'guest');
        S.finishedHandled = false;
        S.appliedQ = -1;
        buf.clear();
        // Snapshots and control messages travel on different channels, so a late FINISHED snapshot of the
        // previous race can arrive after this. Anything numbered up to the host's count at 'begin' is dropped.
        if (typeof data?.q === 'number' && Number.isFinite(data.q)) buf.lastQ = data.q;
        ui.hideResult();
        if (ctx.getPhase() !== 'race') ui.enterRace();
        player.resetLane();
        rival.resetLane();
        player.placeOnTrack(0);
        rival.placeOnTrack(0);
        S.prevLapCount = [0, 0];
        race.state = 'READY';
      } else if (name === 'snap') {
        const snap = readSnapshot(data, nowSec());
        if (snap && buf.push(snap)) S.lastSnapAt = snap.recv;
      } else if (name === 'exit') {
        ui.toast('The host left the race.');
        ui.toMenu(false);
      }
    } else if (S.role === 'host') {
      if (name === 'thr') {
        if (typeof data?.v === 'number' && Number.isFinite(data.v)) {
          race.opponent.throttle = clamp01(data.v);
          if (typeof data.lt === 'number') S.peerLt = data.lt;
          S.peerLtAt = nowSec();
        }
      } else if (name === 'ready') {
        S.guestModel = typeof data?.model === 'string' ? data.model : null;
        S.guestReady = true;
        if (S.hostReady) beginHost();
        else ui.toast('Opponent is ready.');
      } else if (name === 'exit') {
        ui.toast('Opponent left the race.');
        ui.toMenu(false);
      }
    }
  }

  // ------------------------------------------------------------ per-frame: host

  function hostFrame(now, phaseIsRace) {
    pushCfg();
    if (!phaseIsRace) return;
    if (now - S.peerLtAt > 1 && race.opponent) race.opponent.throttle = 0; // stale: let go of the pedal
    if (now - S.lastPublish < 1 / NET.SNAP_HZ) return;
    S.lastPublish = now;
    const lp = (L) => [L.count, Math.round(L.lapStart * 1000) / 1000, L.best == null ? -1 : Math.round(L.best * 1000) / 1000, L.valid ? 1 : 0];
    const body = {
      q: ++S.q,
      ht: now,
      s: RACE_CODE[race.state],
      cd: Math.round(race.countdown * 1000) / 1000,
      ck: Math.round(race.clock * 1000) / 1000,
      el: Math.round(race.elapsed * 1000) / 1000,
      c: [packCar(carView(player)), packCar(carView(rival))],
      lp: [lp(race.lap.player), lp(race.lap.rival)],
    };
    if (S.peerLt != null) {
      body.ack = S.peerLt;
      body.hold = Math.round((now - S.peerLtAt) * 1000) / 1000;
    }
    if (race.haunted) body.mon = hazards.exportState(); // monster events, so both screens see the same haunting
    if (race.result) {
      const r = race.result;
      body.res = { w: r.winner, t: r.total, pb: r.playerBest ?? -1, rb: r.rivalBest ?? -1, l: r.laps };
    }
    lobby.send('snap', body, true);
  }

  // ------------------------------------------------------------ per-frame: guest

  function applyRaceState(snap, now) {
    const st = STATES[snap.state];
    if (st !== race.state) {
      if (st === 'RACING' && race.state === 'COUNTDOWN') {
        audio.beep(1320, 0.45, 0.4);
      }
      race.state = st;
      ui.changed();
    }
    if (st !== 'FINISHED') S.finishedHandled = false;
    race.lap.player = { ...snap.laps[0] };
    race.lap.rival = { ...snap.laps[1] };
    // Lap chimes and replay marks come from the lap counters.
    for (let i = 0; i < 2; i++) {
      if (snap.laps[i].count > S.prevLapCount[i]) {
        if (i === 1) audio.chime();
        ui.markLap(i);
      }
      S.prevLapCount[i] = snap.laps[i].count;
    }
    // The host's car de-slotting is heard and seen here; our own is handled by the local physics.
    const hostCar = snap.cars[0];
    if (hostCar.st === 1 && S.prevCarState[0] !== 1) {
      audio.impact(0.6);
      sparks.emit(player.position, 14, 1);
    }
    S.prevCarState = [hostCar.st, snap.cars[1].st];
    if (st === 'FINISHED' && snap.res && !S.finishedHandled) {
      S.finishedHandled = true;
      const r = snap.res;
      race.result = { winner: r.winner, mode: 'VS', laps: r.laps, total: r.total, playerBest: r.pBest, rivalBest: r.rBest, rivalName: 'HOST' };
      ui.showResult({
        winner: r.winner === 'rival' ? 'player' : 'rival', // from the guest's seat
        mode: 'VS',
        laps: r.laps,
        total: r.total,
        playerBest: r.rBest,
        rivalBest: r.pBest,
        rivalName: 'HOST',
        winnerIndex: r.winner === 'rival' ? 1 : 0,
      });
    }
  }

  /** Clocks run on between snapshots, so the countdown and the lap timer move every frame. */
  function runClocks(snap, now) {
    const st = STATES[snap.state];
    const ahead = now - snap.recv;
    race.countdown = Math.max(0, snap.countdown - ahead);
    const digit = Math.ceil(race.countdown);
    if (st === 'COUNTDOWN' && digit < S.prevDigit && digit >= 1) audio.beep(880, 0.12, 0.35);
    S.prevDigit = st === 'COUNTDOWN' ? digit : 0;
    race.clock = snap.clock + (st === 'RACING' || st === 'COUNTDOWN' ? ahead : 0);
    race.elapsed = snap.elapsed + (st === 'RACING' ? ahead : 0);
  }

  /** Before the local simulation: apply the newest snapshot and pose the opponent (the host's car). */
  function guestBefore(dt, now) {
    const snap = buf.latest;
    if (!snap) return;
    runClocks(snap, now);
    if (snap.q !== S.appliedQ) {
      S.appliedQ = snap.q;
      applyRaceState(snap, now);
      if (race.haunted && snap.mon) hazards.importState(snap.mon, Math.max(0, now - snap.recv));
      rival.webbed = !!(snap.cars[1].flags & 1); // the host decides who is webbed
      rival.lane = snap.cars[1].lane; // ...and who a portal has swapped
      S.ownLat = snap.cars[1].lat;
      const rtt = roundTrip(snap, now);
      if (rtt != null) S.rtt += (rtt - S.rtt) * 0.2;
    }
    const track = ctx.getTrack();
    const o = buf.sample(0, now, track.length);
    if (!o) return;
    player.t += dt;
    player.mesh.visible = !(o.flags & 4) || Math.floor(player.t * 12) % 2 === 0;
    player.webbed = !!(o.flags & 1);
    player.speed = o.speed;
    player.safeRatio = o.safe;
    player.penalty = o.pen;
    if (o.st === 0 || !o.pos) {
      player.state = 'running';
      player.u = o.u;
      player.offset = o.lat;
      player.lane = o.lane;
      track.frameAt(o.u, o.lat, player.mesh.position, player.mesh.quaternion);
      player.mesh.position.y += player.lift;
    } else {
      player.state = 'derailed';
      player.mesh.position.set(o.pos[0], o.pos[1], o.pos[2]);
      player.mesh.quaternion.set(o.quat[0], o.quat[1], o.quat[2], o.quat[3]);
    }
  }

  /** After the local simulation of our own car: pull it toward the host's authoritative state and send the throttle. */
  function guestAfter(dt, now, throttle) {
    const snap = buf.latest;
    const track = ctx.getTrack();
    if (snap) {
      const host = snap.cars[1];
      const mine = rival;
      // A portal lane change is decided by the host: ease our own car across to where the host has it.
      if (typeof S.ownLat === 'number') mine.offset += (S.ownLat - mine.offset) * (1 - Math.exp(-14 * dt));
      const hostState = host.st === 0 ? 'running' : 'derailed';
      const agree = mine.state === hostState || mine.state === 'held';
      S.disagree = agree ? 0 : S.disagree + dt;
      if (!agree && hostState === 'derailed' && mine.state === 'running') {
        // The host de-slotted us (a monster, or a bend taken too fast): it already happened there, follow at once.
        S.disagree = 0;
        mine._derail();
      } else if (!agree && S.disagree > 0.35) {
        // We de-slotted here but the host still has us on the slot: after a moment, the host decides.
        S.disagree = 0;
        mine.placeOnTrack(host.u);
      } else if (mine.state === 'running' && hostState === 'running') {
        const tg = ownTarget(host, snap, now, S.rtt, track.length);
        const r = reconcileOwn(mine.u, tg, dt, track.length);
        S.ownErr = r.errMetres;
        mine.u = r.u;
        if (r.snapped) mine.speed = host.speed;
        track.frameAt(mine.u, mine.offset, mine.mesh.position, mine.mesh.quaternion);
        mine.mesh.position.y += mine.lift;
      }
    }
    // Throttle to the host: on change, and at a steady low rate so the host also gets a round-trip probe.
    const v = Math.round(throttle * 50) / 50;
    const since = now - S.thr.at;
    if (since >= 1 / NET.THR_HZ && (v !== S.thr.sent || since > 0.25)) {
      S.thr = { sent: v, at: now };
      lobby.send('thr', { v, lt: now }, true);
    }
  }

  /** Standing from the newest snapshot so the lap counter and the position never disagree for a frame. */
  function standing() {
    const snap = buf.latest;
    if (!snap) return null;
    const L = ctx.getTrack().length;
    const age = race.state === 'RACING' ? Math.max(0, Math.min(NET.MAX_EXTRAP, nowSec() - snap.recv)) : 0;
    const prog = (i) => snap.laps[i].count + snap.cars[i].u + (snap.cars[i].speed * age) / L;
    const d = (prog(1) - prog(0)) * L; // guest minus host, from the guest's seat
    return { leader: d >= 0 ? 'player' : 'rival', gap: Math.abs(d) };
  }

  return {
    get role() {
      return S.role;
    },
    get session() {
      return !!S.role;
    },
    get rtt() {
      return S.rtt;
    },
    get lastSnapAge() {
      return S.lastSnapAt ? nowSec() - S.lastSnapAt : 0;
    },
    get debug() {
      return { ownErr: S.ownErr ?? null, q: S.q, appliedQ: S.appliedQ, snaps: buf.snaps.length, lastQ: buf.lastQ, offset: buf.offset, rtt: S.rtt, thr: S.thr };
    },
    sync,
    pushCfg,
    hostStart,
    ready,
    rematch,
    notifyExit,
    onMessage,
    hostFrame,
    guestBefore,
    guestAfter,
    standing,
  };
}
