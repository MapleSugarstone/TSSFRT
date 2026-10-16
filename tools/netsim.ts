// Simulated network test for the rollback session: several peers on one virtual clock with
// latency, jitter, loss and clock drift. Checks that every peer ends in the same state as an
// offline run fed the same inputs.
// Usage: npx tsx tools/netsim.ts [peers] [frames] [latencyMs] [jitterMs] [loss]
import { createPort, T0 } from './lib/port.ts';
import { RollbackSession, snapshotHash } from '../src/net/rollback.ts';
import { saveSnapshot } from '../src/engine/snapshot.ts';
import { Rng } from '../src/engine/rng.ts';
import type { PlayerInput } from '../src/engine/io.ts';

const peers = Number(process.argv[2] ?? 2);
const frames = Number(process.argv[3] ?? 2400);
const latency = Number(process.argv[4] ?? 60);
const jitter = Number(process.argv[5] ?? 20);
const loss = Number(process.argv[6] ?? 0.05);
const seed = 4242;
const FRAME = 1000 / 30;

const ROWS = [
  ['D', 'A', 'W', 'S', 'B', 'V', 'C', 'space', 'F'],
  ['right arrow', 'left arrow', 'up arrow', 'down arrow', '.', ',', 'M', 'N', 'K'],
  ['L', 'J', 'I', 'K', 'O', 'U', 'Y', 'H', 'G'],
  ['6', '4', '8', '5', '9', '7', '1', '0', '3'],
];

/** Scripted input for a seat: seat 0 starts the tutorial and leaves to the menu, then everyone mashes. */
function scriptFor(seat: number): (tick: number) => PlayerInput {
  const rng = new Rng(100 + seat);
  const held = new Set<string>();
  let nextChange = 0;
  return (tick) => {
    if (seat === 0) {
      if (tick >= 320 && tick < 324) return { keys: ['space'] };
      if (tick >= 520 && tick < 524) return { keys: ['P'] };
      if (tick < 700) return { keys: [] };
    } else if (tick < 700) return { keys: [] };
    if (tick >= nextChange) {
      const k = ROWS[seat][Math.floor(rng.next() * ROWS[seat].length)];
      if (held.has(k)) held.delete(k);
      else held.add(k);
      nextChange = tick + 1 + Math.floor(rng.next() * 10);
    }
    return { keys: [...held] };
  };
}

interface Ev {
  t: number;
  kind: 'tick' | 'packet';
  peer: number;
  data?: ArrayBuffer;
  seq: number;
}
const queue: Ev[] = [];
let seq = 0;
function push(e: Omit<Ev, 'seq'>): void {
  queue.push({ ...e, seq: seq++ });
}
function pop(): Ev | undefined {
  let best = 0;
  for (let i = 1; i < queue.length; i++) if (queue[i].t < queue[best].t || (queue[i].t === queue[best].t && queue[i].seq < queue[best].seq)) best = i;
  return queue.splice(best, 1)[0];
}

const netRng = new Rng(7);
let now = 0;
const seats = Array.from({ length: peers }, (_, i) => i);
const sessions = seats.map((seat) => {
  const rt = createPort(seed);
  rt.logPen = false;
  rt.greenFlag();
  return new RollbackSession({
    rt,
    local: seat,
    seats,
    delay: 2,
    maxPrediction: 10,
    now: () => now,
    transport: {
      send(to, data) {
        if (netRng.next() < loss) return;
        const delay = latency / 2 + netRng.next() * jitter;
        push({ t: now + delay, kind: 'packet', peer: to, data });
      },
    },
  });
});
const scripts = seats.map(scriptFor);
const ticks = seats.map(() => 0);
const drift = seats.map((s) => 1 + (s - (peers - 1) / 2) * 0.002);
seats.forEach((s) => push({ t: s * 7, kind: 'tick', peer: s }));

// Optional 7th argument: the last seat disconnects at this tick, and the host drops it after 5 s.
const dropAt = Number(process.argv[7] ?? 0);
const leaver = peers - 1;
const gone = new Set<number>();
let dropSent = false;
const dropEvents: { t: number; peer: number; frame: number; data: ArrayBuffer }[] = [];

const started = performance.now();
let lastProbe = 0;
while (queue.length || dropEvents.length) {
  dropEvents.sort((a, b) => a.t - b.t);
  if (dropEvents.length && (!queue.length || dropEvents[0].t <= Math.min(...queue.map((q) => q.t)))) {
    const d = dropEvents.shift()!;
    now = d.t;
    if (!sessions[d.peer].applyDrop(leaver, d.frame, d.data)) console.log(`seat ${d.peer} could not apply the drop`);
    continue;
  }
  const e = pop()!;
  now = e.t;
  if (gone.has(e.peer)) continue;
  const s = sessions[e.peer];
  if (e.kind === 'packet') {
    s.receive(e.data!);
    continue;
  }
  if (dropAt && e.peer === leaver && ticks[e.peer] >= dropAt) {
    gone.add(e.peer);
    continue;
  }
  s.tick(scripts[e.peer](ticks[e.peer]++));
  if (dropAt && e.peer === 0 && !dropSent && gone.has(leaver) && s.stats.silentFor[leaver] > 5000) {
    const offer = s.dropOffer(leaver);
    s.applyDrop(leaver, offer.frame, offer.data);
    for (const p of seats) if (p !== 0 && p !== leaver) dropEvents.push({ t: now + latency, peer: p, frame: offer.frame, data: offer.data });
    dropSent = true;
    console.log(`host dropped seat ${leaver} after frame ${offer.frame} (host at frame ${s.frame})`);
  }
  if (now - lastProbe > 1000) {
    sessions.forEach((x, i) => !gone.has(i) && x.probe());
    lastProbe = now;
  }
  const done = sessions.every((x, i) => gone.has(i) || x.confirmedFrame() >= frames);
  if (!done && ticks[e.peer] < frames * 3) push({ t: now + FRAME * drift[e.peer], kind: 'tick', peer: e.peer });
}

// Every remaining peer's state at the common confirmed frame must agree.
const live = sessions.filter((_, i) => !gone.has(i));
const target = Math.min(...live.map((x) => x.confirmedFrame()));
const hashes = live.map((x) => {
  const snap = (x as unknown as { snaps: Map<number, ReturnType<typeof saveSnapshot>> }).snaps.get(target);
  return snap ? snapshotHash(snap) : -1;
});
const agree = hashes.every((h) => h === hashes[0] && h !== -1);
if (!agree) {
  // Find the first retained frame where seat 0 and seat 1 differ, and show what differs.
  const a = (sessions[0] as unknown as { snaps: Map<number, any> }).snaps;
  const b = (sessions[1] as unknown as { snaps: Map<number, any> }).snaps;
  const common = [...a.keys()].filter((f) => b.has(f)).sort((x, y) => x - y);
  for (const f of common) {
    if (snapshotHash(a.get(f)) !== snapshotHash(b.get(f))) {
      const ja = a.get(f);
      const jb = b.get(f);
      console.log(`first retained differing frame ${f} (retained ${common[0]}..${common[common.length - 1]})`);
      for (const k of Object.keys(ja)) {
        const sa = JSON.stringify(ja[k]);
        const sb = JSON.stringify(jb[k]);
        if (sa !== sb) {
          let i = 0;
          while (i < sa.length && sa[i] === sb[i]) i++;
          console.log(`  ${k} differs at char ${i}: ...${sa.slice(Math.max(0, i - 150), i + 150)}\n  vs ...${sb.slice(Math.max(0, i - 150), i + 150)}`);
        }
      }
      break;
    }
  }
  console.log('Main_State', sessions.map((x) => x.rt.stage.v.Main_State));
}
const st = sessions.map((x) => x.stats);
console.log(`peers=${peers} frames=${target} latency=${latency}+${jitter}ms loss=${loss} wall=${((performance.now() - started) / 1000).toFixed(1)}s`);
st.forEach((x, i) => console.log(`  seat ${i}: frame ${x.frame} rollbacks ${x.rollbacks} rolled ${x.rolledFrames} stalls ${x.stalls} adv ${x.advantage.toFixed(2)} desync ${x.desync ? JSON.stringify(x.desync) : 'none'}`));
console.log(agree ? `STATES AGREE at frame ${target} (${hashes[0].toString(16)})` : `STATES DIFFER at frame ${target}: ${hashes.map((h) => h.toString(16)).join(' ')}`);
if (!agree || st.some((x) => x.desync)) process.exitCode = 1;
void T0;
