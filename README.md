# CursedGP

**Slot-car racing on a haunted diorama.** Race on real circuits against an AI rival or a friend online. When night falls, the track turns into a diorama of terror.

**Play it:** https://isgudtek.github.io/cursedgp/

# Inspiration

When we were kids, slot-car sets were the big toys of the house. Before computers, before quartz watches, a car on a plastic track was the most exciting thing in the room. The sets looked enormous back then. The older you get, the tinier they look, until one day you see the whole track on a table and realise how small it really was.

CursedGP is that memory, rebuilt in the browser and made a little darker.

# What it does

It is a classic slot-car racing game, with a lot of choices:

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
  - ghosts that swoop on a car and slow it down,
  - portals that swap your lane,
  - thunderstorms with long rolling thunder and earthquakes,
  - and wolf howls from the dark.

You can change the camera (TV cameras, chase, overview or free). On a phone you can race with one thumb on the throttle and the other on the view. In haunted mode, **Shift** fends off the hazards for a moment.

# How we built it

- **JavaScript and Three.js** for the whole game: the 3D scene, the track geometry built from one curve, the physics, the AI, the menus and the mobile controls.
- **Procedural art and sound.** The cars, the graveyards, the forest, the church, the skeletons and the pumpkins are built in code. The sound is synthesised in the browser (the thunder, the wolf howls, the lap click), so there are almost no files to download.
- **Online play** uses a hosted real-time messaging service: a publish-and-subscribe network that moves messages between the two players as they happen. The host decides every race event and sends the results to the guest, so both screens stay in sync.
- **The messaging key is never in the page.** A small Cloudflare Worker (a serverless function that runs on Cloudflare's network) holds the key and signs short-lived access tokens. The browser only ever receives those tokens.
- **GitHub Actions** builds the game and publishes it to GitHub Pages on every push.

# Challenges we ran into

It was a steering game. The specification gave us a solid base: a track, a car, a race. Then the features kept coming. Every addition had to fit the same track geometry, the same physics and the same network model, and every new hazard had to be fair to both players online. Keeping the two screens in step was the hardest part: the host decides everything, and the guest only replays what the host sends.

The biggest practical challenge was the online mode on GitHub Pages. Online play needs a real-time messaging service, which needs a key, and anything published on a static site is public. We used the messaging service for the 1v1 rooms, and we needed the game to publish on GitHub Pages, so we parked the key on a Cloudflare Worker. The game now asks the Worker for a short-lived token, and the key never reaches a browser.

Other challenges were smaller but stubborn:

- making the game smoothly playable on every device: a laptop with a mouse, a phone with one thumb on the throttle, and everything between,
- keeping the track readable from every camera, from the overview down to a close chase view,
- making the hazards strong enough to matter without making the race unplayable,
- and making a diorama feel creepy at 60 frames per second.

# Accomplishments that we're proud of

- A racing game that is genuinely fun to play, with a physics model that rewards a steady hand.
- A diorama that feels like a little world: the storm, the graveyard, the forest, the church and the monsters all share one dark night.
- Online one-versus-one that works in the browser, with no install and no account.
- A static site with no server to keep alive, except a small token service.

# What we learned

- **Keep one source of truth.** Every race event lives on the host and is replayed on the guest. That made online play predictable, and it made the hazards easy to test.
- **Make the effects visible.** A hazard the player never sees is not a hazard. Much of the work went into making monsters, shields and pitfalls easy to read at speed.
- **Procedural art scales.** Building the scenery in code kept the download small and let us tune the look quickly.
- **Never ship a secret to a browser.** Anything in a static build is public. The token service is the honest way to give a web game access to a paid service.
- **Test the boring parts.** Lap counts, camera order, the layout on a phone and the state of the online room needed as many checks as the game itself.

# How we used Kiro

We built CursedGP with Kiro, and we enjoyed it. The project's `.kiro` folder holds how we worked with it.

**Used during the build**

- **Hooks.** Four hooks ran as we worked: a backup before each task, a lint on every saved game file, a recipe the agent read before adding a feature (3D models, buttons, shortcuts, network rules), and a check that every new module was wired in, disposed on track change and rebuilt per circuit.
- **Steering.** A steering file held the standing rules: one source of truth for race events, host-decided hazards, visual changes that never touch the physics, and no secrets in the browser.
- **Live steering.** Many decisions came in short messages while the agent was already working on something else. Kiro picked them up mid-task, adjusted and reported back.
- **Browser checks.** Almost every feature came with a headless-browser check that asserts real behaviour (positions, text, counters), not just that the code compiles.

**The project's working setup**

- **Specs.** `.kiro/specs/tabletop-gp/` holds the requirements, the design and the task list. We use it to plan and track what is left to finish the product.
- **Custom agents.** `.kiro/agents/` holds three agents for the remaining work: `tabletop-feature` (adds a feature with a backup, lint, build and a browser check), `tabletop-qa` (checks the release, including that no key is in the build) and `tabletop-release` (publishes the test site).

What we loved most: asking for a feature in plain words ("make the ghost swoop onto a car that brakes") and getting a working version, with a test, a backup and an honest report of what was not checked.

# Running it locally

Install the dependencies with `npm install`, then start the development server using the scripts in `package.json`.

To enable online play locally, create a `.env.local` file with `VITE_ABLY_KEY=...`. Never commit it. The public build uses the token service instead, configured with `VITE_ABLY_AUTH_URL`.

# Credits

- Built for the Kiroween hackathon. The Kiroween banners are the hackathon's own artwork.
- Car and scenery models: Kenney, CC0 (public domain).
- Pixel font: Press Start 2P, under the SIL Open Font License.
- 3D library: Three.js, MIT licence.
- Music: both tracks were produced with a licensed AI music generator.
