// Builds input scenarios for parity runs into tests/scenarios/*.json.
import fs from 'node:fs';
import path from 'node:path';
import { Rng } from '../src/engine/rng.ts';
import type { Scenario, ScenarioEvent } from './lib/port.ts';

const OUT = path.resolve(import.meta.dirname, '../tests/scenarios');
fs.mkdirSync(OUT, { recursive: true });

/** Player 1 and 2 default keys: right, left, up, down, shield, attack, combo, jump, taunt. */
export const P1 = { R: 'D', L: 'A', U: 'W', D: 'S', shield: 'B', attack: 'V', combo: 'C', jump: 'space', taunt: 'F' };
export const P2 = { R: 'right arrow', L: 'left arrow', U: 'up arrow', D: 'down arrow', shield: '.', attack: ',', combo: 'M', jump: 'N', taunt: 'K' };

export class Script {
  f = 1;
  events: ScenarioEvent[] = [];

  wait(n: number): this {
    this.f += n;
    return this;
  }
  down(key: string, p = 0): this {
    this.events.push({ f: this.f, type: 'key', key, down: true, p });
    return this;
  }
  up(key: string, p = 0): this {
    this.events.push({ f: this.f, type: 'key', key, down: false, p });
    return this;
  }
  tap(key: string, hold = 3, after = 6): this {
    this.down(key).wait(hold).up(key).wait(after);
    return this;
  }
  mouse(x: number, y: number, down?: boolean): this {
    this.events.push({ f: this.f, type: 'mouse', x, y, down });
    return this;
  }
  /** Random presses and releases of `keys` for `frames` frames. */
  fuzz(rng: Rng, keys: string[], frames: number, p = 0): this {
    const held = new Set<string>();
    const end = this.f + frames;
    while (this.f < end) {
      const k = keys[Math.floor(rng.next() * keys.length)];
      if (held.has(k)) {
        this.up(k, p);
        held.delete(k);
      } else {
        this.down(k, p);
        held.add(k);
      }
      this.wait(1 + Math.floor(rng.next() * 12));
    }
    for (const k of held) this.up(k, p);
    return this;
  }
  build(name: string, seed: number, extra = 60): Scenario {
    return { name, seed, frames: this.f + extra, events: this.events };
  }
}

function save(sc: Scenario): void {
  fs.writeFileSync(path.join(OUT, `${sc.name}.json`), JSON.stringify(sc));
  console.log(`${sc.name}: ${sc.frames} frames, ${sc.events.length} events`);
}

const p1Keys = Object.values(P1);

// Title screen, then the first-run tutorial with random play.
{
  const rng = new Rng(11);
  const s = new Script().wait(320).mouse(100, 50).tap('space', 4, 120);
  s.fuzz(rng, p1Keys, 2400);
  save(s.build('tutorial-fuzz', 7));
}

// Title screen, tutorial, then pause to leave for the main menu.
function toMainMenu(): Script {
  return new Script().wait(320).tap('space', 4, 200).tap('P', 4, 200);
}
save(toMainMenu().build('to-main-menu', 3, 200));

// Long random wandering from the main menu: both players' keys, the pause key and mouse clicks.
// Confirm and movement keys are weighted up so runs reach character select and matches.
for (const seed of [21, 22, 23]) {
  const rng = new Rng(seed);
  const s = toMainMenu();
  const keys = [...p1Keys, 'V', 'V', 'V', 'D', 'A', 'W', 'S', ...Object.values(P2), 'P'];
  for (let block = 0; block < 40; block++) {
    if (rng.next() < 0.3) {
      s.mouse(Math.round(rng.next() * 440 - 220), Math.round(rng.next() * 320 - 160), true).wait(3);
      s.mouse(Math.round(rng.next() * 440 - 220), Math.round(rng.next() * 320 - 160), false);
    }
    s.fuzz(rng, keys, 200);
  }
  save(s.build(`wander-${seed}`, seed, 120));
}

// Exploration: versus from the main menu, confirming through each screen.
{
  const s = toMainMenu().tap('D', 3, 30).tap('V', 3, 60);
  for (let i = 0; i < 4; i++) s.tap('S', 3, 20);
  s.tap('V', 3, 60).tap('V', 3, 60).tap('D', 3, 30).tap('V', 3, 60).tap('V', 3, 60).tap('V', 3, 120);
  save(s.build('explore-versus', 5, 400));
}
