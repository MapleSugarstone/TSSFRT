// What the character build step produces and the game installs: list entries, costumes, skins
// and sounds to add, ready to append. Shared by tools/characters/build.ts and src/game/packs.ts.
import type { CostumeDef, SkinDef, SoundDef } from '../engine/defs.ts';
import type { Scalar } from './pack-format.ts';

export interface BuiltCharacter {
  /** Character number in the game (8 and up). */
  id: number;
  slug: string;
  name: string;
  /** Template character number, or null. */
  template: number | null;
  /** Moves with the character's own data; others use the template's move names. */
  owns: string[];
  /** Path of the gimmick script under characters/, or null. src/game/pack-gimmicks.ts imports it. */
  gimmick: string | null;
}

export interface BuiltPacks {
  characters: BuiltCharacter[];
  /** Skins to append to the skin table, in order; costume skin numbers below already count them. */
  skins: SkinDef[];
  /** Costumes to append, by target index. */
  costumes: Record<number, CostumeDef[]>;
  /** Sounds to append, by target index. */
  sounds: Record<number, SoundDef[]>;
  /** Entries to append to the stage's lists, by list property. */
  lists: Record<string, Scalar[]>;
  /** Text to add to the end of entries of the stage's lists, by list property and 1-based item. */
  listSuffixes: Record<string, Record<number, string>>;
  /** Touch masks for new skins used by sprites that test touching (the menus), by skin number. */
  silhouettes: Record<number, { w: number; h: number; bits: string }>;
  /** Sounds that hitboxes of a move play on frames of their life: [frame, sound name], by move. */
  cues: Record<string, [number, string][]>;
  /** Particle names each pack character has, by character number. Their costumes are "<speed>)<name>@<id>-<n>". */
  particles: Record<number, string[]>;
}

/** Stage list properties (as the transpiler names them) that hold character data. */
export const LISTS = {
  stats: 'CharData_SP_FC_JH_Fall_JA_AirSP_hitwidth_hitheight',
  names: 'Data_Character_Names',
  text: 'Data_Txt_CharacterDescription',
  behaviour: 'CPU_character_shmoves',
  comboUsage: 'CPU_combo_usage',
  combos: 'CPU_combos',
  moveData: 'MoveData_L_W_XYD_XYK_EXYK_iframe_stun',
  frameData: 'FrameData',
  spacing: 'CPU_I_AM_LOOSING_IT_DISPLACEMENT_THING_IDK_ANYMORE',
  cantMove: 'Can_tMove',
  unique: 'UniqueAnimation',
  shieldBreaking: 'Attacks_ShieldBreaking',
  ignoreVelocity: 'Attacks_IgnoreVelocityLimit',
  freeze: 'FREEZE',
  hitsound: 'Hitsound',
} as const;
