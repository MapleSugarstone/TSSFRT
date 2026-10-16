// Drives the port through menus with a list of taps and prints the menu state after each, so
// menu routes can be scripted for parity scenarios.
// Usage: npx tsx tools/menu-drive.ts "D V S S V ..." [save-as-scenario-name]
//   Each token is a key name (use _ for space-separated names like left_arrow), optionally with
//   a player prefix (2:right_arrow), a hold count (V*40) and a wait (V/60). "wait/N" just waits.
import fs from 'node:fs';
import path from 'node:path';
import { createPort } from './lib/port.ts';
import type { ScenarioEvent, Scenario } from './lib/port.ts';
import type { PlayerInput } from '../src/engine/io.ts';
import { Rng } from '../src/engine/rng.ts';

const tokens = (process.argv[2] ?? '').split(/\s+/).filter(Boolean);
const saveAs = process.argv[3];
const seed = Number(process.argv[4] ?? 9);
const fuzzRng = new Rng(seed * 31 + 7);
const P1KEYS = ['D', 'A', 'W', 'S', 'B', 'V', 'C', 'space', 'F'];
const P2KEYS = ['right arrow', 'left arrow', 'up arrow', 'down arrow', '.', ',', 'M', 'N', 'K'];
const rt = createPort(seed);
rt.logPen = false;
rt.greenFlag();
const events: ScenarioEvent[] = [];
let f = 0;
const held: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
const run = (n: number) => {
  for (let i = 0; i < n; i++) {
    f++;
    for (const e of events) {
      if (e.f === f && e.type === 'key') {
        if (e.down) held[e.p ?? 0].add(e.key);
        else held[e.p ?? 0].delete(e.key);
      }
    }
    const inp: PlayerInput[] = held.map((s) => ({ keys: [...s] }));
    rt.stepFrame(inp);
  }
};
const tap = (key: string, p: number, hold: number, wait: number) => {
  events.push({ f: f + 1, type: 'key', key, down: true, p }, { f: f + 1 + hold, type: 'key', key, down: false, p });
  run(hold + wait);
};
const show = (label: string) => {
  const v = rt.stage.v;
  const l = rt.stage.l;
  console.log(
    `${label.padEnd(14)} f=${f} ${v.Main_State} type=${v.Match_Type} btn=${v.MM_CurrentButtonSelect} btn2=${v.MM_CurrentButtonSelect2} menu=${v.MM_CurrentMenuSelect} sel=${JSON.stringify(l.Menu_CharacterSelect_Data)} confirms=${JSON.stringify(l.Menu_CharacterSelect_Confirms)} stage=${l.Stage_MatchData[0]} cpu=${JSON.stringify(l.C_CPULevel)} cur=${JSON.stringify(l.Menu_CharSelect_CursorData)}`,
  );
};

// To the main menu: skip intro to title, tutorial, then pause out of it.
run(320);
tap('space', 0, 4, 200);
tap('P', 0, 4, 200);
run(40);
show('main menu');
for (const tok of tokens) {
  const m = tok.match(/^(?:(\d):)?([^*/]+)(?:\*(\d+))?(?:\/(\d+))?$/);
  if (!m) throw new Error(`bad token ${tok}`);
  const p = m[1] ? Number(m[1]) - 1 : 0;
  const key = m[2].replace(/_/g, ' ');
  const hold = Number(m[3] ?? 3);
  const wait = Number(m[4] ?? 20);
  if (key === 'wait') run(wait);
  else if (key.startsWith('goto:')) {
    // Steers this player's character-select cursor to a stage point with short holds.
    const [tx, ty] = key.slice(5).split(',').map(Number);
    const keysOf = p === 0 ? { R: 'D', L: 'A', U: 'W', D: 'S' } : { R: 'right arrow', L: 'left arrow', U: 'up arrow', D: 'down arrow' };
    for (let tries = 0; tries < 12; tries++) {
      const raw = String(rt.stage.l.Menu_CharSelect_CursorData[p] ?? '0\'0\'').split("'");
      const cx = Number(raw[0]);
      const cy = Number(raw[1]);
      const dx = tx - cx;
      const dy = ty - cy;
      if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) break;
      if (Math.abs(dx) > 5) tap(dx > 0 ? keysOf.R : keysOf.L, p, Math.max(1, Math.round(Math.abs(dx) / 6.75)), 25);
      if (Math.abs(dy) > 5) tap(dy > 0 ? keysOf.U : keysOf.D, p, Math.max(1, Math.round(Math.abs(dy) / 6.75)), 25);
    }
    run(wait);
  } else if (key === 'fuzz' || key === 'fuzz2') {
    // Random presses and releases of player 1's (or both players') game keys for `wait` frames.
    const keys = key === 'fuzz' ? [P1KEYS] : [P1KEYS, P2KEYS];
    const end = f + wait;
    const down: Set<string>[] = keys.map(() => new Set());
    while (f < end) {
      const pi = Math.floor(fuzzRng.next() * keys.length);
      const k = keys[pi][Math.floor(fuzzRng.next() * keys[pi].length)];
      const isDown = down[pi].has(k);
      events.push({ f: f + 1, type: 'key', key: k, down: !isDown, p: pi });
      if (isDown) down[pi].delete(k);
      else down[pi].add(k);
      run(1 + Math.floor(fuzzRng.next() * 10));
    }
    down.forEach((s, pi) => s.forEach((k) => events.push({ f: f + 1, type: 'key', key: k, down: false, p: pi })));
    run(1);
  } else tap(key, p, hold, wait);
  show(tok);
}
if (saveAs) {
  const sc: Scenario = { name: saveAs, seed, frames: f + 30, events };
  fs.writeFileSync(path.resolve(import.meta.dirname, `../tests/scenarios/${saveAs}.json`), JSON.stringify(sc));
  console.log(`saved tests/scenarios/${saveAs}.json (${sc.frames} frames)`);
}
