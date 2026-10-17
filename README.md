# Super Fighter Re:Tournament, TypeScript port

A TypeScript port of a block-based game project. The game runs in the browser with its own WebGL renderer and audio, and plays online over peer-to-peer connections with rollback netcode.

The port reproduces the original frame for frame. Parity tests run the original project in its own runtime next to the port and compare every variable, list, sprite, thread, pen stamp and sound event on every frame.

## Play

You need `node` 22 or later.

```bash
npm install
```

```bash
npm run dev
```

On Windows, `play.cmd` does both and opens the page. `play online` also starts a local room server for testing online play in two tabs, and `play editor` opens the mod maker.

Open http://localhost:5173 and choose **Play on this computer**. Player 1 uses W A S D to move, V to attack, C for combo, B to shield, Space to jump and F to taunt. Player 2 uses the arrow keys with `, . M N K`. P pauses. The in-game controls menu can rebind every key.

Controllers work too, in the standard layout: the left stick or the D-pad moves, A attacks and confirms in menus, B is the combo button and goes back in menus, X and Y jump, the shoulder buttons and triggers shield, Back taunts and Start pauses. On one computer the first controller plays Player 1 and the second plays Player 2. Online, every controller plays your own seat.

On touch screens a joystick and six buttons appear once a game starts: beside the stage when the screen is wide, below it when the screen is tall. The joystick centers wherever your thumb lands. The controls hide while a controller is in use and come back at the next touch. While the touch controls are on, **Controls** in the lobby shows the buttons in their places, and tapping two of them swaps what they do.

## Online play

Online games are peer to peer. Every player runs the whole game, and inputs travel directly between browsers over WebRTC data channels. A small room server in `server/` hands out room codes and passes the connection setup messages between players. It never sees gameplay traffic unless a direct connection fails, and then it relays inputs for that pair of players.

1. One player chooses **Host an online game** and shares the six-character room code.
2. Up to three others enter the code and choose **Join**.
3. The host picks the input delay and starts the game. Everyone sees the same game from the title screen on, and each player controls their own seat (P1 to P4).

Your online name is your Scratch username. The name box takes letters, numbers, `_` and `-`, up to 20 characters, and the room seats a name only when a Scratch account has it, with that account's capitalization. It refuses the names of Scratch Team members. A made-up name of `player` and 2 to 7 digits needs no account, and the lobby starts with one. The room accepts any name when it cannot reach the account service.

Each player sets their own keys, "Up is Jump" and "Combo use" with **Controls** in the lobby. They start as the Player 1 defaults and are saved in that browser. On one computer they become Player 1's controls when the game starts, and the in-game controls menu can still change them. Online, a player's keys control their own seat, so players can choose the same keys, and their two options apply to their own seat when the game starts. Only the first seat moves the mouse pointer in menus.

Input delay trades smoothness for responsiveness. One frame (33 ms) suits most connections. On a link with more than about 100 ms of round-trip time, two frames give fewer visible corrections.

### Running the room server locally

```bash
npm --prefix server install
```

```bash
npm run worker:dev
```

The room server listens on port 8788, and `npm run dev` forwards `/api` to it. Open two browser tabs to try hosting and joining on one machine.

## Publishing

### The site

The workflow in `.github/workflows/pages.yml` type-checks and builds the game, then publishes `dist/` as the repository's site on every push to `main`. In the repository settings, set the site's source to the workflow before the first push. The build uses relative paths, so it works from the repository's subfolder.

A build made without a room server address hides the online controls and shows a note in their place. Local play works either way.

### The room server

1. `cd server`, then run `npx wrangler login` and `npx wrangler whoami` to confirm the account.
2. Check that `ALLOWED_ORIGINS` in `server/wrangler.toml` lists the origin of the published site (scheme and host, no path).
3. Run `npx wrangler deploy` and note the address it prints.
4. Check it with `curl <address>/api/health`, which answers `{"ok":true,"protocol":2}`.
5. Put that address in the `RELAY_URL` line of `.github/workflows/pages.yml`, or set a repository variable named `RELAY_URL`, which takes precedence. Then run the site workflow again. For a build on your own machine, run `RELAY_URL=<address> npm run build` instead.

The room server logs one JSON line per event: rooms opening, players joining and leaving, refusals, and problem reports that players' pages send when a game freezes, goes out of sync or loses its direct link. Follow them live with `npx wrangler tail` in `server/`, or search them in the hosting dashboard's log view.

Deploy the room server again whenever `src/net/protocol.ts` changes, and raise `PROTOCOL` with any message change. Each build carries a fingerprint of the simulation code, and rooms only accept players with the same fingerprint, so different builds never share a game.

The free hosting tier covers room setup comfortably. Relayed games (players whose direct connection failed) send about 30 messages a second per player through the room, so a busy deployment with many relayed games may need a paid tier.

## New characters

Players add characters to the game's page with **Mods** on the main menu, from `.sfrt` character files made with the mod maker. Mods stay in that browser, and players meet online only with the same mods turned on.

`characters/README.md` explains how to make characters. Start the mod maker with:

```bash
npm run characters
```

## How the port works

| Folder | Contents |
| --- | --- |
| `src/engine/` | The runtime: value casting, the thread scheduler, broadcasts, clones, layering, the pen and sound models, renderer geometry, snapshots and portable math. |
| `src/game/generated/` | One TypeScript module per sprite, generated from the project. |
| `src/render/` | The WebGL renderer. |
| `src/client/` | The page: input, audio, the question box, list monitors, the lobby and the online session. |
| `src/net/` | The room protocol, the rollback session, the WebRTC mesh and the room client. |
| `server/` | The room server: a lobby and one stateful object per room. |
| `tools/` | The code generator, asset pipeline, character tools and editor, parity, visual and network tests. |
| `characters/` | Characters added to the game, and copies of the originals to start from. |
| `reference/` | A page that runs the original project for comparison. |

Scripts that can never pause become plain functions. Scripts that can pause (loops outside "run without screen refresh", waits, sounds that play until done) become small state machines whose state is plain data, so a snapshot can copy every running script. Rollback restores a snapshot and simulates forward again with corrected input.

The simulation is deterministic. Time advances exactly 1/30 s per frame, random numbers come from a seeded generator, and sine, cosine, arctangent, exponent and logarithm come from `src/engine/dmath.ts`. Browsers return slightly different results for `Math.sin` and its relatives, and the portable versions give the same bits in all of them.

## Regenerating the port from the project

The project file is not in the repository. Put it at `Port_to_TypeScript.sb3` in the project root. These steps also need the browser set in `tools/lib/reference.ts`, which runs the original project for measurements.

```bash
npm run extract
```

```bash
npm run ref:dump
```

```bash
npm run transpile
```

```bash
npm run assets
```

`extract` unzips the project into `sb3/`. `ref:dump` loads it in its original runtime and records costume sizes, rotation centers, normalized vector images and touch masks. `transpile` writes `src/game/generated/`. `assets` copies images and sounds into `public/assets/`.

## Tests

| Command | What it checks |
| --- | --- |
| `npm run test:parity` | Every scenario in `tests/scenarios/` against the original, frame by frame. Results go to `out/logs/`. The original's results are cached in `out/ref-cache/`. |
| `npm run test:rollback` | Random rollbacks re-simulate to exactly the same state. |
| `npm run test:net` | Three simulated players with latency, jitter and packet loss end in the same state. |
| `npm run test:visual` | Rendered frames against the original's renderer. The report is in `out/visual/`. |
| `npm run test:math` | The portable math functions against this engine's. |
| `npm run typecheck` | TypeScript types. |

The parity, visual and regeneration commands need the project file. The rollback, network and math tests run without it.

`tools/menu-drive.ts` scripts menu routes and random play into new scenarios.
