# CursedGP

**Slot-car racing on a haunted diorama.** Race on real circuits against an AI rival or a friend online, and when night falls, the track turns into a diorama of terror.

**Play it:** https://isgudtek.github.io/cursedgp/

# Inspiration

When we were kids, slot-car sets were the big toys of the house. Before computers, before quartz watches, a car on a plastic track was the most exciting thing in the room. The sets looked enormous back then. The older you get, the tinier they look, until one day you see the whole track on a table and realise how small it really was.

CursedGP is that memory, rebuilt in the browser and made a little darker.

# What it does

It is a game of Polistil-style slot-car racing, with a lot of choices:

- **Circuits:** a set of tracks, from the classic figure-eight to long winding laps.
- **Solo time trial:** beat your own best lap.
- **VS AI:** race against a rival with its own personality, from a careful rookie to a maniac.
- **1v1 online:** open a challenge, wait for an opponent, and race a friend in real time.
- **Haunted mode:** the night turns into a diorama of terror. Monsters, pitfalls and surprises wait on the track:
  - a giant kaiju that stomps the track and swipes its head across the lanes,
  - a spider that drops webs across the lanes,
  - a gargoyle that spits orbs,
  - swarms of bats that engulf a car and slow it down,
  - skeletons that reach out from the verge,
  - pumpkins that hop onto the lane,
  - ghosts that swoop on a car and drag it,
  - portals that swap your lane,
  - thunderstorms with long rolling thunder and earthquakes,
  - and wolf howls from the dark.

You can change the camera (TV cameras, chase, overview or free). On a phone you can race with one thumb on the throttle and the other on the view. In haunted mode, **Shift** fends off the hazards for a moment.

# How we built it

- **JavaScript and Three.js** for the whole game: the 3D scene, the track geometry built from one curve, the physics, the AI, the menus and the mobile controls.
- **Procedural art and sound.** The cars, the graveyards, the forest, the church, the skeletons and the pumpkins are built in code. The sound is synthesised in the browser (the thunder, the wolf howls, the lap click), so there are almost no files to download.
- **Online play** uses a hosted real-time messaging service: a publish-and-subscribe network that moves messages between the two players in real time. The host decides every race event and sends the results to the guest, so both screens stay in sync.
- **The Ably key is never in the page.** A small Cloudflare Worker signs short-lived access tokens, and the browser only ever receives those tokens.
- **GitHub Actions** builds the game and publishes it to GitHub Pages on every push.

# Challenges we ran into

It was a steering game. The specification gave us a solid base: a track, a car, a race. Then the features kept coming. Every addition had to fit the same track geometry, the same physics and the same network model, and every new hazard had to be fair to both players online. Keeping the two screens in step was the hardest part: the host decides everything, and the guest only replays what the host sends.

Other challenges were smaller but stubborn:

- keeping the track readable from every camera, from the overview down to a close chase view,
- making the hazards strong enough to matter without making the race unplayable,
- making the layout work on a phone with one hand on the throttle,
- and making a diorama feel creepy on a laptop at 60 frames per second.

# Accomplishments that we're proud of

- A racing game that is genuinely fun to play, with a physics model that rewards a steady hand.
- A diorama that feels like a little world: the storm, the graveyard, the forest, the church and the monsters all share one dark night.
- Online one-versus-one that works in the browser, with no install and no account.
- The whole game runs from a static site, with no server to keep alive except a small token service.

# What we learned

- **Keep one source of truth.** Every race event lives on the host and is replayed on the guest. That made online play predictable, and it made the hazards easy to test.
- **Make the effects visible.** A hazard the player never sees is not a hazard. A lot of the work was making monsters, shields and pitfalls easy to read at speed.
- **Procedural art scales.** Building the scenery in code kept the download small and let us tune the look quickly.
- **Never ship a secret to a browser.** Anything in a static build is public. The token service is the honest way to give a web game access to a paid API.
- **Test the boring parts.** Lap counts, camera order, the layout on a phone and the state of the online room needed as many checks as the game itself.

# How we used Kiro

We built CursedGP with Kiro in the loop for most of the work, and we genuinely enjoyed it. Kiro was the pair that never got tired of the track.

- **The whole `.kiro` folder is published** in [`.kiro`](.kiro): hooks, steering, specs and a skill. The Vaulty specs and steering in it come from another project we built in the same workspace.
- **Hooks, to keep the game safe.** Four of them, the ones for this game, live in [`.kiro/hooks`](.kiro/hooks):
  - *Backup before each task:* a copy of the project before every change, so any idea could be rolled back.
  - *Lint on save:* every saved game file is linted, so a typo is caught the moment it is written.
  - *How to add a feature:* a recipe the agent reads before any task (3D models, buttons, shortcuts, network rules).
  - *Wire a new module:* when a new file is created, the agent checks it is imported, disposed on track change and rebuilt when the circuit changes.
- **Steering, to keep the design consistent.** Standing rules about how the game is built (one source of truth for race events, host-decided hazards, no secrets in the browser) kept every new feature in the same shape.
- **Specs for the bigger pieces.** We wrote requirements, design and task lists for the larger systems, then let the agent work through the tasks and check them off.
- **Live steering.** Many decisions were made in short messages while the agent was already working: a layout change, a new monster, a sound. Kiro picked them up mid-task, adjusted, and reported back.
- **Verification as a habit.** Almost every feature came with a small browser test: a headless Chrome run that checks the real behaviour, not just that the code compiles.

What we loved most: asking for a feature in plain words ("make the ghost swoop onto a car that brakes") and getting a working version, with a test, a backup and an honest report of what was not checked.

# Running it locally

Install the dependencies with `npm install`, then start the development server using the scripts in `package.json`.

To enable online play locally, create a `.env.local` file with `VITE_ABLY_KEY=...`. Never commit it. The public build uses the token service instead, configured with `VITE_ABLY_AUTH_URL`.

# Credits

Built for the Kiroween hackathon. Car and scenery models are procedural. The pumpkin and skeleton ideas are ours. The Kiroween banners are the hackathon's own artwork.
