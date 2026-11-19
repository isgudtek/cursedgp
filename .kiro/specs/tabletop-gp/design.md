# Design: TABLETOP GP

## Architecture
- **Track** (`src/track.js`): one centre-line curve. A look-up table of 1200 samples drives physics (position, side vector, curvature, safe speed). Drawing uses the same curve at a chosen resolution, so the visual quality can change without changing physics.
- **Cars** (`src/car.js`, `src/cars.js`): a car moves along the track by its position `u` (0..1). Derailing, falling, and landing on the grass are handled in `_fall`. Car models are built in code, or loaded from GLB files (Kenney models) with a fallback.
- **Race** (`src/race.js`): the state machine (READY, COUNTDOWN, RACING, FINISHED), lap timing, AI throttles.
- **Monsters** (`src/monsters.js`): every haunted hazard. Each one is an `update` step, a host decision, and an event (`EV.*`) sent to the guest.
- **Atmosphere** (`src/atmosphere.js`): sky, moon, storm, bolts, and random sound events.
- **Audio** (`src/audio.js`): all sound synthesised with the Web Audio API.
- **Online** (`src/lobby.js`, `src/online.js`, `src/netsync.js`): rooms and snapshots over a real-time messaging service. The host is authoritative.
- **Menus** (`src/menu.js`, `src/tips.js`, `src/pixel.js`): title screen, garage, tips and the pixel heading font.
- **Token server** (`auth-worker/`): a Cloudflare Worker that signs short-lived tokens. The messaging key is a Worker secret.

## Key decisions
- **Host authority.** Hits, spawns and knock-offs run only on the host. A guest in puppet mode replays events and never decides.
- **Physics is separate from drawing.** Visual changes must not touch the 1200-sample curve, lap timing or derail limits.
- **Haunted is a switch, scenery is not.** The monsters live under the haunted root. The scenery lives in the decor group and shows in every mode.
- **No secrets in the browser.** The public build uses the token URL only.

## Testing
Each feature is checked with a headless browser run that asserts the real state (positions, text, counters), plus lint and the build. Test browsers are closed after each run.
