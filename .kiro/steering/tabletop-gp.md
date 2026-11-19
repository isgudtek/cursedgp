---
inclusion: always
---

# TABLETOP GP: standing rules

These rules apply to every change to CursedGP (the slot-car game and its haunted mode). They document the rules the project was built under.

## Before any change
- Back up the project first (the backup hook does this before every task).
- Keep the lint at 0 errors. Six warnings is the baseline.
- Run the build. It must pass.
- Check the browser console: no errors.

## Game rules
- Online play is host-decided. The host chooses every race event (hits, hazards, spawns), and the guest replays what the host sends. Nothing a guest does changes the other player's race directly.
- A visual change must not change the race. Track drawing, scenery, sound and camera work never touch the physics curve or the lap timing.
- Haunted hazards live under the haunted root and show only in haunted mode. The dark scenery (grass, graveyards, forest, church, sky) shows in every mode.
- Every new hazard needs a fair counter (Shift immunity, slow-down, or a clear warning) and must be visible at race speed.

## Security
- No secrets in the browser. The Ably key stays on the token server (a Cloudflare Worker secret). The page only receives short-lived tokens.
- No `.env` files, keys or backups in the repository.
- No web storage for player data.

## Testing
- Every feature gets a headless-browser check that asserts the real behaviour (the state, the text, the position), not only that the code compiles.
- Close the test browsers after each run, so no orphan Chrome processes remain.
