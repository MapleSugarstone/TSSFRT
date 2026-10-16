// Measures simulation and snapshot cost per frame over a scenario, to size the rollback budget.
// Usage: npx tsx tools/perf.ts <scenario-file>
import fs from 'node:fs';
import { createPort, InputTimeline, type Scenario } from './lib/port.ts';
import { saveSnapshot, loadSnapshot } from '../src/engine/snapshot.ts';

const sc: Scenario = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rt = createPort(sc.seed);
rt.logPen = false;
rt.greenFlag();
const tl = new InputTimeline(sc.events);
const step: number[] = [];
const snap: number[] = [];
const load: number[] = [];
let maxClones = 0;
let maxThreads = 0;
for (let f = 1; f <= sc.frames; f++) {
  const inp = tl.inputsFor(f);
  let t = performance.now();
  rt.stepFrame(inp);
  const inMatch = rt.stage.v.Main_State === 'Match';
  const dt = performance.now() - t;
  t = performance.now();
  const s = saveSnapshot(rt);
  const ds = performance.now() - t;
  if (inMatch) {
    step.push(dt);
    snap.push(ds);
    if (f % 10 === 0) {
      t = performance.now();
      loadSnapshot(rt, s);
      load.push(performance.now() - t);
    }
  }
  maxClones = Math.max(maxClones, rt.cloneCount);
  maxThreads = Math.max(maxThreads, rt.threads.length);
}
const q = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]?.toFixed(2);
};
console.log(`match frames ${step.length}, clones max ${maxClones}, threads max ${maxThreads}`);
console.log(`step ms   p50 ${q(step, 0.5)} p90 ${q(step, 0.9)} p99 ${q(step, 0.99)} max ${q(step, 1)}`);
console.log(`snapshot  p50 ${q(snap, 0.5)} p90 ${q(snap, 0.9)} p99 ${q(snap, 0.99)} max ${q(snap, 1)}`);
console.log(`load      p50 ${q(load, 0.5)} p90 ${q(load, 0.9)} max ${q(load, 1)}`);
