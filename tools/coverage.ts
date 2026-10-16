// Reports which game states a scenario reaches: menus, match types, characters and stages.
// Usage: npx tsx tools/coverage.ts <scenario-file>...
import fs from 'node:fs';
import { createPort, InputTimeline, type Scenario } from './lib/port.ts';

const total = { states: new Map<string, number>(), types: new Set<string>(), chars: new Set<string>(), stages: new Set<string>(), cpu: new Set<string>(), frames: 0 };
for (const file of process.argv.slice(2)) {
  const sc: Scenario = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rt = createPort(sc.seed);
  rt.logPen = false;
  rt.greenFlag();
  const tl = new InputTimeline(sc.events);
  for (let f = 1; f <= sc.frames; f++) {
    rt.stepFrame(tl.inputsFor(f));
    const g = rt.stage;
    const state = String(g.v.Main_State);
    total.states.set(state, (total.states.get(state) ?? 0) + 1);
    if (state === 'Match') {
      total.types.add(String(g.v.Match_Type));
      for (const c of g.l.CHARACTERS) total.chars.add(String(c));
      total.stages.add(String(g.l.Stage_MatchData[0]));
      for (const c of g.l.C_CPULevel) total.cpu.add(String(c));
    }
    total.frames++;
  }
}
console.log(`frames ${total.frames}`);
console.log('states', Object.fromEntries([...total.states].sort((a, b) => b[1] - a[1])));
console.log('match types', [...total.types]);
console.log('characters', [...total.chars].sort());
console.log('stages', [...total.stages].sort());
console.log('cpu levels', [...total.cpu].sort());
