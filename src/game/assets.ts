import type { CostumeDef, SkinDef, SoundDef } from '../engine/defs.ts';
import data from './assets-data.json' with { type: 'json' };

const table = data as unknown as { skins: SkinDef[]; costumes: CostumeDef[][]; sounds: SoundDef[][] };

export const skins: SkinDef[] = table.skins;

export function costumes(targetIndex: number): CostumeDef[] {
  return table.costumes[targetIndex];
}

export const allCostumes: readonly CostumeDef[][] = table.costumes;

export function sounds(targetIndex: number): SoundDef[] {
  return table.sounds[targetIndex];
}
