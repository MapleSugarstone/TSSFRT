// The game runtime: targets, clones, the thread scheduler, broadcasts, pen and sound models.
// Every rule here mirrors the original block runtime closely enough that the same inputs
// produce the same state frame by frame.
import { type Value, compare, toNumber, toStr, isInt, clamp, setListRandom } from './cast.ts';
import { Ctl, type HatKind, type ScriptDef, type SkinDef, type SpriteDef, type UnitFn } from './defs.ts';
import { IoState, type PlayerInput } from './io.ts';
import { RenderModel } from './render-model.ts';
import { Rng } from './rng.ts';
import { newPlayer, pitchRatio, type PlayerState, type SoundEvent } from './sound-model.ts';
import { Sprite, Target, type PenState, type Effects, type EffectName } from './target.ts';
import { Thread, newFrame, type Frame, STATUS_RUNNING, STATUS_PROMISE_WAIT, STATUS_DONE, PC_FALL_OFF } from './thread.ts';

/**
 * Time between frames, both on the simulation clock and in real time. The original steps from an
 * interval of 1000 / 30 ms, which browsers truncate to 33, and its timer reads real time, so its
 * frames are 33 ms apart in both senses.
 */
export const FRAME_MS = 33;
const MAX_CLONES = 300;
const DECAY_MS = 25;

/** Thrown to abandon the current thread after it deleted its own clone. */
export const KILLED = { killed: true };

/** A color to paint a sprite in: red, green and blue from 0 to 1, then the strength from 0 to 1. */
export type Tint = readonly [number, number, number, number];

export type PenCmd =
  | { op: 'stamp'; skin: number; x: number; y: number; sx: number; sy: number; dir: number; fx: Effects; tint?: Tint }
  | { op: 'line'; c4: [number, number, number, number]; d: number; x0: number; y0: number; x1: number; y1: number; point: boolean };

export interface PenLayer {
  /** Commands drawn since the last clear. Never mutated except by appending; a clear starts a new array. */
  cmds: PenCmd[];
  /** Bumped on every clear. */
  gen: number;
}

export interface Question {
  text: string;
  thread: Thread;
  target: Target;
}

/** Per-sprite module produced by the code generator. */
export interface SpriteModule {
  def: SpriteDef;
  build: (rt: Runtime) => { scripts: ScriptDef[] };
}

export interface RuntimeOptions {
  seed: number;
  /** Simulation start time in ms since the epoch; also the base of the "current date" sensing block. */
  t0: number;
  tickCap?: number;
}

export class Runtime {
  // ---------------------------------------------------------------- static data
  sprites: Sprite[] = [];
  units: UnitFn[] = [];
  unitNames: string[] = [];
  render: RenderModel;

  // ---------------------------------------------------------------- state
  stage!: Target;
  targets: Target[] = [];
  executable: Target[] = [];
  /** Sprite layer group of the draw list, back to front. */
  drawList: Target[] = [];
  penCreated = false;
  threads: Thread[] = [];
  activeThread: Thread | null = null;
  frame = 0;
  t0: number;
  currentMSecs: number;
  timerStart: number;
  redrawRequested = false;
  tickCap: number;
  ticks = 0;
  capHits = 0;
  cloneCount = 0;
  nextTargetId = 1;
  nextThreadId = 1;
  rng: Rng;
  io = new IoState();
  answer = '';
  questions: Question[] = [];
  pen: PenLayer = { cmds: [], gen: 0 };
  /** Bumped when a snapshot is loaded, so the renderer redraws the whole pen layer. */
  penEpoch = 0;
  players: PlayerState[][] = [];
  /** Threads whose promise-style wait resolves at the start of the next frame. */
  pending: Thread[] = [];
  monitorVisible: Record<string, boolean> = {};

  /** Per-frame logs for parity reports and the audio output layer. */
  frameLog: { pen: unknown[]; sound: unknown[] } = { pen: [], sound: [] };
  soundEvents: SoundEvent[] = [];
  logPen = false;

  constructor(modules: SpriteModule[], skins: SkinDef[], opts: RuntimeOptions) {
    this.render = new RenderModel(skins);
    this.rng = new Rng(opts.seed);
    this.t0 = opts.t0;
    this.currentMSecs = opts.t0;
    this.timerStart = opts.t0;
    this.tickCap = opts.tickCap ?? 8;
    setListRandom(() => this.rng.next());

    modules.forEach((m, i) => {
      const sprite = new Sprite(m.def, i);
      this.sprites.push(sprite);
    });
    this.players = this.sprites.map((s) => s.sounds.map(() => newPlayer()));

    // Targets in pane order; execution and draw order follow the saved layer order.
    for (const sprite of this.sprites) {
      const t = this.makeOriginal(sprite);
      this.targets.push(t);
      if (sprite.def.isStage) this.stage = t;
    }
    const byLayer = [...this.targets].sort((a, b) => a.sprite.def.layerOrder - b.sprite.def.layerOrder);
    this.executable = byLayer;
    this.drawList = byLayer.filter((t) => !t.isStage);

    modules.forEach((m, i) => {
      const { scripts } = m.build(this);
      this.sprites[i].setScripts(scripts);
    });
  }

  /** Registers a resumable unit; generated modules call this while building. */
  unit(name: string, fn: UnitFn): number {
    this.units.push(fn);
    this.unitNames.push(name);
    return this.units.length - 1;
  }

  private makeOriginal(sprite: Sprite): Target {
    const d = sprite.def;
    const t = new Target(this, sprite, this.nextTargetId++, true);
    t.x = d.x;
    t.y = d.y;
    t.direction = d.direction;
    t.size = d.size;
    t.currentCostume = d.currentCostume;
    t.visible = d.visible;
    t.rotationStyle = d.rotationStyle;
    t.draggable = d.draggable;
    t.volume = d.volume;
    t.updateDrawPosition(t.x, t.y);
    t.v = { ...d.vars };
    t.l = {};
    for (const k of Object.keys(d.lists)) t.l[k] = d.lists[k].slice();
    sprite.clones.push(t);
    sprite.original = t;
    return t;
  }

  random(): number {
    return this.rng.next();
  }

  // ---------------------------------------------------------------- frame loop

  /** Runs one frame with the given per-player inputs. */
  stepFrame(inputs: PlayerInput[]): void {
    this.frame++;
    this.currentMSecs = this.t0 + this.frame * FRAME_MS;
    this.frameLog = { pen: [], sound: [] };
    this.checkSoundEnds();
    this.resolvePending();
    this.applyInputs(inputs);
    this.threads = this.threads.filter((th) => !th.isKilled);
    this.redrawRequested = false;
    this.stepThreads();
    // Promise-style waits settle between frames, right after the frame that started them.
    this.resolvePending();
  }

  applyInputs(inputs: PlayerInput[]): void {
    for (let p = 0; p < 4; p++) {
      const inp = inputs[p];
      const set = this.io.keys[p];
      set.clear();
      if (!inp) continue;
      for (const k of inp.keys) set.add(k);
      if (inp.mouse) {
        this.io.mouseX = inp.mouse.x;
        this.io.mouseY = inp.mouse.y;
        this.io.mouseDown = inp.mouse.down;
      }
    }
    for (let p = 0; p < 4; p++) {
      const a = inputs[p]?.answer;
      if (a !== undefined) this.submitAnswer(a);
    }
  }

  greenFlag(): void {
    this.stopAll();
    this.answer = '';
    for (const t of this.targets) this.clearSoundEffects(t);
    this.timerStart = this.currentMSecs;
    for (const t of this.targets) t.clearEffects();
    this.startHats('flag', null);
  }

  stopAll(): void {
    this.stopAllSounds();
    for (const t of this.targets) this.clearSoundEffects(t);
    this.questions = [];
    const keep: Target[] = [];
    for (const t of this.targets) {
      t.clearEffects();
      if (!t.isOriginal) this.disposeTarget(t);
      else keep.push(t);
    }
    this.targets = keep;
    if (this.activeThread) this.stopThread(this.activeThread);
    for (const th of this.threads) this.forgetThread(th);
    this.threads = [];
  }

  requestRedraw(): void {
    this.redrawRequested = true;
  }

  timer(): number {
    return (this.currentMSecs - this.timerStart) / 1000;
  }

  // ---------------------------------------------------------------- scheduler

  stepThreads(): void {
    let numActive = Infinity;
    this.ticks = 0;
    while (this.threads.length > 0 && numActive > 0 && this.ticks < this.tickCap && !this.redrawRequested) {
      this.ticks++;
      numActive = 0;
      let stopped = false;
      const threads = this.threads;
      for (let i = 0; i < threads.length; i++) {
        const th = (this.activeThread = threads[i]);
        if (th.stackEmpty || th.status === STATUS_DONE) {
          stopped = true;
          continue;
        }
        if (th.status === STATUS_RUNNING) {
          this.stepThread(th);
          if (th.isKilled) i--;
        }
        if (th.status === STATUS_RUNNING) numActive++;
        if (th.stackEmpty || th.status === STATUS_DONE) stopped = true;
      }
      if (stopped) {
        let next = 0;
        for (let i = 0; i < this.threads.length; i++) {
          const th = this.threads[i];
          if (!th.stackEmpty && th.status !== STATUS_DONE) this.threads[next++] = th;
          else this.forgetThread(th);
        }
        this.threads.length = next;
      }
    }
    if (this.ticks >= this.tickCap && this.threads.length > 0 && numActive > 0 && !this.redrawRequested) this.capHits++;
    this.activeThread = null;
  }

  private stepThread(th: Thread): void {
    if (th.nullPending) {
      th.nullPending = false;
      th.status = STATUS_DONE;
      return;
    }
    if (th.fresh) {
      th.fresh = false;
      try {
        th.script.plain!(th.target);
      } catch (e) {
        if (e !== KILLED) throw e;
        return;
      }
      th.status = STATUS_DONE;
      return;
    }
    const frames = th.frames;
    for (;;) {
      const f = frames[frames.length - 1];
      if (f === undefined) {
        th.status = STATUS_DONE;
        return;
      }
      let c: Ctl;
      try {
        c = this.units[f.u](th, f);
      } catch (e) {
        if (e !== KILLED) throw e;
        return;
      }
      switch (c) {
        case Ctl.Yield:
          return;
        case Ctl.Promise:
          th.status = STATUS_PROMISE_WAIT;
          return;
        case Ctl.Call:
          continue;
        case Ctl.Return:
          frames.pop();
          continue;
        case Ctl.StopReturn: {
          frames.pop();
          const top = frames[frames.length - 1];
          if (top) top.pc = top.pcs;
          continue;
        }
        case Ctl.End:
          frames.length = 0;
          th.status = STATUS_DONE;
          return;
      }
    }
  }

  /** Pushes a callee frame from resumable code. `pc`, `pcp` and `pcs` are the caller's resume labels. */
  call(th: Thread, f: Frame, unit: number, args: Value[], warp: boolean, pc: number, pcp: number, pcs: number): Ctl {
    f.pc = pc;
    f.pcp = pcp;
    f.pcs = pcs;
    th.frames.push(newFrame(unit, warp, f.warp, args));
    return Ctl.Call;
  }

  /** Suspends the thread until the next frame starts (promise-style blocks). */
  suspend(th: Thread): Ctl {
    this.pending.push(th);
    return Ctl.Promise;
  }

  private resolvePending(): void {
    const list = this.pending;
    this.pending = [];
    for (const th of list) this.resolveThread(th);
  }

  /** Applies a promise continuation: the thread resumes at the label its top frame set when it suspended. */
  private resolveThread(th: Thread): void {
    if (th.isKilled || th.orphan) return;
    th.status = STATUS_RUNNING;
    const frames = th.frames;
    for (;;) {
      const f = frames[frames.length - 1];
      if (!f) {
        th.nullPending = true;
        return;
      }
      if (f.pc !== PC_FALL_OFF) return;
      frames.pop();
      const caller = frames[frames.length - 1];
      if (!caller) {
        th.nullPending = true;
        return;
      }
      caller.pc = caller.pcp;
    }
  }

  // ---------------------------------------------------------------- hats and broadcasts

  startHats(kind: HatKind, msg: string | null, optTarget?: Target): void {
    const targets = optTarget ? [optTarget] : this.executable;
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i];
      const sprite = t.sprite;
      const scripts = kind === 'broadcast' ? sprite.broadcastScripts.get(msg!) : kind === 'flag' ? sprite.flagScripts : sprite.cloneScripts;
      if (!scripts) continue;
      for (const s of scripts) {
        const si = sprite.scriptIndex.get(s)!;
        const existing = t.scriptThreads[si];
        if (kind === 'clone') {
          if (existing && existing.status !== STATUS_DONE) continue;
          this.pushThread(t, s, si);
        } else if (existing) {
          this.restartThread(existing, si);
        } else {
          this.pushThread(t, s, si);
        }
      }
    }
  }

  broadcast(msg: string): void {
    this.startHats('broadcast', msg.toUpperCase());
  }

  private initThread(th: Thread): void {
    const s = th.script;
    if (s.plain) th.fresh = true;
    else th.frames.push(newFrame(s.unit!, false, false, []));
  }

  private pushThread(t: Target, s: ScriptDef, si: number): Thread {
    const th = new Thread(this.nextThreadId++, t, s);
    this.initThread(th);
    this.threads.push(th);
    t.scriptThreads[si] = th;
    return th;
  }

  private restartThread(old: Thread, si: number): Thread {
    const th = new Thread(this.nextThreadId++, old.target, old.script);
    this.initThread(th);
    const i = this.threads.indexOf(old);
    old.orphan = true;
    this.threads[i] = th;
    old.target.scriptThreads[si] = th;
    return th;
  }

  private forgetThread(th: Thread): void {
    const si = th.target.sprite.scriptIndex.get(th.script)!;
    if (th.target.scriptThreads[si] === th) th.target.scriptThreads[si] = undefined;
  }

  private stopThread(th: Thread): void {
    th.isKilled = true;
    th.fresh = false;
    th.nullPending = false;
    th.frames.length = 0;
    th.status = STATUS_DONE;
  }

  stopForTarget(t: Target, except: Thread | null): void {
    // Listeners run first: waiting sounds stop, questions from this target are dropped.
    for (const idx of t.waitingSounds) {
      const p = this.players[t.sprite.index][idx];
      if (p.owner === t) this.stopPlayer(t.sprite.index, idx);
    }
    t.waitingSounds.clear();
    this.questions = this.questions.filter((q) => q.target !== t);
    for (let i = 0; i < this.threads.length; i++) {
      const th = this.threads[i];
      if (th === except) continue;
      if (th.target === t) this.stopThread(th);
    }
  }

  stopOtherScripts(t: Target, th: Thread | null): void {
    this.stopForTarget(t, th);
  }

  // ---------------------------------------------------------------- targets, clones and layers

  getSpriteTargetByName(name: string): Target | undefined {
    for (const t of this.targets) {
      if (!t.isStage && t.sprite.name === name) return t;
    }
    return undefined;
  }

  private spriteGroupOffset(): number {
    return 1 + (this.penCreated ? 1 : 0);
  }

  drawIndex(t: Target): number {
    if (t.isStage) return 0;
    return this.spriteGroupOffset() + this.drawList.indexOf(t);
  }

  setDrawableOrder(t: Target, order: number, isRelative: boolean, optMin?: number): number | null {
    const start = this.spriteGroupOffset();
    const end = start + this.drawList.length;
    const oldLocal = this.drawList.indexOf(t);
    if (oldLocal < 0) return null;
    const oldIndex = start + oldLocal;
    if (order === 0) return oldIndex;
    this.drawList.splice(oldLocal, 1);
    let newIndex = order;
    if (isRelative) newIndex += oldIndex;
    const possibleMin = (optMin || 0) + start;
    const min = possibleMin >= start && possibleMin < end ? possibleMin : start;
    newIndex = Math.max(newIndex, min);
    newIndex = Math.min(newIndex, end);
    this.drawList.splice(newIndex - start, 0, t);
    return newIndex;
  }

  private moveExecutable(t: Target, delta: number): number {
    const ex = this.executable;
    const oldIndex = ex.indexOf(t);
    ex.splice(oldIndex, 1);
    let newIndex = oldIndex + delta;
    if (newIndex > ex.length) newIndex = ex.length;
    if (newIndex <= 0) newIndex = ex.length > 0 && ex[0].isStage ? 1 : 0;
    ex.splice(newIndex, 0, t);
    return newIndex;
  }

  setExecutablePosition(t: Target, newIndex: number): void {
    const oldIndex = this.executable.indexOf(t);
    this.moveExecutable(t, newIndex - oldIndex);
  }

  createClone(t: Target, option: Value): void {
    const name = toStr(option);
    const source = name === '_myself_' ? t : this.getSpriteTargetByName(name);
    if (!source) return;
    if (this.cloneCount >= MAX_CLONES || source.isStage) return;
    this.cloneCount++;
    const sprite = source.sprite;
    const c = new Target(this, sprite, this.nextTargetId++, false);
    sprite.clones.push(c);
    if (source.pen) c.pen = { ...source.pen, c4: [...source.pen.c4] as PenState['c4'] };
    if (source.snd) c.snd = { ...source.snd };
    c.x = source.x;
    c.y = source.y;
    c.direction = source.direction;
    c.draggable = source.draggable;
    c.visible = source.visible;
    c.size = source.size;
    c.currentCostume = source.currentCostume;
    c.rotationStyle = source.rotationStyle;
    c.effects = { ...source.effects };
    c.updateDrawPosition(c.x, c.y);
    c.v = { ...source.v };
    c.l = {};
    for (const k of Object.keys(source.l)) c.l[k] = source.l[k].slice();
    this.drawList.push(c);
    this.startHats('clone', null, c);
    if (c.visible) this.requestRedraw();
    this.targets.push(c);
    this.executable.push(c);
    const otherLayer = this.setDrawableOrder(source, 0, true)!;
    this.setDrawableOrder(c, otherLayer, false);
    this.setExecutablePosition(c, this.executable.indexOf(source));
  }

  /** Deletes a clone; returns true when the running thread must stop. */
  deleteClone(t: Target): boolean {
    if (t.isOriginal) return false;
    this.targets = this.targets.filter((x) => x !== t);
    this.disposeTarget(t);
    this.stopForTarget(t, null);
    return true;
  }

  private disposeTarget(t: Target): void {
    this.cloneCount--;
    this.stopForTarget(t, null);
    const ei = this.executable.indexOf(t);
    if (ei > -1) this.executable.splice(ei, 1);
    const ci = t.sprite.clones.indexOf(t);
    if (ci >= 0) t.sprite.clones.splice(ci, 1);
    const di = this.drawList.indexOf(t);
    if (di >= 0) this.drawList.splice(di, 1);
    if (t.visible) this.requestRedraw();
  }

  /** `delete this clone` from generated code: stops the running thread if the clone was deleted. */
  deleteThisClone(t: Target): void {
    if (this.deleteClone(t)) throw KILLED;
  }

  switchBackdrop(v: Value): void {
    const stage = this.stage;
    if (typeof v === 'number') {
      stage.setCostume(v - 1);
      return;
    }
    const s = v.toString();
    const idx = stage.sprite.costumeByName.get(s);
    if (idx !== undefined) stage.setCostume(idx);
    else if (v === 'next backdrop') stage.setCostume(stage.currentCostume + 1);
    else if (v === 'previous backdrop') stage.setCostume(stage.currentCostume - 1);
    else if (v === 'random backdrop') {
      const n = stage.sprite.costumes.length;
      if (n > 1) {
        let r = Math.floor(this.random() * (n - 1));
        if (r >= stage.currentCostume) r++;
        stage.setCostume(r);
      }
    } else if (!(Number.isNaN(Number(v)) || (typeof v === 'string' && v.trim().length === 0))) stage.setCostume(Number(v) - 1);
  }

  // ---------------------------------------------------------------- sensing

  touching(t: Target, what: Value): boolean {
    if (what === '_mouse_') return this.render.touchingPoint(t, this.io.mouseX, this.io.mouseY);
    if (what === '_edge_') {
      const b = this.render.aabb(t);
      return b.left < -240 || b.right > 240 || b.top > 180 || b.bottom < -180;
    }
    const first = this.getSpriteTargetByName(toStr(what));
    if (!first) return false;
    return this.render.touchingTargets(t, first.sprite.clones);
  }

  keyPressed(k: Value): boolean {
    return this.io.keyPressed(k);
  }

  current(menu: string): number {
    const d = new Date(this.currentMSecs);
    switch (menu.toLowerCase()) {
      case 'year': return d.getUTCFullYear();
      case 'month': return d.getUTCMonth() + 1;
      case 'date': return d.getUTCDate();
      case 'dayofweek': return d.getUTCDay() + 1;
      case 'hour': return d.getUTCHours();
      case 'minute': return d.getUTCMinutes();
      case 'second': return d.getUTCSeconds();
    }
    return 0;
  }

  /** `ask and wait`; returns Ctl.Promise after queuing the question. */
  ask(th: Thread, t: Target, question: Value): Ctl {
    this.questions.push({ text: String(question), thread: th, target: t });
    return Ctl.Promise;
  }

  private submitAnswer(text: string): void {
    this.answer = text;
    const q = this.questions.shift();
    if (q) this.pending.push(q.thread);
  }

  // ---------------------------------------------------------------- characters added by packs

  /**
   * Characters added by packs, by character number: the original character each was made from, and
   * the moves it has its own data for. Empty for the original roster.
   */
  characters = new Map<string, { template: string; owns: Set<string>; named?: Set<string>; rules?: string; moveRules?: Map<string, string> }>();

  /** Runs pack characters' gimmick scripts (set by src/game/gimmicks.ts); null when no pack has one. */
  gimmickHandler: ((event: string, t: Target, args: Value[]) => void) | null = null;

  /** The hitbox sprite's procedures that gimmick scripts reach through their API: create, move and remove a hitbox. */
  hitboxProcs: Partial<
    Record<
      'create' | 'move' | 'remove' | 'steps' | 'pointAt' | 'toGround' | 'closestEnemy' | 'release' | 'phase' | 'charge' | 'showFrame' | 'statModifier' | 'extraModifier' | 'collision',
      (t: Target, ...args: Value[]) => void
    >
  > = {};

  /** The color a sprite and its pen stamps are painted in, from game state, or null. Only drawing reads it. */
  tintOf: ((t: Target) => Tint | null) | null = null;

  /** Called by the fighter engine at fixed moments (see the transpiler's gimmick hooks). */
  gimmick(event: string, t: Target, args: Value[]): void {
    if (this.gimmickHandler) this.gimmickHandler(event, t, args);
  }

  /** The game's "<move>-<character>" name. A pack character uses its template's name for moves it does not own. */
  moveName(move: Value, character: Value): string {
    const c = this.characters.get(String(character));
    // A pack's own entry that is not one of the standard moves, such as an action its script switches to, is "Dslsh@8".
    if (c?.named?.has(String(move))) return `${String(move)}@${String(character)}`;
    const id = c && !c.owns.has(String(move)) ? c.template : String(character);
    return `${String(move)}-${id}`;
  }

  /**
   * The game's test for one character's move, such as "NPunch-1". The same move of a pack character
   * made from that character also matches, so the template's move script runs on the pack's own data.
   * With `rules`, the game's tests outside the move scripts also match a pack's move that follows that
   * move's built-in rules.
   */
  isMove(value: Value, move: Value, rules = false): boolean {
    if (compare(value, move) === 0) return true;
    if (this.characters.size === 0 || typeof value !== 'string') return false;
    // A pack's own copy of a template's extra hitbox, such as "Fireball@8", passes the template's test for "Fireball".
    const at = value.lastIndexOf('@');
    if (at > 0 && this.characters.has(value.slice(at + 1))) {
      if (compare(value.slice(0, at), move) === 0) return true;
      return rules && this.followsRules(value.slice(at + 1), value.slice(0, at), move);
    }
    const m = /^(.+)-(\d+)$/.exec(value);
    const c = m ? this.characters.get(m[2]) : undefined;
    if (c === undefined) return false;
    if (compare(`${m![1]}-${c.template}`, move) === 0) return true;
    return rules && this.followsRules(m![2], m![1], move);
  }

  private followsRules(character: string, name: string, move: Value): boolean {
    const of = this.characters.get(character)?.moveRules?.get(name);
    return of !== undefined && compare(of, move) === 0;
  }

  /**
   * Called as a hitbox loads its move data. When the hitbox's fighter is a pack character with its own
   * copy of a template's extra hitbox (such as "Fireball"), the hitbox becomes that copy ("Fireball@8").
   */
  ownHitbox(t: Target): void {
    if (this.characters.size === 0) return;
    const character = String((this.stage.l.CHARACTERS as Value[])[toNumber(t.v.cloneID) - 1] ?? '');
    const id = String(t.v.AttackID);
    if (this.characters.get(character)?.owns.has(id)) t.v.AttackID = `${id}@${character}`;
  }

  /** The game's test for one particular character. A pack character also counts as its template and as the character whose movement rules it follows. */
  isCharacter(character: Value, n: Value): boolean {
    if (compare(character, n) === 0) return true;
    const c = this.characters.get(String(character));
    return c !== undefined && (compare(c.template, n) === 0 || (c.rules !== undefined && compare(c.rules, n) === 0));
  }

  // ---------------------------------------------------------------- operators

  pickRandom(from: Value, to: Value): number {
    const nFrom = toNumber(from);
    const nTo = toNumber(to);
    const low = nFrom <= nTo ? nFrom : nTo;
    const high = nFrom <= nTo ? nTo : nFrom;
    if (low === high) return low;
    if (isInt(from) && isInt(to)) return low + Math.floor(this.random() * (high + 1 - low));
    return this.random() * (high - low) + low;
  }

  // ---------------------------------------------------------------- monitors

  showList(prop: string): void {
    this.monitorVisible[prop] = true;
  }
  hideList(prop: string): void {
    this.monitorVisible[prop] = false;
  }

  // ---------------------------------------------------------------- pen

  private ensurePenLayer(): void {
    this.penCreated = true;
  }

  penClear(): void {
    this.ensurePenLayer();
    this.pen = { cmds: [], gen: this.pen.gen + 1 };
    if (this.logPen) this.frameLog.pen.push(['clear']);
    this.requestRedraw();
  }

  penStamp(t: Target): void {
    this.ensurePenLayer();
    if (this.render.touchingBounds(t)) {
      const cmd: PenCmd = {
        op: 'stamp',
        skin: t.sprite.costumes[t.currentCostume].skin,
        x: t.drawX,
        y: t.drawY,
        sx: Math.fround(t.renderedScaleX()),
        sy: Math.fround(t.size),
        dir: t.renderedDirection(),
        fx: { ...t.effects },
      };
      const tint = this.tintOf?.(t);
      if (tint) cmd.tint = tint;
      this.pen.cmds.push(cmd);
      if (this.logPen) this.frameLog.pen.push(stampLog(this, t, cmd));
    }
    this.requestRedraw();
  }

  penLine(p: PenState, x0: number, y0: number, x1: number, y1: number): void {
    this.ensurePenLayer();
    this.pen.cmds.push({ op: 'line', c4: [...p.c4], d: p.diameter, x0, y0, x1, y1, point: false });
    if (this.logPen) this.frameLog.pen.push(['line', [...p.c4], p.diameter, x0, y0, x1, y1]);
    this.requestRedraw();
  }

  penPoint(p: PenState, x: number, y: number): void {
    this.ensurePenLayer();
    this.pen.cmds.push({ op: 'line', c4: [...p.c4], d: p.diameter, x0: x, y0: y, x1: x, y1: y, point: true });
    if (this.logPen) this.frameLog.pen.push(['point', [...p.c4], p.diameter, x, y]);
    this.requestRedraw();
  }

  // ---------------------------------------------------------------- sound

  private soundIndex(t: Target, name: Value): number {
    const len = t.sprite.sounds.length;
    if (len === 0) return -1;
    const byName = typeof name === 'string' ? t.sprite.soundByName.get(name) : undefined;
    if (byName !== undefined) return byName;
    const n = parseInt(String(name), 10);
    if (!Number.isNaN(n)) {
      const range = len;
      return n - 1 - Math.floor((n - 1) / range) * range;
    }
    return -1;
  }

  private nowMs(): number {
    return this.currentMSecs;
  }

  private setPlayerRate(p: PlayerState, rate: number): void {
    if (p.isPlaying) {
      const now = this.nowMs();
      p.pos += (now - p.lastT) * p.rate;
      p.lastT = now;
    }
    p.rate = rate;
  }

  private applySoundEffects(spriteIdx: number, soundIdx: number, t: Target): void {
    const p = this.players[spriteIdx][soundIdx];
    if (t.snd) p.pitch = t.snd.pitch;
    this.setPlayerRate(p, pitchRatio(p.pitch));
    if (p.isPlaying) {
      this.soundEvents.push({ kind: 'fx', sprite: spriteIdx, sound: soundIdx, at: this.nowMs(), rate: p.rate, volume: t.volume, pan: t.snd?.pan ?? 0, serial: p.serial });
    }
  }

  private emitStop(p: PlayerState): void {
    const w = p.waiters;
    p.waiters = [];
    for (const th of w) this.pending.push(th);
  }

  private stopPlayer(spriteIdx: number, soundIdx: number): void {
    const p = this.players[spriteIdx][soundIdx];
    if (!p.isPlaying) return;
    this.emitStop(p);
    p.isPlaying = false;
    p.startingUntil = 0;
    this.soundEvents.push({ kind: 'stop', sprite: spriteIdx, sound: soundIdx, at: this.nowMs(), rate: p.rate, volume: 0, serial: p.serial });
    this.frameLog.sound.push(['stop', this.sprites[spriteIdx].sounds[soundIdx].name]);
  }

  private bankPlay(t: Target, soundIdx: number): PlayerState {
    const si = t.sprite.index;
    const p = this.players[si][soundIdx];
    if (p.owner !== t) this.stopPlayer(si, soundIdx);
    p.owner = t;
    this.applySoundEffects(si, soundIdx, t);
    this.frameLog.sound.push(['play', t.sprite.sounds[soundIdx].name, this.executable.indexOf(t)]);
    const now = this.nowMs();
    if (p.isPlaying && p.startingUntil > now) {
      this.emitStop(p);
      return p;
    }
    if (p.isPlaying) this.stopPlayer(si, soundIdx);
    p.isPlaying = true;
    p.pos = 0;
    p.lastT = now;
    p.startingUntil = now + DECAY_MS;
    p.serial++;
    this.soundEvents.push({ kind: 'play', sprite: si, sound: soundIdx, at: now, rate: p.rate, volume: t.volume, pan: t.snd?.pan ?? 0, serial: p.serial });
    return p;
  }

  startSound(t: Target, name: Value): void {
    const idx = this.soundIndex(t, name);
    if (idx < 0) return;
    t.waitingSounds.delete(idx);
    this.bankPlay(t, idx);
  }

  /** `play sound until done`: returns true when the thread must suspend. */
  playUntilDone(th: Thread, t: Target, name: Value): boolean {
    const idx = this.soundIndex(t, name);
    if (idx < 0) return false;
    t.waitingSounds.add(idx);
    const p = this.bankPlay(t, idx);
    p.waiters.push(th);
    return true;
  }

  private checkSoundEnds(): void {
    const now = this.nowMs();
    for (let s = 0; s < this.players.length; s++) {
      const list = this.players[s];
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p.isPlaying) continue;
        const def = this.sprites[s].sounds[i];
        const durationMs = (def.sampleCount / def.rate) * 1000;
        if (p.pos + (now - p.lastT) * p.rate >= durationMs) {
          p.isPlaying = false;
          this.emitStop(p);
          this.frameLog.sound.push(['end', def.name]);
        }
      }
    }
  }

  stopAllSounds(): void {
    for (const t of this.targets) {
      const si = t.sprite.index;
      this.players[si].forEach((p, idx) => {
        if (p.owner === t) this.stopPlayer(si, idx);
      });
      t.waitingSounds.clear();
    }
  }

  private syncSoundEffects(t: Target): void {
    t.soundState();
    const si = t.sprite.index;
    this.players[si].forEach((p, idx) => {
      if (p.owner === t) this.applySoundEffects(si, idx, t);
    });
  }

  setVolume(t: Target, v: Value): void {
    t.volume = clamp(toNumber(v), 0, 100);
    this.syncSoundEffects(t);
  }

  changeVolume(t: Target, v: Value): void {
    this.setVolume(t, toNumber(v) + t.volume);
  }

  /** Sets or changes a sound effect; returns false when the effect name is unknown (no suspension then). */
  soundEffect(t: Target, effect: Value, v: Value, change: boolean): boolean {
    const name = toStr(effect).toLowerCase();
    const value = toNumber(v);
    const st = t.soundState();
    if (name !== 'pitch' && name !== 'pan') return false;
    st[name] = change ? st[name] + value : value;
    st[name] = name === 'pitch' ? clamp(st[name], -360, 360) : clamp(st[name], -100, 100);
    this.syncSoundEffects(t);
    return true;
  }

  private clearSoundEffects(t: Target): void {
    const st = t.soundState();
    st.pitch = 0;
    st.pan = 0;
    this.syncSoundEffects(t);
  }
}

function stampLog(rt: Runtime, t: Target, cmd: Extract<PenCmd, { op: 'stamp' }>): unknown[] {
  const fx = cmd.fx;
  let bits = 0;
  const names: EffectName[] = ['color', 'fisheye', 'whirl', 'pixelate', 'mosaic', 'brightness', 'ghost'];
  names.forEach((n, i) => {
    if (fx[n]) bits |= 1 << i;
  });
  return [
    'stamp',
    `${t.sprite.def.isStage ? '_stage_' : t.sprite.name}#${t.currentCostume}`,
    cmd.x,
    cmd.y,
    cmd.sx,
    cmd.sy,
    cmd.dir,
    bits,
    (fx.color / 200) % 1,
    (-fx.whirl * Math.PI) / 180,
    Math.abs(fx.pixelate) / 10,
    Math.max(-100, Math.min(fx.brightness, 100)) / 100,
    1 - Math.max(0, Math.min(fx.ghost, 100)) / 100,
  ];
  void rt;
}
