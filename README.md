# TABLETOP GP — browser slot-car racing

A miniature slot-car set on a table, in the browser. Race an AI rival or a friend online (1v1), on the Classic
Figure-8 or 40 real F1 layouts, with an optional Haunted Mode full of monsters. Vanilla ES modules + Three.js.
No physics engine; engine and effect sounds are synthesised with Web Audio.

## Modules
- `src/track.js` — closed `CatmullRomCurve3` circuits: the Classic Figure-8 plus 40 real F1 layouts
  (`src/circuit-data.js`, from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)).
  Each track has a curvature and safe-speed table and a deck with two slot lanes.
- `src/car.js` — one scalar `u` per car. Player and AI cars use the same physics: a car derails when
  `speed > maxSafeSpeed(curvature)`, waits a 1.5 s penalty, then returns to its slot.
- `src/cars.js` — the three garage cars (Crimson Formula, coupe, hearse) and the garage preview.
- `src/ai.js` — rival profiles (Specter, Banshee, Reaper). Each profile sets a throttle, looking ahead along the track.
- `src/race.js` — race state machine `READY → COUNTDOWN → RACING → FINISHED`, 3 or 5 laps, position and gap,
  and the time-trial ghost.
- `src/monsters.js` — Haunted Mode: kaiju, spider, phantom, gargoyle, claws.
- `src/input.js` — keyboard, mouse and gamepad.
- `src/hud.js` — telemetry overlay (speed, lap, best lap, race status, position).
- `src/menu.js` — title screen, garage, circuit chooser, open challenges, camera setup bar, results.
- `src/framing.js` — fits the whole track into the screen area the UI leaves free (turned to suit the screen shape, steep 3/4 view).
- `src/spectator.js` — viewpoints and zoom; `src/cockpit.js` — the cockpit TVs.
- `src/replay.js` — after the finish, the winner's final lap replays from inside its cockpit.
- `src/lobby.js`, `src/online.js`, `src/netsync.js` — online 1v1 (below).

## Controls
| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Throttle | `Space` / `↑`; or slide one finger (or the mouse) up and down anywhere: nothing in the bottom 15 % of the screen, full at 70 % up | RT (analog), A (full) |
| Start (title screen) | `Enter` | Start |
| Sound on/off | `M`, or the speaker button | Y |
| Day / night | `N` | — |
| Circuit | `1–9`, `[` / `]` on the title screen | — |
| Camera | `C` cycles OVERVIEW, TV, CHASE and FREE; the camera button also has the preset views and the cockpit TVs. FREE: right-drag rotate, middle or Shift-drag pan, wheel zoom; two fingers on touch | — |
| Back to menu | `Esc`, or EXIT TO MENU in the (i) panel | — |

In a race, three round buttons sit in the bottom-right corner: (i) instructions, the camera menu, and sound on/off. The trigger gauge (right edge on phones, left on desktop) shows your throttle and turns amber, then red, near the grip limit. A de-slotted car is put back on the slot after 1.5 s.

## Online 1v1
1. Choose **ONLINE (2 PLAYERS)** on the title screen. **OPEN CHALLENGES** lists open rooms with the host's choices
   (circuit, sky, laps, haunted, car) and a JOIN button; full rooms say FULL.
2. **CREATE NEW** opens a room with your current settings. When someone joins, press **START ONLINE RACE**.
   Both players press READY; the countdown starts when both are ready. (A local race starts straight away.)
3. After the finish, the winner's last lap replays from its cockpit (SKIP to jump to the results). Only the host
   can start a rematch.

How it works: the host runs the race (physics, laps, monsters, results) and sends a snapshot 15 times a second.
The guest drives its own car locally, so the throttle has no network delay, and gently corrects it toward the
host's state. The host's car is drawn about 120 ms in the past from a snapshot buffer, so it moves smoothly
through jitter and lost packets. Messages go through [Ably](https://ably.com) channels `tabletop-gp:lobby`,
`tabletop-gp:room:<CODE>` (control) and `tabletop-gp:room:<CODE>:f` (snapshots and throttle).

### Ably key
Put a key in `.env.local` (gitignored):
```
VITE_ABLY_KEY=<appId.keyId:secret>
```
The key is embedded in the built JavaScript, so anyone can read it. Use a key restricted to **Publish + Subscribe**
on `tabletop-gp:*` only. Without a key the game runs fine and ONLINE reports that it is off.

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

## Deploy
`npm run build` writes `dist/` with a relative base, so it works from any sub-path. Build with `.env.local` in
place if you want online play in the deployed copy.
- **Vercel:** root directory `slotcar-xr`, framework Vite, output `dist`.
- **GitHub Pages:** publish `dist/`, e.g. `npx gh-pages -d dist`.

## Tuning
- `src/ai.js` — `AI_PROFILES` (`top`, `brake`, `jitter`).
- `src/car.js` — `CAR.vmax`, `PENALTY` (1.5 s).
- `src/netsync.js` — `NET` (snapshot rate, interpolation delay, correction rate).

## License and attribution
- This project is released under the [MIT License](LICENSE).
- Circuit layouts in `src/circuit-data.js` come from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), which is MIT-licensed. Their coordinates are included as offline fallbacks.
- Three.js (MIT) is the rendering library; Ably's device SDK carries the online traffic.
