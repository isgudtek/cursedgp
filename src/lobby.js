/**
 * Online lobby over Ably. A host announces its room on the lobby channel every 2 s with its race
 * settings and whether a guest can still join. The lobby lists rooms heard in the last 6 s.
 * A guest joins by sending 'join' on the room channel; the host answers 'accept' or 'full'.
 * Race sync is not part of this module.
 *
 * The Ably key comes from VITE_ABLY_KEY (.env.local, gitignored). The Ably library loads only when
 * ONLINE is chosen, so local play never opens a connection.
 */

const LOBBY_CHANNEL = 'tabletop-gp:lobby';
const roomChannelName = (code) => `tabletop-gp:room:${code}`;
const fastChannelName = (code) => `tabletop-gp:room:${code}:f`; // race snapshots and throttle, high rate
const HANDSHAKE = new Set(['join', 'accept', 'full', 'hello', 'bye', 'closed']);
const BEAT_MS = 2000;
const STALE_MS = 6000; // a listed room not heard for this long leaves the list
const PEER_STALE_MS = 15000; // a joined player not heard for this long has left (tolerates a slow tab or network)
const JOIN_TIMEOUT_MS = 8000;
// No 0, O, 1 or I, so codes read aloud without confusion. 32 symbols divide 256 evenly, so no bias.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z2-9]{4}$/;

function randomToken(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

/** Keeps only the fields the lobby shows. Messages come from the network, so nothing is trusted as-is. */
function readRoom(d, now) {
  if (!d || typeof d.code !== 'string' || !CODE_RE.test(d.code)) return null;
  return {
    code: d.code,
    hostId: String(d.hostId ?? '').slice(0, 16),
    circuit: String(d.circuit ?? '').slice(0, 24),
    mode: d.mode === 'VS' ? 'VS' : 'TT',
    rival: String(d.rival ?? '').slice(0, 12),
    laps: [1, 3, 5, 8, 10].includes(Number(d.laps)) ? Number(d.laps) : 3,
    haunted: !!d.haunted,
    day: !!d.day,
    car: String(d.car ?? '').slice(0, 20),
    ci: Number.isInteger(d.ci) && d.ci >= 0 && d.ci < 200 ? d.ci : 0,
    scale: Math.min(1.3, Math.max(0.5, Number(d.scale) || 1)),
    joinable: !!d.joinable,
    seen: now,
  };
}

/**
 * @param {(snapshot: object) => void} onChange called whenever the lobby state changes
 */
export function createLobby(onChange) {
  const key = import.meta.env.VITE_ABLY_KEY; // local play: the key itself (.env.local)
  const authUrl = import.meta.env.VITE_ABLY_AUTH_URL; // the public build: a token server (no key in the page)
  const clientId = `p-${randomToken(6)}`;
  const rooms = new Map(); // code -> room record from readRoom()
  const state = { connection: key || authUrl ? 'off' : 'nokey', hosting: null, hostHasGuest: false, joined: null, message: '' };
  let gameHandler = null; // (name, data) for game messages from the other player
  let hostFast = null;
  let joinFast = null;
  let hostId = null; // guest side: client id of the host that accepted us
  let hostSeen = 0;

  let ably = null;
  let loading = null; // promise while the Ably client is being created
  let lobbyCh = null;
  let pruneTimer = 0;

  let hostCh = null;
  let hostSettings = null;
  let hostTimer = 0;
  let guest = null; // { id, seen }

  let joinCh = null;
  let joinTimer = 0;
  let helloTimer = 0;
  let joinCode = null;

  const emit = () => onChange(snapshot());
  const setMessage = (text) => {
    state.message = text;
    emit();
  };

  function snapshot() {
    // The host's own live room is listed too, built from the same settings it publishes, so the host sees it.
    const list = [...rooms.values()].filter((r) => r.code !== state.hosting);
    if (state.hosting) {
      const s = hostSettings();
      list.push({ code: state.hosting, hostId: clientId, circuit: s.circuit, mode: s.mode, rival: s.rival, laps: s.laps, haunted: s.haunted,
        day: s.day, car: s.car, ci: s.ci, scale: s.scale, joinable: !guest });
    }
    return {
      connection: state.connection,
      hosting: state.hosting,
      hostHasGuest: state.hostHasGuest,
      joined: state.joined,
      clientId,
      message: state.message,
      rooms: list.sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  function prune() {
    const now = Date.now();
    let changed = false;
    for (const [code, room] of rooms) {
      if (now - room.seen > STALE_MS) {
        rooms.delete(code);
        changed = true;
      }
    }
    if (changed) emit();
  }

  /** Creates the Ably client on first use. Resolves false when no key is configured. */
  async function enable() {
    if (!key && !authUrl) {
      state.message = 'Online play is off. Add VITE_ABLY_KEY to slotcar-xr/.env.local and restart the dev server.';
      emit();
      return false;
    }
    if (ably) return true;
    if (!loading) {
      loading = (async () => {
        // The device build declares this client as a user device, which MAU pricing requires.
        const { createClient } = await import('@ably/pubsub-device');
        // logLevel 0: Ably writes nothing to the console; the panel shows the connection state instead.
        ably = createClient(key
          ? { key, clientId, echoMessages: false, logLevel: 0 }
          : { authUrl: `${authUrl}${authUrl.includes('?') ? '&' : '?'}clientId=${encodeURIComponent(clientId)}`, clientId, echoMessages: false, logLevel: 0 });
        ably.connection.on((change) => {
          state.connection = change.current;
          if (change.current === 'failed') state.message = change.reason?.message || 'Connection to Ably failed.';
          emit();
        });
        lobbyCh = ably.channels.get(LOBBY_CHANNEL);
        lobbyCh.subscribe('room', (msg) => {
          const room = readRoom(msg.data, Date.now());
          if (!room || room.hostId === clientId) return;
          rooms.set(room.code, room);
          emit();
        });
        lobbyCh.subscribe('closed', (msg) => {
          if (msg.data && rooms.delete(msg.data.code)) emit();
        });
        pruneTimer = setInterval(prune, 1000);
        emit();
      })().catch((err) => {
        loading = null;
        ably = null;
        state.connection = 'failed';
        state.message = err?.message || 'Could not load the Ably client.';
        emit();
        return false;
      });
    }
    await loading;
    return !!ably;
  }

  /** Closes the connection and forgets every room. Used when the player leaves ONLINE mode. */
  /** Goodbye messages still on their way; disable() waits for them before closing the connection. */
  const pending = [];
  function farewell(p) {
    if (!p) return;
    const settled = p.catch(() => {});
    pending.push(settled);
  }

  function disable() {
    leaveHosting();
    leaveRoom();
    clearInterval(pruneTimer);
    rooms.clear();
    // Close once the goodbyes ('closed' / 'bye') are out, or after a moment: closing at once would fail them.
    if (ably) {
      const client = ably;
      const sent = pending.splice(0);
      Promise.race([Promise.allSettled(sent), new Promise((r) => setTimeout(r, 800))]).then(() => client.close());
    }
    ably = null;
    loading = null;
    lobbyCh = null;
    state.connection = key || authUrl ? 'off' : 'nokey';
    state.message = '';
    emit();
  }

  // ------------------------------------------------------------ host

  /** Opens a room with a fresh code. `getSettings` is read at every heartbeat, so changes show up live. */
  async function host(getSettings) {
    if (!(await enable())) return null;
    if (state.hosting) return state.hosting;
    leaveRoom();
    const code = randomToken(4);
    state.hosting = code;
    state.hostHasGuest = false;
    guest = null;
    hostSettings = getSettings;
    hostCh = ably.channels.get(roomChannelName(code));
    hostCh.subscribe((msg) => onHostMessage(msg));
    hostFast = ably.channels.get(fastChannelName(code));
    hostFast.subscribe((msg) => onHostMessage(msg));
    beat();
    hostTimer = setInterval(beat, BEAT_MS);
    state.message = `Room ${code} is open. Waiting for an opponent. Your challenge is set: close the room to change it.`;
    emit();
    return code;
  }

  function beat() {
    if (!state.hosting || !lobbyCh) return;
    if (guest && Date.now() - guest.seen > PEER_STALE_MS) {
      guest = null;
      state.hostHasGuest = false;
      state.message = 'Opponent left. Waiting for another.';
      emit();
    }
    const s = hostSettings();
    lobbyCh
      .publish('room', {
        code: state.hosting,
        hostId: clientId,
        circuit: s.circuit,
        mode: s.mode,
        rival: s.rival,
        laps: s.laps,
        haunted: s.haunted,
        day: s.day,
        car: s.car,
        ci: s.ci,
        scale: s.scale,
        joinable: !guest,
      })
      .catch((err) => setMessage(`Lobby publish failed: ${err?.message ?? err}`));
    if (guest) hostCh?.publish('cfg', { ...s, to: guest.id }).catch(() => {}); // settings and keepalive for the guest
  }

  function onHostMessage(msg) {
    const from = msg.clientId || msg.data?.from;
    if (!from) return;
    if (msg.name === 'join') {
      if (guest && guest.id !== from) {
        hostCh.publish('full', { to: from });
        return;
      }
      guest = { id: from, seen: Date.now() };
      state.hostHasGuest = true;
      hostCh.publish('accept', { to: from, cfg: hostSettings() });
      beat(); // mark the room full right away instead of waiting for the next heartbeat
      state.message = 'Opponent joined.';
      emit();
    } else if (msg.name === 'hello' && guest && guest.id === from) {
      guest.seen = Date.now();
    } else if (msg.name === 'bye' && guest && guest.id === from) {
      guest = null;
      state.hostHasGuest = false;
      beat();
      state.message = 'Opponent left. Waiting for another.';
      emit();
    } else if (!HANDSHAKE.has(msg.name) && guest && guest.id === from) {
      guest.seen = Date.now();
      gameHandler?.(msg.name, msg.data);
    }
  }

  function leaveHosting() {
    if (!state.hosting) return;
    const code = state.hosting;
    clearInterval(hostTimer);
    farewell(lobbyCh?.publish('closed', { code }));
    farewell(hostCh?.publish('closed', { code }));
    hostCh?.unsubscribe();
    hostFast?.unsubscribe();
    hostCh = null;
    hostFast = null;
    hostSettings = null;
    guest = null;
    state.hosting = null;
    state.hostHasGuest = false;
  }

  // ------------------------------------------------------------ guest

  /** Asks to join a room. The host answers 'accept' or 'full'; silence times out. */
  async function join(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return setMessage('Room codes are 4 letters or digits.');
    if (!(await enable())) return;
    if (state.hosting) return setMessage('You are hosting a room. Close it before joining another.');
    leaveRoom();
    joinCode = code;
    state.message = `Joining room ${code}...`;
    joinCh = ably.channels.get(roomChannelName(code));
    joinCh.subscribe((msg) => onGuestMessage(msg));
    joinFast = ably.channels.get(fastChannelName(code));
    joinFast.subscribe((msg) => onGuestMessage(msg));
    joinCh.publish('join', { from: clientId });
    joinTimer = setTimeout(() => {
      if (state.joined || joinCode !== code) return;
      leaveRoom();
      setMessage(`No answer from room ${code}. It may have closed.`);
    }, JOIN_TIMEOUT_MS);
    emit();
  }

  function onGuestMessage(msg) {
    if (msg.name === 'accept' && msg.data?.to === clientId && !state.joined) {
      clearTimeout(joinTimer);
      state.joined = joinCode;
      hostId = msg.clientId || null;
      hostSeen = Date.now();
      state.message = `Joined room ${joinCode}. Waiting for the host to start.`;
      helloTimer = setInterval(() => {
        joinCh?.publish('hello', { from: clientId });
        if (Date.now() - hostSeen > PEER_STALE_MS) {
          const code = joinCode;
          leaveRoom();
          setMessage(`Lost connection to room ${code}.`);
        }
      }, BEAT_MS);
      gameHandler?.('accepted', msg.data.cfg);
      emit();
    } else if (msg.name === 'full' && msg.data?.to === clientId) {
      const code = joinCode;
      leaveRoom();
      setMessage(`Room ${code} is full.`);
    } else if (msg.name === 'closed' && joinCode) {
      const code = joinCode;
      leaveRoom();
      setMessage(`Host closed room ${code}.`);
    } else if (state.joined && hostId && msg.clientId === hostId && !HANDSHAKE.has(msg.name)) {
      hostSeen = Date.now();
      if (!msg.data?.to || msg.data.to === clientId) gameHandler?.(msg.name, msg.data);
    }
  }

  function leaveRoom() {
    clearTimeout(joinTimer);
    clearInterval(helloTimer);
    if (joinCh) {
      if (state.joined) farewell(joinCh.publish('bye', { from: clientId }));
      joinCh.unsubscribe();
      joinFast?.unsubscribe();
      joinCh = null;
      joinFast = null;
    }
    hostId = null;
    joinCode = null;
    state.joined = null;
  }

  /** Leaves any room and stops heartbeats. Called on pagehide and when switching to LOCAL. */
  function leaveAll() {
    leaveHosting();
    leaveRoom();
    emit();
  }

  /** Game messages go to the other player only: the host sends to its guest, a guest to its host. */
  const channelFor = (fast) => (state.hosting ? (fast ? hostFast : hostCh) : state.joined ? (fast ? joinFast : joinCh) : null);
  const sendFail = { count: 0, last: '' }; // publishes Ably rejected (rate limits, detached channel...)
  function send(name, data = {}, fast = false) {
    const ch = channelFor(fast);
    if (!ch) return false;
    ch.publish(name, state.hosting && guest ? { ...data, to: guest.id } : data).catch((err) => {
      sendFail.count++;
      sendFail.last = `${err?.code ?? ''} ${err?.message ?? err}`.trim();
    });
    return true;
  }

  return {
    snapshot,
    enable,
    disable,
    host,
    join,
    leaveHosting,
    leaveRoom,
    leaveAll,
    /** CLOSE ROOM: close it and tell the screen (the challenge unlocks, a session with a guest ends). */
    closeRoom() {
      leaveHosting();
      state.message = '';
      emit();
    },
    send,
    onGame: (fn) => (gameHandler = fn),
    sendFail,
    /** Channel states, to tell a detached or suspended channel from a quiet one. */
    channelStates: () => ({ ctl: (hostCh || joinCh)?.state ?? null, fast: (hostFast || joinFast)?.state ?? null, conn: ably?.connection?.state ?? null }),
  };
}
