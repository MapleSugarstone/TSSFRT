// Checks that restoring a snapshot and re-simulating reproduces the straight run exactly,
// including through a JSON round trip of the snapshot (used to send state to a peer).
// Usage: npx tsx tools/rollback-test.ts <scenario-file> [maxRollback]
import fs from 'node:fs';
import path from 'node:path';
import { createPort, digest, fullState, InputTimeline, type Scenario } from './lib/port.ts';
import { saveSnapshot, loadSnapshot, type Snapshot } from '../src/engine/snapshot.ts';
import { Rng } from '../src/engine/rng.ts';

const sc: Scenario = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
const maxBack = Number(process.argv[3] ?? 8);

const straight = createPort(sc.seed);
straight.greenFlag();
const tl = new InputTimeline(sc.events);
const inputs = [];
const expected: string[] = [];
for (let f = 1; f <= sc.frames; f++) {
  inputs[f] = tl.inputsFor(f);
  straight.stepFrame(inputs[f]);
  expected[f] = JSON.stringify(digest(fullState(straight)));
}

const rt = createPort(sc.seed);
rt.greenFlag();
const snaps: Snapshot[] = [];
snaps[0] = saveSnapshot(rt);
const rng = new Rng(99);
let rollbacks = 0;
let jsonTrips = 0;
let snapMs = 0;
let loadMs = 0;
let f = 0;
while (f < sc.frames) {
  f++;
  rt.stepFrame(inputs[f]);
  let t0 = performance.now();
  snaps[f] = saveSnapshot(rt);
  snapMs += performance.now() - t0;
  const got = JSON.stringify(digest(fullState(rt)));
  if (got !== expected[f]) {
    console.log(`MISMATCH at frame ${f} after ${rollbacks} rollbacks`);
    process.exit(1);
  }
  // Roll back a random distance now and then, and simulate forward again.
  if (rng.next() < 0.2 && f > maxBack) {
    const back = 1 + Math.floor(rng.next() * maxBack);
    const target = f - back;
    t0 = performance.now();
    let snap = snaps[target];
    if (rng.next() < 0.05) {
      // The pen array is shared by reference; a JSON copy must carry its own commands.
      snap = JSON.parse(JSON.stringify({ ...snap, penCmds: snap.penCmds.slice(0, snap.penLength) }));
      jsonTrips++;
    }
    loadSnapshot(rt, snap);
    loadMs += performance.now() - t0;
    for (let g = target + 1; g <= f; g++) {
      rt.stepFrame(inputs[g]);
      snaps[g] = saveSnapshot(rt);
      const d = JSON.stringify(digest(fullState(rt)));
      if (d !== expected[g]) {
        console.log(`MISMATCH at frame ${g} replaying from ${target} (rollback ${rollbacks + 1})`);
        process.exit(1);
      }
    }
    rollbacks++;
  }
}
console.log(`OK ${sc.frames} frames, ${rollbacks} rollbacks (${jsonTrips} through JSON), snapshot ${(snapMs / sc.frames).toFixed(3)} ms/frame, load ${(loadMs / Math.max(1, rollbacks)).toFixed(3)} ms`);
