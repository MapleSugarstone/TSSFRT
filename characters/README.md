# Making characters

Each folder here is a character the game adds after the seven original characters. The game numbers them 8, 9 and so on in folder name order. The `_templates` folder holds copies of the original characters to read and copy from, and `_examples` holds finished example characters. The game ignores both.

## Quick start

The game's site has the mod maker too, so a player needs no copy of the project. Choose **Mods** on the main menu, then **Make a mod**. The site's mod maker keeps characters in that browser, and **Export character** downloads a copy to keep or share. **Play** adds the character to the Mods list in the same browser and opens the game.

In a copy of the project, start the mod maker with:

```bash
npm run characters
```

Choose **New character**, pick the original character to start from, and change what you want. **Build and play** saves the character, adds every character in this folder to the game, and opens the game. The game page reloads by itself after each build. Open `/mod-maker.html?browser` on the development server to try the site's version, which keeps characters in the browser instead of this folder.

## Example: Red Gnaw

![Red Gnaw's character select portrait](_examples/red-gnaw/art/portrait/icvd8s4d-01.png)

Red Gnaw is a finished example: Gnaw recolored with angry eyebrows, new stats, reworked hitboxes and timings, and a gimmick that marks targets with Red and bursts them at three stacks. [Its tutorial](_examples/red-gnaw/README.md) makes him step by step, and shows how to add him as a mod, share him and play him online. In the mod maker, choose **New character** and pick Red Gnaw under Examples to start from him.

## Examples made from scratch

Five examples have no template, so every move is their own data and a gimmick script does what the original characters' move scripts do. Their art is placeholder shapes. Each script opens with a short guide to reading it, and they share the same few helpers, so reading one makes the others easier. They are good places to see how a phased move, a projectile, a grab or a charged attack is written.

- [Gnaw From Scratch](_examples/gnaw-from-scratch) is Gnaw rebuilt from three squares with dot eyes and square feet. His [script](_examples/gnaw-from-scratch/gimmick.ts) charges NPunch, arcs fireballs that leave fire on the ground, grabs and heals with the bite, and fires the barrage. He follows Gnaw's built-in rules for DownAirPunch's steering, and plays the same as Gnaw frame for frame.
- [Arc Phantom](_examples/arc-phantom) is a big diamond with four small ones holding a sharp triangle, made half of Arc and half of Phantom, with their stats averaged. Arc's NPunch, RunPunch, DownPunch, Taunt and Judgement come from Arc, and UpPunch, DownAirPunch, Dodge, Shadowflame Charge and Shadow Trick from Phantom. Each move plays the same as the original's.
- [Xavier From Scratch](_examples/xavier-from-scratch) is a triangle with a round head and an orb. His [script](_examples/xavier-from-scratch/gimmick.ts) throws the orb, dives and sends out shockwaves and runes, and raises the planet that makes enemies fall twice as fast. He follows Xavier's built-in rules for the hover, and plays the same as Xavier frame for frame.
- [Rikaal From Scratch](_examples/rikaal-from-scratch) is a trapezoid with a horned square head and two big fists. His [script](_examples/rikaal-from-scratch/gimmick.ts) grabs and throws four ways, slides after his dive, roars with super armor, and aims and fires the red beam. He follows Rikaal's built-in rules for the heavy landing, and plays the same as Rikaal frame for frame.
- [Darc From Scratch](_examples/darc-from-scratch) is a dark hooded square with glowing eyes, a trailing scarf and a thin blade. His [script](_examples/darc-from-scratch/gimmick.ts) spins the blade, swings the scarves, grapples fighters and walls, opens the portals and raises the zone. His E1 follows the built-in rules of Darc's grapple and his zone hitbox those of Darc's zone, and he plays the same as Darc frame for frame.

## How a character works

A new character is made from an original character, its template. The template decides how every move behaves: charging, projectiles, grabs, and any other scripted behavior. Your character decides how the moves look, sound and hit. Each move on the Moves tab is either the same as the template's or customized with its own numbers, hitbox, effect frames and sounds. Every check the game makes for the template character also applies to yours, so it keeps the template's built-in mechanics.

A character with no template has no scripted moves, and every move is a plain hitbox made from its data.

Five original characters also have rules in the fighter engine itself rather than in their moves. A character follows its template's rules, and **Built-in rules** on the Overview tab gives a character one original character's rules on their own:

| Rules | What they do |
| --- | --- |
| Gnaw | Landing after a jump sets gimmick slot 1 to 1. |
| Xavier | Holding up while falling hovers, using fuel in gimmick slot 1. The fuel refills to 50 on the ground, on a ledge and on respawn. |
| Edward | The first jump is 8 high and uses 0.3 of a jump. In the air, jump adds jump height while rising and uses 0.1 of a jump, or jumps 6 high while falling and uses 0.3 of a jump. |
| Darc | When the computer plays the character, it charges combo moves the way it does for Darc. |
| Rikaal | Landing after a jump is a heavy landing that stops the fighter and shakes the camera. Air jumps are two thirds as strong. Gimmick slot 5 is 1 after touching the ground. |

The game also treats some original moves specially outside their move scripts. **Built-in rules** on the Moves tab makes a move or hitbox of your own get the same treatment:

| Rules | What they do |
| --- | --- |
| Darc's grapple | A line is drawn from it to its fighter. When `moveSteps` runs it into a wall or the ground, it stays in it rather than moving back, and it lands on platforms fighters can jump through even while rising. Touching a fighter that nobody holds sets its slot 2 to `"ENEMY"` unless the slot is `"TERRAIN"`. |
| Darc's zone | A hit on a fighter at more than 99 percent that is still in hitstun knocks the fighter out. |

## The editor tabs

- **Overview**: name, template, built-in rules, character select text, and the gimmick script.
- **Stats**: speed, jumps, weight, hurtbox size and the other stats.
- **Animations**: one row per action the fighter plays an animation for. Paint a row's frames, upload frames, or download all of them as a zip. Hover over a frame to download it as an image or to upload an image in its place. Drag a row onto another to swap the two animations. Hold Ctrl while dropping to copy one over the other. **Recolor character** changes colors in every frame and the art at once.
- **Moves**: the hitbox drawn over the fighter (drag it to move it, drag a corner to resize it), a timeline of the fighter's frames and the effect frames, the frames the hitbox can hit on, and sounds. **Extra hitboxes** at the bottom of the move list are the other hitboxes the template's moves create, such as Gnaw's fireball, its explosion and the fire it leaves on the ground. Customize one to change its numbers, effect frames and sounds. The template's script still decides where it goes and when it appears. **Own hitboxes** are hitboxes only this character has, which its gimmick script creates and moves (see [Hitboxes of your own](#hitboxes-of-your-own)). **Built-in rules** gives a move an original move's special treatment (see [How a character works](#how-a-character-works)).
- **Art**: menu and match intro images.
- **Particles**: animations a gimmick script shows, such as a mark over a fighter.
- **CPU**: how the computer player uses the character.
- **Check and build** (**Check and play** on the site): problems that stop the build, and files the character no longer uses.

**Export character** downloads a character as a `.sfrt` file, and **Import character** adds one from a `.sfrt` file. A `.sfrt` file is a zip archive of the character's folder. Players add the same file to the game's page with **Mods** on the main menu, without the project, so the file is all a player needs. A `.sfrt` file from the project carries the gimmick script compiled to JavaScript for that. Both mod makers export and import the same file, and both still accept character files exported as `.zip` before.

The paint editor draws at the character's own pixel size and scales the frames up to the game's image size when it saves. It keeps layers in the character's `paint` folder. Left click draws, right click picks a color, F fills under the pointer, and Shift click draws a line from the last point. Ctrl+Z undoes. Hover over a button to see its name.

## Testing a character

**Test**, in the mod maker's top bar and on the Check tab, opens the game with the character in Training mode against a dummy that stands still. It does not add the character to the Mods list or build the site, so it also works on the original characters and the examples. The bar above the stage has these buttons:

- **Pause** stops the game, and **Play** starts it again.
- **Step** plays one frame with the keys you hold. Hold a key and click Step to follow a move frame by frame.
- **Reset** puts everything back as it was when the test started.
- **Messages** lists what the gimmick script reports: each error with the function that threw it and the frame, and each line it writes with `console.log`, as well as problems with the character. The first error opens the list and pauses the game.
- **Exit** closes the test.

## The character folder

| Path | What it holds |
| --- | --- |
| `character.json` | Everything except images and sounds. The editor writes it, and you can edit it by hand. |
| `animations/` | Fighter frames. |
| `moves/<move>/` | Effect frames: the move's visual, drawn at the hitbox. |
| `art/` | Menu and match intro images. |
| `particles/` | Particle frames for the gimmick script. |
| `sounds/` | Move sounds. |
| `paint/` | Layered paint documents. The game does not use them. |
| `gimmick.ts` or `gimmick.js` | The gimmick script, if the character has one. |

## How the game reads the data

**Animation frames.** The fighter plays the frames whose names start with its current action, such as `idle`, `run`, `jump`, `NPunch` or `E1`, in the order they appear. A frame with `NL` in its name holds until the action changes. The game starts an animation at the first frame whose name begins with the action, ignoring case, so an action's frames must come before those of a longer action that begins with its name, such as `run` before `RunPunch`. The Check tab warns when they do not. The jump starts when the `jcharge` animation reaches a frame named `jchargeNL`. Each frame has a speed code that sets how long it shows:

| Speed | Game frames |
| --- | --- |
| 6 | 1 |
| 5 | 2 |
| 4 | 3 |
| 3 | 5 |
| 2 | 7 |
| 8 | 11 |
| 1 | 20 |
| 7 | 67 |

The game runs at 30 frames per second.

**Images.** Frame images are PNG files at twice the game's stage resolution (resolution 2), or SVG files at resolution 1. Each image has a center in image pixels that lines up with the fighter's position.

**Hitboxes.** A move's hitbox is a rectangle of the hitbox width and height. Its center sits at the offset from the fighter's position, mirrored when the fighter faces left. It hits a fighter whose hurtbox (the hurtbox width and height around that fighter's position) overlaps it. The effect frames draw at the hitbox center and do not change what it hits.

**When a hitbox can hit.** Without a window, the hitbox can hit for its whole life. With one, it can hit from the start frame up to the end frame of its life, counted from 0.

**Sounds.** The start sound plays when the hitbox appears. Each sound cue plays on a frame of the hitbox's life, and cues wait during hit pause.

## Gimmick scripts

A gimmick script runs code for one character at fixed moments. Add one from the Overview tab, and edit `gimmick.ts` in a code editor. The site's mod maker writes the script in JavaScript instead, in a box on the Overview tab (see below). It exports an object with any of these functions:

| Function | When the game calls it |
| --- | --- |
| `frame(fighter, buttons)` | Every frame, before the fighter moves, with the buttons held. |
| `move(fighter, hitbox)` | When one of the fighter's hitboxes appears, after its data loads. |
| `hit(fighter, target, hitbox)` | When one of the fighter's hitboxes connects with another fighter (shielded hits too), before knockback and damage. |
| `tick(fighter, hitbox)` | Every frame of each of the fighter's hitboxes, except during hit pause. |

`fighter` and `target` are fighters. `hitbox` is one hitbox of the character's. `src/game/gimmick-api.ts` documents each member. A fighter has:

| Member | What it is |
| --- | --- |
| `x`, `y`, `vx`, `vy` | Position and speed, to read and change. |
| `percent`, `invincibility`, `hitstun`, `comboMeter`, `jumps` | Damage, frames of invincibility and hitstun left, the combo meter, and jumps left, to read and change. |
| `direction`, `state`, `action` | Facing (90 is right) to read and change, the movement state such as `idle` or `jump`, and what it is doing such as `NPunch` or `shield`. |
| `character`, `index`, `team`, `width`, `height`, `time`, `buttons` | Its character number, its place in the match, its team (`''` for none), its hurtbox, game frames since the start, and the buttons its player holds. |
| `slot(n)`, `setSlot(n, value)` | Its five gimmick slots. |
| `all()` | Every fighter in the match. |
| `random(from, to)` | A whole number from the game's seeded random source. |
| `math` | `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `ln`, `log` and `exp` in degrees, as the game computes them. |
| `particle(name, x, y, layer, direction)` | Shows one of the character's particles, or one of the game's own such as `02_Expl`, at the fighter. |
| `tint(color, frames)` | Paints the fighter in a color such as `'#e8242c'` for that many frames, keeping its outlines and shading. |
| `drawOffsetX`, `drawOffsetY`, `shakeCamera(frames, strength)` | How far the fighter is drawn from its position, such as for a shake, and a camera shake. |
| `spawn(name, x, y, vx, vy)` | Creates one of the character's hitboxes at the fighter (see [Hitboxes of your own](#hitboxes-of-your-own)). |
| `switchTo(action)` | Sets its state and action, such as `idle` when a move ends. |

A hitbox has:

| Member | What it is |
| --- | --- |
| `name`, `move` | Its name on the Moves tab, and the game's name for it such as `NPunch-8` or `Fireball@8`. |
| `frame`, `active` | Frames of its life from 0, and whether it can hit, to change. |
| `attribute(name)`, `setAttribute(name, value)` | The move data from the Moves tab, such as `damage`. The `MoveAttribute` type lists the names. |
| `x`, `y`, `vx`, `vy`, `direction`, `rotation` | Position, speed (vx forward along its facing), facing, and the angle it is drawn at. |
| `offsetX`, `offsetY`, `follows` | Where a hitbox that follows its fighter sits, and whether it follows or stays where it is. |
| `moveBy(x, y, collide, throughPlatforms)`, `moveSteps(steps, direction, collide, throughPlatforms)`, `toGround(steps)`, `pointAt(x, y)`, `heading` | Moves it now, stopping at walls and floors unless `collide` is false, sets it on the ground below, or turns it toward a place. |
| `hitWall`, `hitGround` | Whether its last move ran into a wall or a floor. |
| `spawn(name, x, y, vx, vy)`, `copy(name)`, `remove()` | Creates another hitbox where it is, creates one as a copy of it, or ends it. |
| `phase(n, frames)`, `phaseLeft(n)`, `endPhase(n)` | Runs a move in phases, as the original characters' move scripts do. |
| `charge()` | Charges the move while attack is held, as the original characters' NPunch does. |
| `slot(n)`, `slotText(n)`, `setSlot(n, value)` | Its four slots for the script, which a copy starts with, as a number or as text. |
| `survivesHits`, `endsOnLanding`, `outlivesFighter`, `platform()` | Whether it lasts when its fighter is hit, whether it ends when its fighter lands, whether it stays when its fighter is knocked out, and the kind of platform it overlaps. |
| `grabs`, `holding`, `holdAt(x, y, direction)`, `release()`, `closestEnemy()`, `knockbackAdds` | Grabbing and holding a fighter, finding the nearest enemy, and knockback that adds to a target's speed. |
| `armor`, `noHitPause` | Super armor for its fighter while it lasts, and hits that do not pause the game. |
| `changeStats(who, changes)`, `addModifier(who, modifier)` | Changes fighters' stats, such as `{ fallSpeed: ['*', 2] }`, or gives them one of the game's extra modifiers, while it lasts. |
| `ghost`, `size`, `hidden`, `behind`, `animation`, `showFrame(n)`, `paused`, `windowed`, `particle(...)`, `playSound(name)` | How it is drawn and in front of what, which hitbox's effect frames it plays, stopping its animation and Can hit window, particles, and sounds. |

Three rules keep online games in sync, because every player's computer runs the script and rollback replays frames:

- Keep state only in the game: the gimmick slots, a hitbox's slots, or the fighter's values. A variable in the script is not rewound by rollback.
- Use `fighter.random` for randomness. Never use `Math.random`, the clock, or anything from the page.
- Use `fighter.math` for trigonometry and logarithms. `Math.sin` and the others can give different results on different computers.

The original characters and their built-in rules use gimmick slots 1 and 5, so a character that keeps its template's mechanics or follows built-in rules should use slots 2 to 4. A template's move scripts also use a hitbox's slots for its moves.

When a character is a mod on the game's page, its script runs in a sandbox. The script sees only the fighters and hitboxes the game hands it, plus a `console` for messages. It has no page, network, storage or timers, and `Math.random`, `Date.now` and `new Date()` throw there. It can't import anything, and the sandbox refuses a script that calls `eval` directly. A script that follows the rules above runs the same in the sandbox. When a player adds a mod with a script on the Mods screen, the game asks whether to turn the script on and can show it first. The Script button on the Mods screen turns it on or off later. Scripts of characters built into the site from this folder run as part of the site, outside the sandbox.

This example builds heat with each hit, makes hits stronger with more heat, and lets the fighter vent heat by taunting:

```ts
import type { Gimmick } from '@characters/api';

export default {
  hit(fighter, target) {
    const heat = fighter.slot(2);
    target.percent += heat / 10;
    fighter.setSlot(2, Math.min(100, heat + 20));
  },
  frame(fighter, buttons) {
    if (buttons.taunt && fighter.slot(2) > 0) fighter.setSlot(2, fighter.slot(2) - 1);
  },
} satisfies Gimmick;
```

### Hitboxes of your own

A script can throw projectiles and make other hitboxes that no template has. On the Moves tab, choose **New hitbox** under **Own hitboxes**, name it, and give it numbers, effect frames and sounds like any move. A new hitbox is a projectile that hits once. The script creates it with `fighter.spawn(name, x, y)`, which puts it at the fighter, x forward and y up, facing the way the fighter faces. The script's `move` runs for it once its data loads, and `hitbox.name` tells it apart from the character's moves.

The game moves a hitbox of your own by `vx` and `vy` every frame after `tick`. It stops at walls and floors, and `hitWall` and `hitGround` say so. It ends when it runs out of hits, when its fighter is knocked out, when it leaves the stage area, or when the script calls `remove()`. Without one of these it lasts forever, so give it a lifetime. This example fires a bolt on attack, at most once every 20 frames, and removes it after 45 frames or at a wall:

```ts
import type { Gimmick } from '@characters/api';

export default {
  frame(fighter, buttons) {
    const wait = fighter.slot(2);
    if (wait > 0) fighter.setSlot(2, wait - 1);
    else if (buttons.attack) {
      fighter.spawn('Bolt', 12, 10);
      fighter.setSlot(2, 20);
    }
  },
  move(fighter, hitbox) {
    if (hitbox.name === 'Bolt') hitbox.vx = 7;
  },
  tick(fighter, hitbox) {
    if (hitbox.name === 'Bolt' && (hitbox.frame > 45 || hitbox.hitWall)) hitbox.remove();
  },
} satisfies Gimmick;
```

An entry named after an action the script switches the fighter to with `switchTo`, such as Arc Phantom's `Dslsh`, gives that action its Unique animation and Can't move flags, as the original characters' slash actions have.

`spawn` also creates the character's own moves and customized extra hitboxes by name. `vx` and `vy` move the original characters' projectiles too, such as a customized fireball, because their scripts fly them by the same values.

### Scripts on the site

The site's mod maker runs JavaScript and does not compile TypeScript. A compiler in the page would add several megabytes to download, and the script box has no type checking to gain from it. A JavaScript script is the TypeScript one without its types, so the example above works on the site without its first line and without `satisfies Gimmick`. The mod maker loads the script each time you save it, and the Check and play tab shows the error if it does not load.

The two kinds of script move between the mod makers without changes. Importing a `.sfrt` file from the project on the site keeps the JavaScript copy the file carries. The project's build accepts a `gimmick.js` as it is, and its type checking skips it.

## Coming from the original project

| In the original project | Here |
| --- | --- |
| Fighter sprite costumes named `<speed>)<character>'<animation>` | Animations tab |
| Hitbox sprite costumes named `<speed>)<move>-<character>-<n>` | Effect frames on the Moves tab |
| The move data list entry | The Moves tab fields |
| The frame data list entry | When it can hit, on the Moves tab |
| The cannot-move, unique animation, shield breaking, velocity limit, freeze and hit sound lists | The Moves tab fields |
| The character data list entry | Stats tab |
| Menu and intro costumes in each menu sprite | Art tab |
| Character names, descriptions and CPU lists | Overview and CPU tabs |
| Hitboxes a move script creates with a name of their own, such as `Fireball` | Extra hitboxes on the Moves tab |
| Move scripts that check the attack name | The template's scripts, or a gimmick script |
| Checks for one character in the fighter engine, such as Xavier's hover | The template, or Built-in rules on the Overview tab |
| Checks for one move outside the move scripts, such as Darc's grapple | The template, or Built-in rules on the Moves tab |

## Without the editor

`npm run characters:build` checks and builds every character from its `character.json`. Errors name the character and the problem. `npm run characters:export` writes the original characters into `_templates` again.

Players in an online game need the same characters. The game compares builds when players join a room, so builds with different characters never share one. The Red Gnaw tutorial shows how players with the same characters meet online, and how to publish characters in a fork.
