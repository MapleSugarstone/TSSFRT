/* global VirtualMachine, ScratchRender, ScratchStorage, ScratchSVGRenderer */
// Runs the original project in its own VM with simulated time, a seeded random source and
// simulated sound timing, so every run with the same inputs produces the same frames.
(function () {
  'use strict';

  // The VM steps from an interval of 1000 / 30 ms, which browsers truncate to 33, so real frames are 33 ms apart.
  const FRAME_MS = 1000 / 30;
  const CLOCK_STEP_MS = 33;
  const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
  let simNow = T0;
  Date.now = () => simNow;

  const STATUS_RUNNING = 0;
  const STATUS_YIELD = 2;
  const STATUS_YIELD_TICK = 3;
  const STATUS_DONE = 4;

  const H = window.H = {
    frame: 0,
    ticks: 0,
    tickCap: 8,
    capHits: 0,
    penLog: [],
    soundLog: [],
    rngCalls: 0,
    ready: false,
    error: null,
  };

  // Seeded generator shared by the port (32-bit state, one step per call).
  function makeRng(seed) {
    let a = seed >>> 0;
    return {
      next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      get state() { return a; },
    };
  }
  let rng = makeRng(1);

  // ---------------------------------------------------------------- simulated audio
  const DECAY = 0.025;
  function nowSec() { return simNow / 1000; }

  class FakePlayer {
    constructor(id, sound) {
      this.id = id;
      this.name = sound.name;
      this.duration = sound.sampleCount / sound.rate;
      this.buffer = { sampleRate: sound.rate, length: sound.sampleCount, duration: this.duration };
      this.isPlaying = false;
      this.startingUntil = 0;
      this.waiters = [];
      this.rate = 1;
      this.pos = 0;
      this.lastT = 0;
    }
    get isStarting() { return this.isPlaying && this.startingUntil > nowSec(); }
    emitStop() {
      const w = this.waiters;
      this.waiters = [];
      for (const r of w) r();
    }
    setRate(r) {
      if (this.isPlaying) {
        const t = nowSec();
        this.pos += (t - this.lastT) * this.rate;
        this.lastT = t;
      }
      this.rate = r;
    }
    play() {
      if (this.isStarting) {
        this.emitStop();
        return;
      }
      if (this.isPlaying) this.stop();
      this.isPlaying = true;
      this.pos = 0;
      this.lastT = nowSec();
      this.startingUntil = nowSec() + DECAY;
    }
    stop() {
      if (!this.isPlaying) return;
      this.emitStop();
      this.isPlaying = false;
      this.startingUntil = 0;
      H.soundLog.push(['stop', this.name]);
    }
    checkEnded() {
      if (!this.isPlaying) return;
      const consumed = this.pos + (nowSec() - this.lastT) * this.rate;
      if (consumed >= this.duration) {
        this.isPlaying = false;
        this.emitStop();
        H.soundLog.push(['end', this.name]);
      }
    }
  }

  const allPlayers = [];
  let nextSoundId = 1;

  class FakeBank {
    constructor() {
      this.soundPlayers = {};
      this.playerTargets = new Map();
      this.pitch = new Map();
    }
    addSoundPlayer(p) { this.soundPlayers[p.id] = p; }
    getSoundPlayer(id) { return this.soundPlayers[id]; }
    _applyEffects(soundId, target) {
      if (target.soundEffects && 'pitch' in target.soundEffects) this.pitch.set(soundId, target.soundEffects.pitch);
      const pitch = this.pitch.get(soundId) || 0;
      this.soundPlayers[soundId].setRate(DMATH.pow2((pitch / 10) / 12));
    }
    playSound(target, soundId) {
      const player = this.soundPlayers[soundId];
      if (this.playerTargets.get(soundId) !== target) player.stop();
      this.playerTargets.set(soundId, target);
      this._applyEffects(soundId, target);
      H.soundLog.push(['play', player.name, H.vm.runtime.executableTargets.indexOf(target)]);
      player.play();
      return new Promise((resolve) => player.waiters.push(resolve));
    }
    setEffects(target) {
      this.playerTargets.forEach((t, id) => { if (t === target) this._applyEffects(id, target); });
    }
    stop(target, soundId) {
      if (this.playerTargets.get(soundId) === target) this.soundPlayers[soundId].stop();
    }
    stopAllSounds(target = '*') {
      this.playerTargets.forEach((t, id) => {
        if (target === '*' || t === target) this.soundPlayers[id].stop();
      });
    }
    dispose() {}
  }

  const fakeAudioEngine = {
    get currentTime() { return nowSec(); },
    DECAY_DURATION: DECAY,
    createBank() { return new FakeBank(); },
    decodeSoundPlayer(sound) {
      const p = new FakePlayer(`snd${nextSoundId++}`, sound);
      allPlayers.push(p);
      return Promise.resolve(p);
    },
    getLoudness() { return -1; },
  };

  // ---------------------------------------------------------------- scheduler with a tick cap
  function patchedStepThreads() {
    const runtime = this.runtime;
    runtime.updateCurrentMSecs();
    let numActiveThreads = Infinity;
    let ranFirstTick = false;
    const doneThreads = [];
    H.ticks = 0;
    while (runtime.threads.length > 0 &&
           numActiveThreads > 0 &&
           H.ticks < H.tickCap &&
           (runtime.turboMode || !runtime.redrawRequested)) {
      H.ticks++;
      numActiveThreads = 0;
      let stoppedThread = false;
      const threads = runtime.threads;
      for (let i = 0; i < threads.length; i++) {
        const activeThread = this.activeThread = threads[i];
        if (activeThread.stack.length === 0 || activeThread.status === STATUS_DONE) {
          stoppedThread = true;
          continue;
        }
        if (activeThread.status === STATUS_YIELD_TICK && !ranFirstTick) {
          activeThread.status = STATUS_RUNNING;
        }
        if (activeThread.status === STATUS_RUNNING || activeThread.status === STATUS_YIELD) {
          this.stepThread(activeThread);
          activeThread.warpTimer = null;
          if (activeThread.isKilled) i--;
        }
        if (activeThread.status === STATUS_RUNNING) numActiveThreads++;
        if (activeThread.stack.length === 0 || activeThread.status === STATUS_DONE) stoppedThread = true;
      }
      ranFirstTick = true;
      if (stoppedThread) {
        let next = 0;
        for (let i = 0; i < runtime.threads.length; i++) {
          const thread = runtime.threads[i];
          if (thread.stack.length !== 0 && thread.status !== STATUS_DONE) {
            runtime.threads[next++] = thread;
          } else {
            doneThreads.push(thread);
          }
        }
        runtime.threads.length = next;
      }
    }
    if (H.ticks >= H.tickCap && runtime.threads.length > 0 && numActiveThreads > 0 && !runtime.redrawRequested) H.capHits++;
    this.activeThread = null;
    return doneThreads;
  }

  // ---------------------------------------------------------------- canonical values and digests
  function canon(v) {
    if (typeof v === 'number') return Object.is(v, -0) ? 'n-0' : `n${v}`;
    if (typeof v === 'string') return `s${JSON.stringify(v)}`;
    if (typeof v === 'boolean') return v ? 'bT' : 'bF';
    if (v === undefined) return 'u';
    if (v === null) return 'z';
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    return `o${JSON.stringify(v)}`;
  }
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  const EFFECT_NAMES = ['color', 'fisheye', 'whirl', 'pixelate', 'mosaic', 'brightness', 'ghost'];
  let skinKeys = new Map();

  function targetState(t) {
    const r = H.vm.runtime;
    const vars = {};
    const lists = {};
    for (const [id, v] of Object.entries(t.variables)) {
      if (v.type === 'list') lists[id] = v.value.slice();
      else if (v.type === '') vars[id] = v.value;
    }
    const pen = t.getCustomState('Scratch.pen');
    const snd = t.getCustomState('Scratch.sound');
    return {
      name: t.getName(),
      orig: t.isOriginal,
      x: t.x, y: t.y, dir: t.direction, size: t.size, costume: t.currentCostume,
      vis: t.visible, rot: t.rotationStyle, vol: t.volume,
      fx: EFFECT_NAMES.map((e) => t.effects[e]),
      layer: r.renderer._drawList.indexOf(t.drawableID),
      vars, lists,
      pen: pen ? [pen.penDown, pen.color, pen.saturation, pen.brightness, pen.transparency, pen.penAttributes.diameter] : null,
      snd: snd ? [snd.effects.pitch, snd.effects.pan] : null,
    };
  }

  function fullState() {
    const r = H.vm.runtime;
    return {
      frame: H.frame,
      ticks: H.ticks,
      rng: rng.state,
      rngCalls: H.rngCalls,
      targets: r.executableTargets.map(targetState),
      threads: r.threads.map((th) => [r.executableTargets.indexOf(th.target), th.topBlock, th.status, th.stack.length ? th.stack[th.stack.length - 1] : null]),
      pen: H.penLog,
      sound: H.soundLog,
      answer: r.ext_scratch3_sensing ? r.ext_scratch3_sensing._answer : null,
    };
  }

  function digest(s) {
    return {
      frame: s.frame,
      ticks: s.ticks,
      rng: s.rng,
      targets: s.targets.map((t) => hash(canon([t.name, t.orig, t.x, t.y, t.dir, t.size, t.costume, t.vis, t.rot, t.vol, t.fx, t.layer, t.pen, t.snd])
        + canon(sortedEntries(t.vars)) + canon(sortedEntries(t.lists)))),
      threads: hash(canon(s.threads.map((th) => [th[0], th[1], th[2]]))),
      pen: hash(canon(s.pen)),
      penCount: s.pen.length,
      sound: hash(canon(normalizeSound(s.sound))),
    };
  }

  function sortedEntries(o) {
    return Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  // Sorts each run of 'end' events; their order between players carries no meaning.
  function normalizeSound(log) {
    const out = [];
    let run = [];
    const flush = () => {
      run.sort((a, b) => canon(a).localeCompare(canon(b)));
      out.push(...run);
      run = [];
    };
    for (const e of log) {
      if (e[0] === 'end') run.push(e);
      else { flush(); out.push(e); }
    }
    flush();
    return out;
  }

  // ---------------------------------------------------------------- setup
  async function setup() {
    const canvas = document.getElementById('stage');
    const vm = new VirtualMachine();
    H.vm = vm;
    const storage = new ScratchStorage.ScratchStorage ? new ScratchStorage.ScratchStorage() : new ScratchStorage();
    vm.attachStorage(storage);
    const renderer = new ScratchRender(canvas);
    H.renderer = renderer;
    vm.attachRenderer(renderer);
    vm.attachV2BitmapAdapter(new ScratchSVGRenderer.BitmapAdapter());
    vm.attachAudioEngine(fakeAudioEngine);
    vm.setCompatibilityMode(true);
    vm.runtime.currentStepTime = FRAME_MS;
    vm.runtime.sequencer.stepThreads = patchedStepThreads;

    const res = await fetch('/Port_to_TypeScript.sb3');
    const buf = await res.arrayBuffer();
    await vm.loadProject(buf);

    // Random source and wall-clock sensing become deterministic.
    vm.runtime._primitives.operator_random = function (args) {
      const Cast = { toNumber: (v) => { const n = typeof v === 'number' ? v : Number(v); return Number.isNaN(n) ? 0 : n; } };
      const isInt = (val) => {
        if (typeof val === 'number') return Number.isNaN(val) ? true : val === parseInt(val, 10);
        if (typeof val === 'boolean') return true;
        if (typeof val === 'string') return val.indexOf('.') < 0;
        return false;
      };
      const nFrom = Cast.toNumber(args.FROM);
      const nTo = Cast.toNumber(args.TO);
      const low = nFrom <= nTo ? nFrom : nTo;
      const high = nFrom <= nTo ? nTo : nFrom;
      if (low === high) return low;
      H.rngCalls++;
      if (isInt(args.FROM) && isInt(args.TO)) return low + Math.floor(rng.next() * ((high + 1) - low));
      return (rng.next() * (high - low)) + low;
    };
    vm.runtime._primitives.sensing_current = function (args) {
      const menu = String(args.CURRENTMENU).toLowerCase();
      const d = new Date(simNow);
      switch (menu) {
        case 'year': return d.getUTCFullYear();
        case 'month': return d.getUTCMonth() + 1;
        case 'date': return d.getUTCDate();
        case 'dayofweek': return d.getUTCDay() + 1;
        case 'hour': return d.getUTCHours();
        case 'minute': return d.getUTCMinutes();
        case 'second': return d.getUTCSeconds();
      }
      return 0;
    };

    // Pen operation log.
    const origStamp = renderer.penStamp.bind(renderer);
    renderer.penStamp = function (penSkinID, stampID) {
      const d = renderer._allDrawables[stampID];
      const bounds = d && d.skin ? renderer._touchingBounds(stampID) : null;
      if (bounds) {
        const u = d._uniforms;
        H.penLog.push(['stamp', skinKeys.get(d.skin.id), d._position[0], d._position[1], d._scale[0], d._scale[1], d._direction,
          d.enabledEffects, u.u_color, u.u_whirl, u.u_pixelate, u.u_brightness, u.u_ghost]);
      }
      return origStamp(penSkinID, stampID);
    };
    const origLine = renderer.penLine.bind(renderer);
    renderer.penLine = function (id, attrs, x0, y0, x1, y1) {
      H.penLog.push(['line', attrs.color4f.slice(), attrs.diameter, x0, y0, x1, y1]);
      return origLine(id, attrs, x0, y0, x1, y1);
    };
    const origPoint = renderer.penPoint.bind(renderer);
    renderer.penPoint = function (id, attrs, x, y) {
      H.penLog.push(['point', attrs.color4f.slice(), attrs.diameter, x, y]);
      return origPoint(id, attrs, x, y);
    };
    const origClear = renderer.penClear.bind(renderer);
    renderer.penClear = function (id) {
      H.penLog.push(['clear']);
      return origClear(id);
    };

    // Wait for every vector costume to finish rasterizing.
    for (let i = 0; i < 600; i++) {
      const pending = Object.values(renderer._allSkins).filter((s) => s && s._svgImage && !s._svgImageLoaded);
      if (pending.length === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    skinKeys = new Map();
    for (const t of vm.runtime.targets) {
      t.sprite.costumes.forEach((c, i) => skinKeys.set(c.skinId, `${t.isStage ? '_stage_' : t.sprite.name}#${i}`));
    }
    H.ready = true;
    document.getElementById('status').textContent = 'ready';
  }

  async function flush() {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  }

  // ---------------------------------------------------------------- driver API
  const keyToBrowser = (k) => {
    switch (k) {
      case 'space': return ' ';
      case 'left arrow': return 'ArrowLeft';
      case 'right arrow': return 'ArrowRight';
      case 'up arrow': return 'ArrowUp';
      case 'down arrow': return 'ArrowDown';
      case 'enter': return 'Enter';
      default: return k.toLowerCase();
    }
  };

  function applyInput(ev) {
    const vm = H.vm;
    if (ev.type === 'key') {
      vm.postIOData('keyboard', { key: keyToBrowser(ev.key), isDown: ev.down });
    } else if (ev.type === 'mouse') {
      const cx = ev.x + 240 || 1e-9;
      const cy = 180 - ev.y || 1e-9;
      const data = { x: cx, y: cy, canvasWidth: 480, canvasHeight: 360 };
      if (ev.down !== undefined) data.isDown = ev.down;
      vm.postIOData('mouse', data);
    } else if (ev.type === 'answer') {
      vm.runtime.emit('ANSWER', ev.text);
    }
  }

  H.start = async function (opts) {
    rng = makeRng(opts.seed >>> 0);
    H.rngCalls = 0;
    H.tickCap = opts.tickCap || 8;
    simNow = T0;
    H.vm.runtime.currentMSecs = T0;
    H.frame = 0;
    H.penLog = [];
    H.soundLog = [];
    H.vm.greenFlag();
    await flush();
    return digest(fullState());
  };

  // Runs one frame. `events` apply before the frame's ticks.
  H.step = async function (events, want) {
    H.frame++;
    simNow = T0 + H.frame * CLOCK_STEP_MS;
    H.penLog = [];
    H.soundLog = [];
    for (const p of allPlayers) p.checkEnded();
    await flush();
    for (const ev of events || []) applyInput(ev);
    H.vm.runtime._step();
    let shot = null;
    if (want && want.shot) shot = document.getElementById('stage').toDataURL('image/png');
    await flush();
    const full = fullState();
    const out = { digest: digest(full) };
    if (want && want.full) out.full = full;
    if (shot) out.shot = shot;
    return out;
  };

  H.run = async function (frames, eventsByFrame, opts) {
    const digests = [];
    const fulls = {};
    const shots = {};
    const fullAt = new Set((opts && opts.fullAt) || []);
    const shotAt = new Set((opts && opts.shotAt) || []);
    for (let i = 0; i < frames; i++) {
      const f = H.frame + 1;
      const r = await H.step(eventsByFrame[f], { full: fullAt.has(f), shot: shotAt.has(f) });
      digests.push(r.digest);
      if (r.full) fulls[f] = r.full;
      if (r.shot) shots[f] = r.shot;
    }
    return { digests, fulls, shots, capHits: H.capHits };
  };

  H.resize = function (w, h) {
    H.renderer.resize(w, h);
    const c = document.getElementById('stage');
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  };

  // Costume and sound metadata as the renderer computed it.
  H.meta = function () {
    const renderer = H.renderer;
    const out = [];
    for (const t of H.vm.runtime.targets) {
      if (!t.isOriginal) continue;
      const costumes = t.sprite.costumes.map((c) => {
        const skin = renderer._allSkins[c.skinId];
        const entry = {
          name: c.name,
          format: c.dataFormat,
          md5ext: c.md5,
          bitmapResolution: c.bitmapResolution,
          rotationCenterX: c.rotationCenterX,
          rotationCenterY: c.rotationCenterY,
          size: skin.size,
          skinRotationCenter: [skin.rotationCenter[0], skin.rotationCenter[1]],
        };
        if (skin._svgImage) {
          entry.svgSrc = skin._svgImage.src;
          entry.maxTextureScale = skin._maxTextureScale;
        }
        return entry;
      });
      const sounds = t.sprite.sounds.map((s) => ({ name: s.name, md5ext: s.md5, format: s.dataFormat, rate: s.rate, sampleCount: s.sampleCount }));
      out.push({ name: t.sprite.name, isStage: t.isStage, costumes, sounds });
    }
    return out;
  };

  // 1-bit alpha masks of the given sprites' costumes at the 1x mip, as the touching tests see them.
  H.silhouettes = function (spriteNames) {
    const out = {};
    for (const t of H.vm.runtime.targets) {
      if (!t.isOriginal || t.isStage || !spriteNames.includes(t.sprite.name)) continue;
      out[t.sprite.name] = t.sprite.costumes.map((c) => {
        const skin = H.renderer._allSkins[c.skinId];
        skin.getTexture([100, 100]);
        const s = skin._silhouette;
        const w = s._width;
        const h = s._height;
        const bits = new Uint8Array(Math.ceil((w * h) / 8));
        if (s._colorData) {
          for (let i = 0; i < w * h; i++) if (s._colorData[i * 4 + 3] > 0) bits[i >> 3] |= 1 << (i & 7);
        }
        let bin = '';
        for (let i = 0; i < bits.length; i++) bin += String.fromCharCode(bits[i]);
        return { w, h, bits: btoa(bin) };
      });
    }
    return out;
  };

  setup().catch((e) => {
    H.error = String(e && e.stack || e);
    document.getElementById('status').textContent = H.error;
  });
})();
