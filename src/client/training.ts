// Training mode tools for play on one computer. F2 saves the whole game state and F4 loads it. F8
// records the dummy (player 2) moved by the player's own controls, and F9 makes it repeat the recording.
// They work only in the input layer and with whole-state snapshots, so the game itself is unchanged.
import type { Value } from '../engine/cast.ts';
import type { PlayerInput } from '../engine/io.ts';
import { loadSnapshot, saveSnapshot, type Snapshot } from '../engine/snapshot.ts';
import { seatKeys, translateKeys } from './controls.ts';
import type { Game } from './game.ts';
import type { Toast } from './toast.ts';

/** The longest recording: 10 seconds. */
const RECORD_MAX = 300;
const HINT = 'Training: F2 save, F4 load, F8 record the dummy, F9 play back.';
const KEYS = ['F2', 'F4', 'F8', 'F9'];

const seconds = (frames: number) => (frames / 30).toFixed(1);

export class TrainingTools {
  private state: Snapshot | null = null;
  private mode: 'idle' | 'recording' | 'playing' = 'idle';
  /** The dummy's keys for each recorded frame. */
  private recording: string[][] = [];
  private at = 0;
  private wasTraining = false;

  constructor(
    private game: Game,
    private toast: Toast,
  ) {}

  private get training(): boolean {
    const v = this.game.rt.stage.v;
    return String(v.Main_State) === 'Match' && String(v.Match_Type) === 'TrainingMode';
  }

  private get paused(): boolean {
    return Number((this.game.rt.stage.l.Paused_Data as Value[])[0]) === 1;
  }

  /** Acts on F2, F4, F8 and F9 during training. Returns true when the key was one of them. */
  key(e: KeyboardEvent): boolean {
    if (!KEYS.includes(e.key) || !this.training) return false;
    if (e.repeat) return true;
    const rt = this.game.rt;
    switch (e.key) {
      case 'F2':
        this.state = saveSnapshot(rt);
        this.toast.show('State saved. F4 load.');
        break;
      case 'F4':
        if (!this.state) {
          this.toast.show('No state saved yet. F2 save.');
          break;
        }
        loadSnapshot(rt, this.state);
        rt.soundEvents.length = 0;
        this.toast.show('State loaded.');
        break;
      case 'F8':
        if (this.mode === 'recording') this.stopRecording();
        else if (this.dummyIsCpu()) this.toast.show('The dummy is a CPU. Set its CPU level to 0 in the training menu to record.', 4000);
        else {
          this.mode = 'recording';
          this.recording = [];
        }
        break;
      case 'F9':
        if (this.mode === 'playing') {
          this.mode = 'idle';
          this.toast.show('The dummy stopped.');
        } else if (!this.recording.length) this.toast.show('Nothing recorded yet. F8 record the dummy.');
        else if (this.dummyIsCpu()) this.toast.show('The dummy is a CPU. Set its CPU level to 0 in the training menu to play back.', 4000);
        else {
          if (this.mode === 'recording') this.stopRecording();
          this.mode = 'playing';
          this.at = 0;
          this.toast.show(`The dummy repeats the recording (${seconds(this.recording.length)} s). F9 stop.`, 4000);
        }
        break;
    }
    return true;
  }

  /** This frame's input with the training tools applied. Call it once before every local step. */
  input(p: PlayerInput): PlayerInput {
    const training = this.training;
    if (training && !this.wasTraining) this.toast.show(HINT, 6000);
    this.wasTraining = training;
    if (!training) {
      if (this.mode === 'recording') this.stopRecording();
      this.mode = 'idle';
      return p;
    }
    if (this.mode === 'idle' || this.paused) return p;
    const table = this.game.rt.stage.l.Player_Input as Value[];
    const dummy = seatKeys(table, 1).slice(0, 9);
    if (this.mode === 'recording') {
      // The player's own keys become the dummy's, so their fighter stands still meanwhile.
      const keys = translateKeys(p.keys, seatKeys(table, 0).slice(0, 9), dummy);
      this.recording.push(keys.filter((k) => dummy.includes(k)));
      if (this.recording.length >= RECORD_MAX) this.stopRecording();
      else this.toast.show(`Recording the dummy: ${seconds(this.recording.length)} of 10 s. Your controls move the dummy. F8 stop.`, 0);
      return { ...p, keys };
    }
    const add = this.recording[this.at++ % this.recording.length];
    return add.length ? { ...p, keys: [...new Set([...p.keys, ...add])] } : p;
  }

  private stopRecording(): void {
    this.mode = 'idle';
    this.toast.show(this.recording.length ? `Recorded ${seconds(this.recording.length)} s. F9 play back.` : 'Nothing recorded.', 4000);
  }

  private dummyIsCpu(): boolean {
    return Number((this.game.rt.stage.l.C_CPULevel as Value[])[1] ?? 0) > 0;
  }
}
