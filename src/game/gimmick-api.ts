// The API a character pack's gimmick script uses. Gimmick code runs inside the simulation, so it must be
// deterministic and rollback must be able to rewind it: keep state only in game values (such as the
// fighter's gimmick slots), never in module variables, and use fighter.random rather than Math.random.
//
// Scripts get frozen facade objects whose methods close over the runtime. Nothing reachable from a
// facade leads back to the runtime, the page or the global object, which is what lets mod scripts run
// in a sandbox (src/client/mod-sandbox.ts) with these objects as their only way into the game.
import { toNumber, type Value } from '../engine/cast.ts';
import type { Runtime } from '../engine/runtime.ts';
import type { Target } from '../engine/target.ts';
import { MOVE_FIELDS } from './pack-format.ts';

export interface Buttons {
  readonly right: boolean;
  readonly left: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly shield: boolean;
  readonly attack: boolean;
  readonly combo: boolean;
  readonly jump: boolean;
  readonly taunt: boolean;
}

export interface Gimmick {
  /** Every frame, before the fighter engine runs, with the buttons held this frame. */
  frame?(fighter: Fighter, buttons: Buttons): void;
  /** When a hitbox of one of this fighter's moves (or projectiles) starts, after its data is loaded. */
  move?(fighter: Fighter, hitbox: Hitbox): void;
  /** When one of this fighter's hitboxes connects with another fighter (shielded hits too), before knockback and damage. */
  hit?(fighter: Fighter, target: Fighter, hitbox: Hitbox): void;
  /** Every frame of each of this fighter's hitboxes, except during hit pause. */
  tick?(fighter: Fighter, hitbox: Hitbox): void;
}

type Lists = Record<string, Value[]>;
type Slot = 1 | 2 | 3 | 4 | 5;
type MoveField = (typeof MOVE_FIELDS)[number][0];

/** One fighter in the match, by its place in the game's per-fighter lists. */
export interface Fighter {
  /** 1-based fighter number (player slot order in the match). */
  readonly index: number;
  /** Character number (1 to 7 for the originals, 8 and up for packs and mods). */
  readonly character: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Damage percent. */
  percent: number;
  /** Facing: 90 is right, -90 is left. */
  readonly direction: number;
  /** Movement state, such as "idle", "run", "jump", "fall" or "crouch". */
  readonly state: string;
  /** What the fighter is doing, such as "idle", "NPunch", "E1", "shield", "hurt" or "ledge". */
  readonly action: string;
  /** Frames of invincibility left. */
  invincibility: number;
  /** Frames of hitstun left. */
  hitstun: number;
  /** Combo meter, 0 to 100. */
  comboMeter: number;
  /** Hurtbox width. */
  readonly width: number;
  /** Hurtbox height. */
  readonly height: number;
  /** Game frames since the game started (30 per second), for timers kept in the gimmick slots. */
  readonly time: number;
  /** The fighter's gimmick slots, the place to keep gimmick state. The original characters use slots 1 and 5. */
  slot(n: Slot): number;
  setSlot(n: Slot, v: number): void;
  /** A whole number from `from` to `to`, from the game's seeded random source. */
  random(from: number, to: number): number;
  /** Every fighter in the match, this one included. */
  all(): Fighter[];
  /**
   * Shows a particle at this fighter, offset by x and y (y is up): one of the script's character's
   * particles, which plays once, or one of the game's own such as "02_Expl". Layer 3 draws in front of the
   * fighters, 2 with them, and 1 behind the stage.
   */
  particle(name: string, x?: number, y?: number, layer?: 1 | 2 | 3): void;
  /** The stage's lists and variables, for anything not covered above. */
  readonly lists: Lists;
  readonly vars: Record<string, Value>;
}

/** One hitbox: a move's attack area (or a projectile) while it exists. */
export interface Hitbox {
  /** The move's name with the character number, such as "NPunch-8". */
  readonly move: string;
  /** Frame of the hitbox's life, from 0 (the count that sound cues and the active window use). */
  readonly frame: number;
  /** Whether the hitbox can hit this frame. */
  active: boolean;
  /** One of the 19 move attributes (see MOVE_FIELDS), as currently set for this hitbox. */
  attribute(name: MoveField): Value;
  setAttribute(name: MoveField, v: Value): void;
  /** Plays one of the hitbox sprite's sounds, such as "hit3", "Charged" or "ShieldBreak". */
  playSound(name: string): void;
}

/** The character whose script is running: what its particle names mean, and how its objects are frozen. */
interface Owner {
  id: number;
  particles: ReadonlySet<string>;
  freeze: <T extends object>(o: T) => T;
  /** What a script sees of the game's lists and variables. */
  guard: <T extends object>(o: T) => T;
}

/** Only numbers, strings and booleans go into the game's data, so a script cannot leave objects of its own there. */
const plain = (v: unknown): Value => (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : String(v));

/** A view of the game's lists or variables whose writes store only plain values, at every depth. */
function guarded<T extends object>(o: T): T {
  return new Proxy(o, {
    get: (t, k) => {
      const v = Reflect.get(t, k);
      return typeof v === 'object' && v !== null ? guarded(v) : v;
    },
    set: (t, k, v) => Reflect.set(t, k, plain(v)),
    defineProperty: (t, k, d) => ('value' in d ? Reflect.defineProperty(t, k, { ...d, value: plain(d.value) }) : false),
    setPrototypeOf: () => false,
  });
}

function makeFighter(rt: Runtime, index: number, owner: Owner): Fighter {
  const l = () => rt.stage.l as Lists;
  const num = (list: string, i: number) => toNumber(l()[list][i]);
  const put = (list: string, i: number, v: unknown) => {
    l()[list][i] = Number(v);
  };
  const cond = (n: number) => (index - 1) * 8 + n - 1;
  const pair = (index - 1) * 2;
  const f: Fighter = {
    index,
    get character() {
      return toNumber(l().CHARACTERS[index - 1]);
    },
    get x() {
      return num('C_Pos', pair);
    },
    set x(v) {
      put('C_Pos', pair, v);
    },
    get y() {
      return num('C_Pos', pair + 1);
    },
    set y(v) {
      put('C_Pos', pair + 1, v);
    },
    get vx() {
      return num('C_Velocity', pair);
    },
    set vx(v) {
      put('C_Velocity', pair, v);
    },
    get vy() {
      return num('C_Velocity', pair + 1);
    },
    set vy(v) {
      put('C_Velocity', pair + 1, v);
    },
    get percent() {
      return num('Percentage', index - 1);
    },
    set percent(v) {
      put('Percentage', index - 1, v);
    },
    get direction() {
      return num('C_Conditions', cond(7));
    },
    get state() {
      return String(l().C_Conditions[cond(4)]);
    },
    get action() {
      return String(l().C_Conditions[cond(5)]);
    },
    get invincibility() {
      return num('C_Conditions', cond(3));
    },
    set invincibility(v) {
      put('C_Conditions', cond(3), v);
    },
    get hitstun() {
      return num('C_Conditions', cond(2));
    },
    set hitstun(v) {
      put('C_Conditions', cond(2), v);
    },
    get comboMeter() {
      return num('COMBOMETER', index - 1);
    },
    set comboMeter(v) {
      put('COMBOMETER', index - 1, v);
    },
    get width() {
      return num('PlayerHitboxLengthWidth', pair);
    },
    get height() {
      return num('PlayerHitboxLengthWidth', pair + 1);
    },
    get time() {
      return rt.frame;
    },
    slot: (n) => num('Gimmicks5MAX', (index - 1) * 5 + n - 1),
    setSlot: (n, v) => put('Gimmicks5MAX', (index - 1) * 5 + n - 1, Number(v)),
    random: (from, to) => rt.pickRandom(Number(from), Number(to)),
    all: () => owner.freeze(Array.from({ length: l().CHARACTERS.length }, (_, i) => makeFighter(rt, i + 1, owner))),
    particle: (name, x = 0, y = 0, layer = 3) => {
      const n = String(name).replace(/['°]/g, '');
      const id = owner.particles.has(n) ? `${n}@${owner.id}` : n;
      const list = l().BroadcastParticle;
      list[index - 1] = `${String(list[index - 1] ?? '')}${id}'${f.x + Number(x)}'${f.y + Number(y)}'90'0'${Number(layer)}'°`;
    },
    get lists() {
      return owner.guard(l());
    },
    get vars() {
      return owner.guard(rt.stage.v as Record<string, Value>);
    },
  };
  return owner.freeze(f);
}

function makeHitbox(rt: Runtime, t: Target, owner: Owner): Hitbox {
  const attrs = () => t.l.MoveAttributes as Value[];
  const field = (name: MoveField) => MOVE_FIELDS.findIndex(([k]) => k === name);
  return owner.freeze({
    get move() {
      return String(t.v.AttackID);
    },
    get frame() {
      return toNumber(t.v.framecount_lifeTime) - 1;
    },
    get active() {
      return toNumber(t.v.active) === 1;
    },
    set active(v: boolean) {
      t.v.active = v ? '1' : '0';
    },
    attribute: (name: MoveField) => attrs()[field(name)],
    setAttribute: (name: MoveField, v: Value) => {
      attrs()[field(name)] = plain(v);
    },
    playSound: (name: string) => rt.startSound(t, String(name)),
  });
}

/** A loaded gimmick script and how to call it. */
export interface GimmickScript {
  gimmick: Gimmick;
  /** Mod scripts run in the sandbox, so their objects are hardened rather than frozen. */
  freeze?: <T extends object>(o: T) => T;
}

/**
 * Plays pack moves' sound cues, ends pack particles after one play, and calls the gimmick scripts of
 * pack characters (by character number). A script that throws loses that one call and the game goes on.
 */
export function gimmickHandler(rt: Runtime, scripts: Record<number, GimmickScript>, cues: Record<string, [number, string][]>, particles: Record<number, string[]>): Runtime['gimmickHandler'] {
  const owners = new Map<number, Owner>();
  const ownerOf = (id: number) => {
    let o = owners.get(id);
    if (!o) {
      const sandboxed = !!scripts[id]?.freeze;
      o = { id, particles: new Set(particles[id] ?? []), freeze: scripts[id]?.freeze ?? Object.freeze, guard: sandboxed ? guarded : (x) => x };
      owners.set(id, o);
    }
    return o;
  };
  const reported = new Set<string>();
  const fighterOf = (t: Target) => toNumber(t.v.cloneID);
  const characterOf = (index: number) => toNumber((rt.stage.l.CHARACTERS as Value[])[index - 1]);
  const b = (v: Value) => v === true || v === 'true' || toNumber(v) !== 0;
  return (event, t, args) => {
    if (event === 'particle') {
      // A pack particle ends when its animation has moved past its own frames. A new particle still shows
      // the "error" costume it was cloned with, and its start script resets it while it shows its own.
      const id = String(t.v.particleID);
      const shown = t.costumeName();
      if (id.includes('@') && toNumber(t.v.clone_lifetimeFrames) > 0 && shown !== 'error' && !shown.toLowerCase().includes(`${id}-`.toLowerCase())) rt.deleteThisClone(t);
      return;
    }
    if (event === 'tick') {
      const list = cues[String(t.v.AttackID)];
      if (list) for (const [frame, sound] of list) if (toNumber(t.v.framecount_lifeTime) === frame + 1) rt.startSound(t, sound);
    }
    const index = fighterOf(t);
    const id = characterOf(index);
    const g = scripts[id]?.gimmick;
    if (!g) return;
    const owner = ownerOf(id);
    const f = makeFighter(rt, index, owner);
    try {
      if (event === 'frame' && g.frame) {
        const [right, left, up, down, shield, attack, combo, jump, taunt] = args.map(b);
        g.frame(f, owner.freeze({ right, left, up, down, shield, attack, combo, jump, taunt }));
      } else if (event === 'move' && g.move) g.move(f, makeHitbox(rt, t, owner));
      else if (event === 'hit' && g.hit) g.hit(f, makeFighter(rt, toNumber(args[0]), owner), makeHitbox(rt, t, owner));
      else if (event === 'tick' && g.tick) g.tick(f, makeHitbox(rt, t, owner));
    } catch (e) {
      const key = `${id}:${event}:${e instanceof Error ? e.message : String(e)}`;
      if (!reported.has(key)) {
        reported.add(key);
        console.error(`Gimmick script of character ${id} failed in ${event}:`, e);
      }
    }
  };
}
