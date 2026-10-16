// An online game: the shared simulation driven by the rollback session, with sound that follows
// corrections, a status line for connection quality, and continuing without a player who left.
import type { Value } from '../engine/cast.ts';
import type { PlayerInput } from '../engine/io.ts';
import type { SoundEvent } from '../engine/sound-model.ts';
import { RollbackSession } from '../net/rollback.ts';
import type { Mesh } from '../net/mesh.ts';
import type { RoomClient } from '../net/room-client.ts';
import type { SeatInfo, StartInfo } from '../net/protocol.ts';
import { report, reportContext } from '../net/report.ts';
import { fromBase64, toBase64 } from '../net/wire.ts';
import { skinOf } from '../game/assets.ts';
import { applyPrefs, loadControls, seatKeys, translateKeys } from './controls.ts';
import { Game, startFixedLoop } from './game.ts';
import type { LocalInput } from './input.ts';

/** Plays sounds once per frame even when a frame is simulated again after a correction. */
class RollbackAudio {
  private played = new Map<number, Set<string>>();

  constructor(private game: Game) {}

  frame(f: number, resim: boolean, sounds: SoundEvent[]): void {
    const audio = this.game.audio;
    const before = this.played.get(f) ?? new Set<string>();
    const now = new Set<string>();
    const out: SoundEvent[] = [];
    for (const e of sounds) {
      if (e.kind === 'play') {
        const key = `${e.sprite}:${e.sound}`;
        now.add(key);
        if (resim && before.has(key)) continue;
      }
      out.push(e);
    }
    if (resim) {
      for (const key of before) {
        if (!now.has(key)) {
          const [s, n] = key.split(':').map(Number);
          audio.stopSound(s, n);
        }
      }
    }
    this.played.set(f, now);
    if (this.played.size > 200) {
      for (const k of this.played.keys()) if (k < f - 150) this.played.delete(k);
    }
    audio.apply(out);
  }
}

export interface OnlineHud {
  update(text: string, warn: string): void;
  /** Shows one button, or none for a null label. */
  action(label: string | null, onClick: () => void): void;
}

/** Seconds of silence before the host may continue without a player. */
const DROP_AFTER_S = 5;
const FREEZE_REPORT_MS = 5_000;
const AWAY_SILENT_MS = 1_000;

export class OnlineGame {
  session: RollbackSession;
  private stop: (() => void) | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private away = new Set<number>();
  private dropped = new Set<number>();
  private stuckSince: number | null = null;
  private freezeReported = false;
  private desyncReported = false;
  host: number;

  constructor(
    public game: Game,
    private room: RoomClient,
    private mesh: Mesh,
    public start: StartInfo,
    public local: number,
    private names: Map<number, string>,
    private hud: OnlineHud,
    host: number,
  ) {
    this.host = host;
    const rt = game.rt;
    if (start.sameKeys) {
      // Rows 2 to 4 of the controls table get Player 1's keys. Each row only sees its own player's keys.
      const keys = rt.stage.l.Player_Input as unknown[];
      for (let row = 2; row <= 4; row++) for (let b = 0; b < 9; b++) keys[row * 9 + b] = keys[9 + b];
    }
    applyPrefs(rt.stage.l.Player_Settings as Value[], start.seats, start.prefs);
    // The other players' select cursors are drawn eased, since their predicted movement gets corrected.
    const others = start.seats.filter((s) => s !== local).map((s) => skinOf(`Cursor_P${s + 1}`));
    game.renderer.smoothSkins = new Set(others.filter((k) => k >= 0));
    this.session = new RollbackSession({
      rt,
      local,
      seats: start.seats,
      delay: start.delay,
      maxPrediction: 10,
      transport: { send: (seat, data) => mesh.send(seat, data) },
    });
    const audio = new RollbackAudio(game);
    this.session.onFrame = (f, resim, sounds) => audio.frame(f, resim, sounds);
    mesh.onPacket = (data) => this.session.receive(data);
    reportContext.room = room.id;
    reportContext.seat = local;
    reportContext.online = true;
    mesh.onFallback = (seat, reason) => report('link-fallback', { seat, reason, ...this.diagnostics() });
  }

  /** The session and link state that problem reports carry. */
  diagnostics(): Record<string, unknown> {
    const st = this.session.stats;
    return {
      frame: st.frame,
      confirmed: this.session.confirmedFrame(),
      seats: this.start.seats,
      delay: this.start.delay,
      waitingFor: st.waitingFor,
      away: [...this.away],
      dropped: [...this.dropped],
      silentFor: st.silentFor,
      pings: st.pings,
      rollbacks: st.rollbacks,
      stalls: st.stalls,
      advantage: st.advantage,
      links: this.mesh.describe(),
    };
  }

  /** Seat list updates from the room: who is connected and who hosts now. */
  seatsChanged(seats: SeatInfo[], host: number): void {
    this.host = host;
    this.away.clear();
    for (const s of this.start.seats) {
      const info = seats.find((x) => x.seat === s);
      if (s !== this.local && !this.dropped.has(s) && (!info || !info.connected)) this.away.add(s);
    }
  }

  /** The room announced that the host continues without a seat. */
  onDropped(seat: number, frame: number, data: string): void {
    if (this.dropped.has(seat)) return;
    if (this.session.applyDrop(seat, frame, fromBase64(data))) this.dropped.add(seat);
  }

  private dropSeat(seat: number): void {
    if (this.dropped.has(seat)) return;
    const offer = this.session.dropOffer(seat);
    if (!this.session.applyDrop(seat, offer.frame, offer.data)) return;
    this.dropped.add(seat);
    this.room.send({ type: 'drop', seat, frame: offer.frame, data: toBase64(offer.data) });
  }

  run(input: LocalInput): void {
    this.probeTimer = setInterval(() => this.session.probe(), 1000);
    this.mesh.watch();
    const own = loadControls();
    this.stop = startFixedLoop(
      () => {
        const pressed = input.sampleKeys();
        const seat = seatKeys(this.game.rt.stage.l.Player_Input as Value[], this.local);
        const p: PlayerInput = { keys: translateKeys(pressed, own, seat) };
        // Only the first seat drives the shared mouse pointer.
        if (this.local === this.start.seats[0] && input.mouseDirty) {
          p.mouse = { ...input.mouse };
          input.mouseDirty = false;
        }
        if (this.game.question.pendingAnswer !== undefined) {
          p.answer = this.game.question.pendingAnswer;
          this.game.question.pendingAnswer = undefined;
        }
        if (!this.session.tick(p)) {
          // The frame did not advance, so offer the same input again next tick.
          input.retap(pressed);
          if (p.mouse) input.mouseDirty = true;
          if (p.answer !== undefined) this.game.question.pendingAnswer ??= p.answer;
        }
      },
      () => {
        this.game.present();
        this.updateHud();
      },
    );
  }

  private name(s: number): string {
    return this.names.get(s) ?? `P${s + 1}`;
  }

  private updateHud(): void {
    const st = this.session.stats;
    const parts: string[] = [];
    for (const s of this.start.seats) {
      if (s === this.local || this.dropped.has(s)) continue;
      const link = this.mesh.state(s);
      parts.push(`${this.name(s)}: ${st.pings[s] ?? '?'} ms ${link === 'relay' ? '(relayed)' : link === 'connecting' ? '(connecting)' : ''}`);
    }
    parts.push(`rollbacks ${st.rollbacks}`);
    let warn = '';
    // A player whose room socket is reconnecting still plays while their inputs arrive directly.
    const silentAway = [...this.away].filter((s) => (st.silentFor[s] ?? 0) > AWAY_SILENT_MS);
    const stuck = [...new Set([...st.waitingFor, ...silentAway])].filter((s) => !this.dropped.has(s));
    if (stuck.length) warn = `Waiting for ${stuck.map((s) => this.name(s)).join(', ')}...`;
    if (st.desync) warn = `Games went out of sync at frame ${st.desync.frame}. Please start a new room.`;
    const now = performance.now();
    if (!stuck.length) this.stuckSince = null;
    else if (this.stuckSince === null) this.stuckSince = now;
    else if (now - this.stuckSince > FREEZE_REPORT_MS && !this.freezeReported) {
      this.freezeReported = true;
      report('freeze', { stuck, ...this.diagnostics() });
    }
    if (!stuck.length) this.freezeReported = false;
    if (st.desync && !this.desyncReported) {
      this.desyncReported = true;
      report('desync', { desync: st.desync, ...this.diagnostics() });
    }
    this.hud.update(parts.join('  |  '), warn);
    // The host may continue without a player who has been gone a few seconds.
    const gone = stuck.find((s) => this.away.has(s) || st.silentFor[s] > DROP_AFTER_S * 1000);
    if (this.local === this.host && gone !== undefined) this.hud.action(`Continue without ${this.name(gone)}`, () => this.dropSeat(gone));
    else this.hud.action(null, () => {});
  }

  leave(): void {
    this.stop?.();
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.mesh.close();
    this.room.close();
  }
}
