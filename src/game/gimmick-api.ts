// The API a character pack's gimmick script uses. Gimmick code runs inside the simulation, so it must be
// deterministic and rollback must be able to rewind it: keep state only in game values (such as the
// fighter's gimmick slots), never in module variables, and use fighter.random rather than Math.random.
//
// Scripts get frozen facade objects whose methods close over the runtime. Nothing reachable from a
// facade leads back to the runtime, the page or the global object, which is what lets mod scripts run
// in a sandbox (src/client/mod-sandbox.ts) with these objects as their only way into the game.
import { mathop, toNumber, type Value } from '../engine/cast.ts';
import { KILLED, type Runtime, type Tint } from '../engine/runtime.ts';
import type { Target } from '../engine/target.ts';
import { EXTRA_HITBOXES, HITBOX_SPRITE, MOVE_FIELDS, packHitboxId, PLAYER_SPRITE, STAT_FIELDS } from './pack-format.ts';
import { scriptMessage } from './script-messages.ts';

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
/** A move attribute by its name on the Moves tab, such as "damage" or "knockbackX" (see MOVE_FIELDS). */
export type MoveAttribute = (typeof MOVE_FIELDS)[number][0];
type StatField = (typeof STAT_FIELDS)[number][0];

/** A change to a stat: an operator and a value, such as ["*", 2] to double it. */
export type StatChange = ['+' | '-' | '*' | '/', number];

/**
 * Extra modifiers the game knows: "No100Combo" stops the "Best" combo setting from filling the combo meter,
 * "DisableAttacks" stops attacks and "DisableDefense" stops shielding and dodging.
 */
export type ExtraModifier = 'No100Combo' | 'DisableAttacks' | 'DisableDefense';
const EXTRA_MODIFIERS: readonly string[] = ['No100Combo', 'DisableAttacks', 'DisableDefense'];

/** The game's math in degrees, which gives the same result on every computer, as online games need. */
export interface GameMath {
  sin(degrees: number): number;
  cos(degrees: number): number;
  tan(degrees: number): number;
  /** Results in degrees. */
  asin(n: number): number;
  acos(n: number): number;
  atan(n: number): number;
  /** Natural logarithm. */
  ln(n: number): number;
  log(n: number): number;
  exp(n: number): number;
}

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
  direction: number;
  /** The fighter's team, or "" when it is on none. */
  readonly team: string;
  /** How far the fighter is drawn from its position, such as for a shake. It does not move the fighter. */
  drawOffsetX: number;
  drawOffsetY: number;
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
   * fighters, 2 with them, and 1 behind the stage. Direction turns it, 90 being unturned.
   */
  particle(name: string, x?: number, y?: number, layer?: 1 | 2 | 3, direction?: number): void;
  /** Shakes the camera for a number of frames, by up to `strength` pixels each way. */
  shakeCamera(frames: number, strength: number): void;
  /** Trigonometry and logarithms as the game computes them. Use these rather than Math's, which can differ between computers. */
  readonly math: GameMath;
  /**
   * Paints this fighter in a color ("#rrggbb" or "#rgb") for a number of game frames, keeping its outlines
   * and shading. The color fades over the last 10 frames. A new tint replaces the last one, and 0 frames ends it.
   */
  tint(color: string, frames: number): void;
  /**
   * Creates one of this character's hitboxes by its name on the Moves tab, such as a hitbox of its own,
   * at this fighter offset by x (forward) and y (up), facing the way the fighter faces, with a starting
   * vx and vy. The script's `move` runs for it once its data loads. Only the fighter the script runs for can spawn.
   */
  spawn(name: string, x?: number, y?: number, vx?: number, vy?: number): void;
  /** The buttons this fighter's player holds this frame. */
  readonly buttons: Buttons;
  /** Sets the fighter's state and action, such as "idle" when a move ends, as the game's own move scripts do. */
  switchTo(status: string): void;
  /** Jumps left before the fighter lands again. */
  jumps: number;
  /** The stage's lists and variables, for anything not covered above. */
  readonly lists: Lists;
  readonly vars: Record<string, Value>;
}

/** One hitbox: a move's attack area (or a projectile) while it exists. */
export interface Hitbox {
  /** The move's name with the character number, such as "NPunch-8", or an extra hitbox's, such as "Fireball" or a pack's own "Fireball@8". */
  readonly move: string;
  /** Frame of the hitbox's life, from 0 (the count that sound cues and the active window use). */
  readonly frame: number;
  /** Whether the hitbox can hit this frame. */
  active: boolean;
  /** One of the 19 move attributes (see MOVE_FIELDS), as currently set for this hitbox. */
  attribute(name: MoveAttribute): Value;
  setAttribute(name: MoveAttribute, v: Value): void;
  /** Plays one of the hitbox sprite's sounds, such as "hit3", "Charged" or "ShieldBreak". */
  playSound(name: string): void;
  /** The name the Moves tab gives it, such as "NPunch", "Fireball" or a hitbox of the character's own. */
  readonly name: string;
  /** Position on the stage. A hitbox that follows its fighter is put back on the fighter each frame. */
  x: number;
  y: number;
  /**
   * Speed per frame: vx forward along the hitbox's facing, vy up. The game moves the character's own
   * hitboxes by it every frame after `tick`, and the original characters' projectiles use it too.
   */
  vx: number;
  vy: number;
  /** Facing: 90 is right, -90 is left. Setting it also turns how it is drawn. Knockback goes along it, so 0 sends straight up. */
  direction: number;
  /** Whether the last move ran into a wall, or into the ground or a ceiling. */
  readonly hitWall: boolean;
  readonly hitGround: boolean;
  /** Removes the hitbox when the script's function returns. */
  remove(): void;
  /** Like fighter.spawn, but at this hitbox (x forward along its facing, y up) and facing its way, such as fire left where a fireball lands. */
  spawn(name: string, x?: number, y?: number, vx?: number, vy?: number): void;
  /**
   * Moves the hitbox now, x forward along its facing and y up, and sets hitWall and hitGround. Unless
   * collide is false it stops at walls and floors, and unless throughPlatforms is true it lands on platforms
   * it can jump through. The game then does not move it by vx and vy this frame.
   */
  moveBy(x: number, y: number, collide?: boolean, throughPlatforms?: boolean): void;
  /** Whether its knockback adds to the target's speed instead of setting it, so small hits pull or push a little each time. */
  knockbackAdds: boolean;
  /** Whether it grabs rather than hits: a fighter it touches is held, at the place holdAt gives, until it ends. */
  grabs: boolean;
  /** Whether it has grabbed a fighter. It stays true after release. */
  readonly holding: boolean;
  /** Where the grabbed fighter is held, from this hitbox's fighter: x forward, y up. Direction turns how the held fighter is drawn, 90 being upright. */
  holdAt(x: number, y: number, direction?: number): void;
  /**
   * Runs the move in phases, as the original characters' move scripts do. Call phase(1, frames), phase(2,
   * frames) and on in order every frame. Phase n runs for its frames once phase n - 1 is over, starting on
   * the last frame of phase n - 1, and phase returns whether it runs this frame.
   */
  phase(n: number, frames: number): boolean;
  /** Frames left in phase n, which is 0 or less once it is over. */
  phaseLeft(n: number): number;
  /** Ends phase n now, so the next phase starts this frame. */
  endPhase(n: number): void;
  /**
   * Charges the move while attack is held, as the original characters' NPunch does, for up to 50 frames.
   * Call it every frame. It returns true while it is still charging. On release the hitbox grows and hits
   * harder by how long it charged, and slot 1 holds the life frame (from 1) it was let go on.
   */
  charge(): boolean;
  /** The hitbox's own values for the script, from slot 1 to 4. A copy starts with this hitbox's values. */
  slot(n: 1 | 2 | 3 | 4): number;
  /** A slot as text, for words a slot can hold, such as "ENEMY" from the rules of Darc's grapple. */
  slotText(n: 1 | 2 | 3 | 4): string;
  setSlot(n: 1 | 2 | 3 | 4, v: number | string): void;
  /** Whether it lasts when its fighter is hit. A hitbox that follows its fighter otherwise ends then. */
  survivesHits: boolean;
  /** Whether it ends once its fighter is on the ground. */
  endsOnLanding: boolean;
  /** Whether it stays when its fighter is knocked out. A projectile otherwise ends then. */
  outlivesFighter: boolean;
  /** The kind of platform it overlaps now: 0 for none, 1 for solid ground, 4 for a platform fighters can jump through. */
  platform(): number;
  /**
   * Creates one of this character's hitboxes by its name as a copy of this one, as the original characters'
   * moves do: it starts where this one is, facing its way, with its speed, heading, rotation, slots, look and
   * flags, and then the data of its own move.
   */
  copy(name: string): void;
  /** Shows a particle at this hitbox, as fighter.particle does at the fighter. */
  particle(name: string, x?: number, y?: number, layer?: 1 | 2 | 3, direction?: number): void;
  /** Whether its fighter has super armor while it lasts: hits damage the fighter but do not knock it back or stun it. */
  armor: boolean;
  /** Whether it is not drawn. */
  hidden: boolean;
  /** Whether its hits do not pause the game. */
  noHitPause: boolean;
  /** Whether it is drawn with the stage, behind the fighters. */
  behind: boolean;
  /** Starts its animation over at effect frame n (from 1). */
  showFrame(n: number): void;
  /**
   * Changes stats of fighters while this hitbox lasts, such as { fallSpeed: ["*", 2] }. `who` is a fighter,
   * a list of fighters, or "all".
   */
  changeStats(who: Fighter | Fighter[] | 'all', changes: Partial<Record<StatField, StatChange>>): void;
  /** Gives fighters one of the game's extra modifiers while this hitbox lasts. */
  addModifier(who: Fighter | Fighter[] | 'all', modifier: ExtraModifier): void;
  /** Where a hitbox that follows its fighter sits, from the fighter's position: x forward, y up. */
  offsetX: number;
  offsetY: number;
  /** The direction it is drawn in, 90 being unturned. It shows when the move's Rotation is "all". */
  rotation: number;
  /** Moves the hitbox now by steps along a direction (0 is up, 90 is right), as moveBy does. */
  moveSteps(steps: number, direction: number, collide?: boolean, throughPlatforms?: boolean): void;
  /** Moves the hitbox down onto the ground, by up to this many steps. hitGround says whether it got there. */
  toGround(steps: number): void;
  /** Points heading and rotation at a place on the stage. */
  pointAt(x: number, y: number): void;
  /** A direction the script keeps for moveSteps, such as a spin, which pointAt also sets. */
  heading: number;
  /** The nearest fighter on another team that is still in the match, or null. */
  closestEnemy(): Fighter | null;
  /** Lets go of a fighter it holds. */
  release(): void;
  /** Whether it follows its fighter (a melee hitbox) rather than staying where it is (a projectile). */
  follows: boolean;
  /** How see-through it is drawn, from 0 to 100. */
  ghost: number;
  /** Whether its Can hit window turns it on and off. A move with a window starts with this on. */
  windowed: boolean;
  /** While true, its effect frames and its Can hit window stop counting, as a held charge attack does. */
  paused: boolean;
  /** How big it is drawn, in percent of its frames' size. */
  size: number;
  /** Another of the character's hitboxes whose effect frames it plays instead of its own, or "" for its own. */
  animation: string;
}

/** The character whose script is running: what its particle names mean, and how its objects are frozen. */
interface Owner {
  id: number;
  particles: ReadonlySet<string>;
  freeze: <T extends object>(o: T) => T;
  /** What a script sees of the game's lists and variables. */
  guard: <T extends object>(o: T) => T;
  math: GameMath;
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

/** The stage list of fighter tints: a color and the frame it ends on, for each fighter. Rollback saves it with the other lists. */
const TINT = 'GimmickTint';
const TINT_STRENGTH = 0.85;
const TINT_FADE = 10;

/** A "#rrggbb" or "#rgb" color as a number. */
function colorNumber(color: string): number {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) throw new Error(`tint takes a color such as "#e8242c", not "${color}"`);
  return parseInt(hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex, 16);
}

/** How the renderer paints fighters that a script tinted: only their animation frames, named like 1)8'idle2, and not their shadow or marker. */
export function fighterTint(rt: Runtime): (t: Target) => Tint | null {
  return (t) => {
    const list = rt.stage.l[TINT];
    if (!list || t.isOriginal || t.sprite.name !== PLAYER_SPRITE || !t.costumeName().includes("'")) return null;
    const i = (toNumber(t.v.cloneID) - 1) * 2;
    const left = toNumber(list[i + 1]) - rt.frame;
    if (!(left > 0)) return null;
    const c = toNumber(list[i]);
    return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, TINT_STRENGTH * Math.min(1, left / TINT_FADE)];
  };
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
    set direction(v) {
      put('C_Conditions', cond(7), v);
    },
    get team() {
      return String(l().C_Team?.[index - 1] ?? '');
    },
    get drawOffsetX() {
      return num('C_PosOffset', pair);
    },
    set drawOffsetX(v) {
      put('C_PosOffset', pair, v);
    },
    get drawOffsetY() {
      return num('C_PosOffset', pair + 1);
    },
    set drawOffsetY(v) {
      put('C_PosOffset', pair + 1, v);
    },
    shakeCamera: (frames, strength) => {
      const list = l().BroadcastCamera;
      list[0] = 'Shake';
      list[1] = Number(frames);
      list[2] = Number(strength);
    },
    math: owner.math,
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
    particle: (name, x = 0, y = 0, layer = 3, direction = 90) => addParticle(rt, owner, index, name, f.x + Number(x), f.y + Number(y), layer, direction),
    spawn: (name, x = 0, y = 0, vx = 0, vy = 0) => {
      const dir = f.direction < 0 ? -1 : 1;
      spawnHitbox(rt, owner, index, name, f.x + Number(x) * dir, f.y + Number(y), dir, vx, vy);
    },
    get jumps() {
      return num('C_Jumps', index - 1);
    },
    set jumps(v) {
      put('C_Jumps', index - 1, v);
    },
    switchTo: (status) => {
      const s = plain(status);
      put('C_Conditions', cond(1), 1);
      l().C_Conditions[cond(4)] = s;
      l().C_Conditions[cond(5)] = s;
    },
    get buttons() {
      const max = toNumber((rt.stage.v as Record<string, Value>).Data_PlayerMaxInputs);
      const pressed = l().Player_CurrentButtonsPressed ?? [];
      const on = (n: number) => held(pressed[index * max + n - 1]);
      return owner.freeze({ right: on(1), left: on(2), up: on(3), down: on(4), shield: on(5), attack: on(6), combo: on(7), jump: on(8), taunt: on(9) });
    },
    tint: (color, frames) => {
      const list = (l()[TINT] ??= []);
      while (list.length < pair + 2) list.push(0);
      list[pair] = colorNumber(String(color));
      list[pair + 1] = rt.frame + Math.max(0, Math.floor(Number(frames)) || 0);
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

/** Adds a particle to the fighter's list of particles to show this frame, at a place on the stage. */
function addParticle(rt: Runtime, owner: Owner, index: number, name: unknown, x: number, y: number, layer: unknown, direction: unknown): void {
  const n = String(name).replace(/['°]/g, '');
  const id = owner.particles.has(n) ? `${n}@${owner.id}` : n;
  const list = rt.stage.l.BroadcastParticle as Value[];
  list[index - 1] = `${String(list[index - 1] ?? '')}${id}'${x}'${y}'${Number(direction)}'0'${Number(layer)}'°`;
}

/** The game's character list for a modifier: one fighter number, several joined by °, or "all". */
function fightersArg(who: unknown): string {
  if (who === 'all') return 'all';
  const one = (f: unknown) => {
    const i = Number((f as { index?: unknown } | null)?.index);
    if (!Number.isInteger(i) || i < 1) throw new Error('expected a fighter, a list of fighters, or "all"');
    return i;
  };
  return Array.isArray(who) ? who.map(one).join('°') : String(one(who));
}

function makeMath(freeze: Owner['freeze']): GameMath {
  const op = (name: string) => (n: number) => mathop(name, Number(n));
  return freeze({ sin: op('sin'), cos: op('cos'), tan: op('tan'), asin: op('asin'), acos: op('acos'), atan: op('atan'), ln: op('ln'), log: op('log'), exp: op('e ^') });
}

/** What a script asked of a hitbox, done after the script returns because removing a hitbox ends its thread. */
interface Requests {
  remove: boolean;
  /** The script moved the hitbox itself this frame, so the game does not. */
  moved: boolean;
  /** A move took the hitbox off the stage, which deleted it, so its thread ends once the script returns. */
  deleted: boolean;
}

const held = (v: Value | undefined) => v === true || v === 'true' || toNumber(v ?? 0) !== 0;

/**
 * Creates one of a pack character's hitboxes for a fighter at a place, through the game's own manual creation.
 * The new hitbox copies the original Hitboxes sprite's variables, so its starting speed is set there for the call.
 */
function spawnHitbox(rt: Runtime, owner: Owner, fighter: number, name: unknown, x: number, y: number, facing: number, vx: number, vy: number): void {
  const n = String(name);
  const character = toNumber((rt.stage.l.CHARACTERS as Value[])[fighter - 1]);
  if (character !== owner.id || !rt.characters.get(String(owner.id))?.owns.has(n)) throw new Error(`spawn: "${n}" is not a hitbox of this character`);
  const source = rt.targets.find((o) => o.isOriginal && o.sprite.name === HITBOX_SPRITE);
  if (!source) return;
  const [oldX, oldY] = [source.v.clone_xVel, source.v.clone_yVel];
  source.v.clone_xVel = Number(vx) || 0;
  source.v.clone_yVel = Number(vy) || 0;
  try {
    rt.hitboxProcs.create?.(source, fighter, packHitboxId(n, owner.id), x, y, facing < 0 ? -90 : 90);
  } finally {
    source.v.clone_xVel = oldX;
    source.v.clone_yVel = oldY;
  }
}

/** A pack character's hitbox of its own ("Bolt@9"), which only scripts create and move. */
function isOwnHitbox(rt: Runtime, t: Target): boolean {
  const m = /^(.+)@(\d+)$/.exec(String(t.v.AttackID));
  return !!m && rt.characters.has(m[2]) && !EXTRA_NAMES.has(m[1]);
}

const EXTRA_NAMES = new Set(EXTRA_HITBOXES.map((x) => x.name));

/** A hitbox's script values are the move scripts' misc1 to misc4, which only a template's scripts also use. */
function miscVar(n: unknown): string {
  const i = Number(n);
  if (!(i === 1 || i === 2 || i === 3 || i === 4)) throw new Error('a hitbox has slots 1 to 4');
  return `misc${i}`;
}

function makeHitbox(rt: Runtime, t: Target, owner: Owner, requests: Requests): Hitbox {
  const attrs = () => t.l.MoveAttributes as Value[];
  const field = (name: MoveAttribute) => MOVE_FIELDS.findIndex(([k]) => k === name);
  const impact = (n: number) => String((t.l.collision_ImpactChecks as Value[] | undefined)?.[n]) === 'true';
  // The game's moves delete a hitbox that leaves the stage, which ends its thread once the script returns.
  const moving = (move: () => void) => {
    requests.moved = true;
    try {
      move();
    } catch (e) {
      if (e !== KILLED) throw e;
      requests.deleted = true;
    }
  };
  return owner.freeze({
    get name() {
      return String(t.v.AttackID)
        .replace(/@\d+$/, '')
        .replace(/^([A-Za-z][A-Za-z0-9]*)-\d+$/, '$1');
    },
    get x() {
      return toNumber(t.v.xpos);
    },
    set x(v: number) {
      t.v.xpos = Number(v);
    },
    get y() {
      return toNumber(t.v.ypos);
    },
    set y(v: number) {
      t.v.ypos = Number(v);
    },
    get vx() {
      return toNumber(t.v.clone_xVel);
    },
    set vx(v: number) {
      t.v.clone_xVel = Number(v);
    },
    get vy() {
      return toNumber(t.v.clone_yVel);
    },
    set vy(v: number) {
      t.v.clone_yVel = Number(v);
    },
    get direction() {
      return toNumber(t.v.direc);
    },
    set direction(v: number) {
      t.v.direc = Number(v);
      t.v.direc_visual = Number(v);
    },
    get hitWall() {
      return impact(0);
    },
    get hitGround() {
      return impact(1);
    },
    remove: () => {
      requests.remove = true;
    },
    spawn: (name: string, x = 0, y = 0, vx = 0, vy = 0) => {
      const dir = toNumber(t.v.direc) < 0 ? -1 : 1;
      spawnHitbox(rt, owner, toNumber(t.v.cloneID), name, toNumber(t.v.xpos) + Number(x) * dir, toNumber(t.v.ypos) + Number(y), dir, vx, vy);
    },
    moveBy: (x: number, y: number, collide = true, throughPlatforms = false) => moving(() => rt.hitboxProcs.move?.(t, Number(x), Number(y), '0', collide ? '1' : '0', throughPlatforms ? '1' : '0')),
    moveSteps: (steps: number, direction: number, collide = true, throughPlatforms = false) =>
      moving(() => rt.hitboxProcs.steps?.(t, Number(steps), Number(direction), collide ? '1' : '0', throughPlatforms ? '1' : '0')),
    toGround: (steps: number) => moving(() => rt.hitboxProcs.toGround?.(t, Number(steps))),
    pointAt: (x: number, y: number) => rt.hitboxProcs.pointAt?.(t, Number(x), Number(y)),
    get heading() {
      return toNumber(t.v.direc_calc);
    },
    set heading(v: number) {
      t.v.direc_calc = Number(v);
    },
    closestEnemy: () => {
      rt.hitboxProcs.closestEnemy?.(t);
      const found = toNumber((t.l.clone_determineClosestEnemyData as Value[] | undefined)?.[2]);
      return found > 0 ? makeFighter(rt, found, owner) : null;
    },
    release: () => rt.hitboxProcs.release?.(t),
    get follows() {
      return String(t.v.cloneType) === '2';
    },
    set follows(v: boolean) {
      t.v.cloneType = v ? '2' : '1';
    },
    get ghost() {
      return t.effects.ghost;
    },
    set ghost(v: number) {
      t.setEffect('ghost', Number(v));
    },
    get windowed() {
      return String(t.v.clone_hasFrameData) === '1';
    },
    set windowed(v: boolean) {
      t.v.clone_hasFrameData = v ? '1' : '0';
    },
    get paused() {
      return String(t.v.clone_stopAnimation) === '1';
    },
    set paused(v: boolean) {
      t.v.clone_stopAnimation = v ? '1' : '0';
      t.v.clone_stopFrameDataCount = v ? '1' : '0';
    },
    get size() {
      return toNumber(t.v.size);
    },
    set size(v: number) {
      t.v.size = Number(v);
    },
    get animation() {
      const a = String(t.v.AttackID_OverwriteAnimationID);
      return a === '0' ? '' : a.replace(/@\d+$/, '');
    },
    set animation(name: string) {
      const n = String(name);
      t.v.AttackID_OverwriteAnimationID = n ? packHitboxId(n, owner.id) : '0';
    },
    get knockbackAdds() {
      return String(t.v.clone_KnockbackAdditive) === '1';
    },
    set knockbackAdds(v: boolean) {
      t.v.clone_KnockbackAdditive = v ? '1' : '0';
    },
    get grabs() {
      return String(t.v.AttackGrab) === '1';
    },
    set grabs(v: boolean) {
      t.v.AttackGrab = v ? '1' : '0';
    },
    get holding() {
      return String(t.v.GrabSuccessful) === '1';
    },
    holdAt: (x: number, y: number, direction = 90) => {
      if (String(t.v.GrabSuccessful) !== '1') return;
      const at = (toNumber(t.v.cloneID) - 1) * 3;
      const place = rt.stage.l.C_GrabLocation as Value[];
      place[at] = Number(x);
      place[at + 1] = Number(y);
      place[at + 2] = Number(direction);
    },
    phase: (n: number, frames: number) => {
      rt.hitboxProcs.phase?.(t, Number(frames), Number(n));
      return String((t.l.moveScript_Checks as Value[])[1]) === 'true';
    },
    phaseLeft: (n: number) => toNumber((t.l.hitboxCheck_repeatCounters as Value[])[Number(n) - 1] ?? 0),
    endPhase: (n: number) => {
      const counters = t.l.hitboxCheck_repeatCounters as Value[];
      const i = Number(n) - 1;
      if (Number.isInteger(i) && i >= 0 && i < counters.length) counters[i] = 0;
    },
    charge: () => {
      rt.hitboxProcs.charge?.(t, '');
      return String(t.v.misc1) === 'charging';
    },
    slot: (n: 1 | 2 | 3 | 4) => toNumber(t.v[miscVar(n)]),
    slotText: (n: 1 | 2 | 3 | 4) => String(t.v[miscVar(n)]),
    setSlot: (n: 1 | 2 | 3 | 4, v: number | string) => {
      t.v[miscVar(n)] = typeof v === 'string' ? v : Number(v);
    },
    get survivesHits() {
      return String(t.v.clone_dontDeleteOnHit) === '1';
    },
    set survivesHits(v: boolean) {
      t.v.clone_dontDeleteOnHit = v ? '1' : '0';
    },
    get endsOnLanding() {
      return String(t.v.clone_DeleteOnGround) === '1';
    },
    set endsOnLanding(v: boolean) {
      t.v.clone_DeleteOnGround = v ? '1' : '0';
    },
    get outlivesFighter() {
      return String(t.v.clone_deleteOnCharDeath) === '0';
    },
    set outlivesFighter(v: boolean) {
      t.v.clone_deleteOnCharDeath = v ? '0' : '1';
    },
    platform: () => {
      rt.hitboxProcs.collision?.(t, toNumber(attrs()[0]) / 2, toNumber(attrs()[1]) / 2, 'x', '0');
      return toNumber(t.v.clone_collisionPlatformType);
    },
    copy: (name: string) => {
      const n = String(name);
      const fighter = toNumber(t.v.cloneID);
      if (toNumber((rt.stage.l.CHARACTERS as Value[])[fighter - 1]) !== owner.id || !rt.characters.get(String(owner.id))?.owns.has(n)) throw new Error(`copy: "${n}" is not a hitbox of this character`);
      const before = t.v.AttackID_ForCreateClone;
      t.v.AttackID_ForCreateClone = packHitboxId(n, owner.id);
      try {
        rt.createClone(t, '_myself_');
      } finally {
        t.v.AttackID_ForCreateClone = before;
      }
    },
    particle: (name: string, x = 0, y = 0, layer = 3, direction = 90) => addParticle(rt, owner, toNumber(t.v.cloneID), name, toNumber(t.v.xpos) + Number(x), toNumber(t.v.ypos) + Number(y), layer, direction),
    get armor() {
      return String(t.v.Armor) === '1';
    },
    set armor(v: boolean) {
      t.v.Armor = v ? '1' : '0';
    },
    get hidden() {
      return String(t.v.clone_hide) === '1';
    },
    set hidden(v: boolean) {
      t.v.clone_hide = v ? '1' : '0';
    },
    get noHitPause() {
      return String(t.v.clone_NoHitFreeze) === '1';
    },
    set noHitPause(v: boolean) {
      t.v.clone_NoHitFreeze = v ? '1' : '0';
    },
    get behind() {
      return String(t.v.clone_drawLayer) === '2';
    },
    set behind(v: boolean) {
      t.v.clone_drawLayer = v ? '2' : '0';
    },
    showFrame: (n: number) => rt.hitboxProcs.showFrame?.(t, Number(n)),
    changeStats: (who: unknown, changes: Partial<Record<StatField, StatChange>>) => {
      const args: Value[] = [];
      for (const [key] of STAT_FIELDS) {
        const c = changes?.[key];
        if (c === undefined) {
          args.push('', '');
          continue;
        }
        const [op, value] = [String(c[0]), Number(c[1])];
        if (!['+', '-', '*', '/'].includes(op) || !Number.isFinite(value)) throw new Error(`changeStats: ${key} needs an operator (+, -, * or /) and a number, such as ["*", 2]`);
        args.push(op, value);
      }
      rt.hitboxProcs.statModifier?.(t, '', fightersArg(who), ...args);
    },
    addModifier: (who: unknown, modifier: ExtraModifier) => {
      const m = String(modifier);
      if (!EXTRA_MODIFIERS.includes(m)) throw new Error(`addModifier: "${m}" is not one of ${EXTRA_MODIFIERS.join(', ')}`);
      rt.hitboxProcs.extraModifier?.(t, '', fightersArg(who), m);
    },
    get offsetX() {
      return toNumber(t.v.xdp);
    },
    set offsetX(v: number) {
      t.v.xdp = Number(v);
    },
    get offsetY() {
      return toNumber(t.v.ydp);
    },
    set offsetY(v: number) {
      t.v.ydp = Number(v);
    },
    get rotation() {
      return toNumber(t.v.direc_visual);
    },
    set rotation(v: number) {
      t.v.direc_visual = Number(v);
    },
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
    attribute: (name: MoveAttribute) => attrs()[field(name)],
    setAttribute: (name: MoveAttribute, v: Value) => {
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
      const freeze = scripts[id]?.freeze ?? Object.freeze;
      o = { id, particles: new Set(particles[id] ?? []), freeze, guard: sandboxed ? guarded : (x) => x, math: makeMath(freeze) };
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
    const requests: Requests = { remove: false, moved: false, deleted: false };
    try {
      if (event === 'frame' && g.frame) {
        const [right, left, up, down, shield, attack, combo, jump, taunt] = args.map(b);
        g.frame(f, owner.freeze({ right, left, up, down, shield, attack, combo, jump, taunt }));
      } else if (event === 'move' && g.move) g.move(f, makeHitbox(rt, t, owner, requests));
      else if (event === 'hit' && g.hit) g.hit(f, makeFighter(rt, toNumber(args[0]), owner), makeHitbox(rt, t, owner, requests));
      else if (event === 'tick' && g.tick) g.tick(f, makeHitbox(rt, t, owner, requests));
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      scriptMessage({ level: 'error', character: id, text, event });
      const key = `${id}:${event}:${text}`;
      if (!reported.has(key)) {
        reported.add(key);
        console.error(`Gimmick script of character ${id} failed in ${event}:`, e);
      }
    }
    // These end the hitbox's thread, so they happen here, outside the script and its error handling.
    if (requests.deleted) throw KILLED;
    if (requests.remove && event !== 'frame') rt.hitboxProcs.remove?.(t);
    else if (event === 'tick' && !requests.moved && (isOwnHitbox(rt, t) || (rt.characters.get(String(id))?.template === '0' && String(t.v.cloneType) === '1'))) {
      // No template script moves these: a character's own hitboxes, and any projectile of a character with no template.
      rt.hitboxProcs.move?.(t, t.v.clone_xVel, t.v.clone_yVel, '0', '1', '0');
    }
  };
}
